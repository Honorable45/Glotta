import type { CashSessionItem, DebtItem, ExpenseItem, Period } from '@gestion/contracts';
import { debtStatus, newId } from '@gestion/domain';
import { AppError } from '../core/errors';
import { currentUserId } from '../core/session';
import { logger, requireStoreId, type Context, type Tx } from './commerce.shared';

const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);

/** Date locale AAAA-MM-JJ : l'échéance d'une dette suit le calendrier du commerçant. */
export function localDate(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function createFinanceService({ db, deviceId }: Context) {
  const log = logger(deviceId);

  const debtInclude = { sale: { select: { number: true, netTotal: true, netPaid: true } }, customer: { select: { name: true } } };
  type DebtRow = { id: string; saleId: string; customerId: string; dueDate: string | null; sale: { number: string; netTotal: bigint; netPaid: bigint }; customer: { name: string } };

  function toDebt(row: DebtRow): DebtItem {
    const { netTotal: total, netPaid: paid } = row.sale;
    return {
      id: row.id,
      saleId: row.saleId,
      saleNumber: row.sale.number,
      customerId: row.customerId,
      customerName: row.customer.name,
      total,
      paid,
      remaining: total > paid ? total - paid : 0n,
      dueDate: row.dueDate,
      status: debtStatus({ total, paid, dueDate: row.dueDate, today: localDate() }),
    };
  }

  async function sessionView(id: string, client: Tx | typeof db = db): Promise<CashSessionItem> {
    const session = await client.cashSession.findUnique({ where: { id }, include: { movements: { orderBy: { occurredAt: 'asc' } } } });
    if (!session) throw new AppError('NOT_FOUND', 'Session de caisse introuvable.');
    const cashMethods = await client.paymentMethod.findMany({ where: { isCash: true }, select: { id: true } });
    const payments = await client.salePayment.aggregate({
      where: {
        methodId: { in: cashMethods.map((method) => method.id) },
        sale: { storeId: session.storeId },
        occurredAt: { gte: session.openedAt, ...(session.closedAt ? { lte: session.closedAt } : {}) },
      },
      _sum: { amount: true },
    });
    const cashSales = payments._sum.amount ?? 0n;
    const cashIn = sum(session.movements.filter((row) => row.type === 'IN').map((row) => row.amount));
    const cashOut = sum(session.movements.filter((row) => row.type !== 'IN').map((row) => row.amount));
    const expected = session.expected ?? session.openingFloat + cashSales + cashIn - cashOut;
    return {
      id: session.id,
      openingFloat: session.openingFloat,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      cashSales,
      cashIn,
      cashOut,
      expected,
      counted: session.counted,
      difference: session.counted === null ? null : session.counted - expected,
      note: session.note,
      movements: session.movements.map(({ id: movementId, type, amount, reason, occurredAt }) => ({ id: movementId, type, amount, reason, occurredAt })),
    };
  }

  async function requireOpenSession(client: Tx | typeof db) {
    const session = await client.cashSession.findFirst({ where: { closedAt: null, storeId: await requireStoreId(client) } });
    if (!session) throw new AppError('CONFLICT', "Ouvrez d'abord la caisse.");
    return session;
  }

  return {
    async listDebts(input: { openOnly: boolean; customerId: string | null }): Promise<DebtItem[]> {
      const rows = await db.debt.findMany({
        where: input.customerId ? { customerId: input.customerId } : {},
        include: debtInclude,
        orderBy: { createdAt: 'desc' },
      });
      const debts = rows.map(toDebt);
      return input.openOnly ? debts.filter((debt) => debt.status !== 'PAID') : debts;
    },

    async payDebt(input: { id: string; debtId: string; amount: bigint; methodId: string }): Promise<DebtItem> {
      return db.$transaction(async (tx) => {
        const row = await tx.debt.findUnique({ where: { id: input.debtId }, include: debtInclude });
        if (!row) throw new AppError('NOT_FOUND', 'Dette introuvable.');
        // Même identifiant = même paiement : un double clic n'encaisse pas deux fois.
        if (await tx.salePayment.findUnique({ where: { id: input.id } })) return toDebt(row);
        const debt = toDebt(row);
        if (input.amount > debt.remaining) throw new AppError('INVALID_INPUT', 'Le montant dépasse le solde restant.');
        const method = await tx.paymentMethod.findUnique({ where: { id: input.methodId } });
        if (!method || !method.isActive) throw new AppError('NOT_FOUND', 'Mode de paiement indisponible.');
        await tx.salePayment.create({
          data: { id: input.id, saleId: row.saleId, methodId: method.id, methodName: method.name, amount: input.amount, kind: 'DEBT_PAYMENT', occurredAt: new Date().toISOString(), userId: currentUserId() },
        });
        const sale = await tx.sale.update({ where: { id: row.saleId }, data: { netPaid: { increment: input.amount } }, select: { number: true, netTotal: true, netPaid: true } });
        await log(tx, 'debt.pay', 'Debt', row.id, { amount: input.amount, method: method.name, saleId: row.saleId });
        return toDebt({ ...row, sale });
      });
    },

    async setDueDate(debtId: string, dueDate: string | null) {
      await db.$transaction(async (tx) => {
        await tx.debt.update({ where: { id: debtId }, data: { dueDate } });
        await log(tx, 'debt.setDueDate', 'Debt', debtId, { dueDate });
      });
    },

    listExpenseCategories() {
      return db.expenseCategory.findMany({ where: { archivedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
    },

    async saveExpenseCategory(input: { id: string | null; name: string }) {
      const all = await db.expenseCategory.findMany({ where: { archivedAt: null } });
      if (all.some((row) => row.id !== input.id && row.name.localeCompare(input.name, 'fr', { sensitivity: 'base' }) === 0)) {
        throw new AppError('CONFLICT', `La catégorie « ${input.name} » existe déjà.`);
      }
      const id = input.id ?? newId();
      await db.$transaction(async (tx) => {
        if (input.id) await tx.expenseCategory.update({ where: { id }, data: { name: input.name } });
        else await tx.expenseCategory.create({ data: { id, name: input.name } });
        await log(tx, 'expenseCategory.save', 'ExpenseCategory', id, { name: input.name });
      });
      return { id, name: input.name };
    },

    async listExpenses(period: Period): Promise<ExpenseItem[]> {
      const rows = await db.expense.findMany({
        where: { date: { gte: localDate(new Date(period.from)), lte: localDate(new Date(period.to)) } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        include: { category: { select: { name: true } } },
      });
      return rows.map((row) => ({ id: row.id, label: row.label, categoryName: row.category.name, amount: row.amount, date: row.date, comment: row.comment, voidedAt: row.voidedAt }));
    },

    async createExpense(input: { label: string; categoryId: string; amount: bigint; date: string; comment: string | null; paidFromCash: boolean }): Promise<ExpenseItem> {
      const { paidFromCash, ...data } = input;
      const category = await db.expenseCategory.findUnique({ where: { id: input.categoryId } });
      if (!category) throw new AppError('NOT_FOUND', 'Catégorie introuvable.');
      const id = newId();
      await db.$transaction(async (tx) => {
        await tx.expense.create({ data: { id, ...data, paidFromCash, userId: currentUserId() } });
        if (paidFromCash) {
          const session = await requireOpenSession(tx);
          await tx.cashMovement.create({
            data: { id: newId(), sessionId: session.id, type: 'EXPENSE', amount: input.amount, reason: input.label, occurredAt: new Date().toISOString(), userId: currentUserId() },
          });
        }
        await log(tx, 'expense.create', 'Expense', id, { ...data, paidFromCash });
      });
      return { id, label: input.label, categoryName: category.name, amount: input.amount, date: input.date, comment: input.comment, voidedAt: null };
    },

    async voidExpense(id: string, reason: string) {
      await db.$transaction(async (tx) => {
        const expense = await tx.expense.findUnique({ where: { id } });
        if (!expense) throw new AppError('NOT_FOUND', 'Dépense introuvable.');
        if (expense.voidedAt) throw new AppError('CONFLICT', 'Cette dépense est déjà annulée.');
        if (expense.paidFromCash) {
          // L'argent revient dans le tiroir actuellement ouvert : une caisse clôturée reste figée.
          const session = await requireOpenSession(tx);
          await tx.cashMovement.create({
            data: { id: newId(), sessionId: session.id, type: 'IN', amount: expense.amount, reason: `Annulation : ${expense.label}`, occurredAt: new Date().toISOString(), userId: currentUserId() },
          });
        }
        await tx.expense.update({ where: { id }, data: { voidedAt: new Date().toISOString(), voidReason: reason } });
        await log(tx, 'expense.void', 'Expense', id, { reason, amount: expense.amount });
      });
    },

    async currentCash(): Promise<CashSessionItem | null> {
      const session = await db.cashSession.findFirst({ where: { closedAt: null, storeId: await requireStoreId(db) } });
      return session ? sessionView(session.id) : null;
    },

    async openCash(openingFloat: bigint): Promise<CashSessionItem> {
      const storeId = await requireStoreId(db);
      const id = newId();
      await db.$transaction(async (tx) => {
        if (await tx.cashSession.findFirst({ where: { closedAt: null, storeId } })) throw new AppError('CONFLICT', 'La caisse est déjà ouverte.');
        await tx.cashSession.create({ data: { id, storeId, openingFloat, openedAt: new Date().toISOString(), userId: currentUserId() } });
        await log(tx, 'cash.open', 'CashSession', id, { openingFloat });
      });
      return sessionView(id);
    },

    async moveCash(input: { type: 'IN' | 'OUT' | 'WITHDRAWAL'; amount: bigint; reason: string }): Promise<CashSessionItem> {
      const id = await db.$transaction(async (tx) => {
        const session = await requireOpenSession(tx);
        if (input.type !== 'IN') {
          const view = await sessionView(session.id, tx);
          if (input.amount > view.expected) throw new AppError('CONFLICT', 'Le montant dépasse le solde attendu de la caisse.');
        }
        await tx.cashMovement.create({ data: { id: newId(), sessionId: session.id, ...input, occurredAt: new Date().toISOString(), userId: currentUserId() } });
        await log(tx, `cash.${input.type.toLowerCase()}`, 'CashSession', session.id, input);
        return session.id;
      });
      return sessionView(id);
    },

    async closeCash(input: { counted: bigint; note: string | null }): Promise<CashSessionItem> {
      const id = await db.$transaction(async (tx) => {
        const session = await requireOpenSession(tx);
        const closedAt = new Date().toISOString();
        const view = await sessionView(session.id, tx);
        // L'attendu est figé : une correction ultérieure de méthode ne réécrit pas une caisse clôturée.
        await tx.cashSession.update({ where: { id: session.id }, data: { closedAt, expected: view.expected, counted: input.counted, note: input.note } });
        await log(tx, 'cash.close', 'CashSession', session.id, { expected: view.expected, counted: input.counted, difference: input.counted - view.expected });
        return session.id;
      });
      return sessionView(id);
    },

    async cashHistory(limit: number): Promise<CashSessionItem[]> {
      const rows = await db.cashSession.findMany({ where: { closedAt: { not: null }, storeId: await requireStoreId(db) }, orderBy: { openedAt: 'desc' }, take: limit, select: { id: true } });
      return Promise.all(rows.map((row) => sessionView(row.id)));
    },
  };
}
