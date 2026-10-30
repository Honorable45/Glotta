import type { ReminderItem } from '@gestion/contracts';
import { formatAmount, newId, normalizePhone, reminderMessage, whatsappUrl } from '@gestion/domain';
import { AppError } from '../core/errors';
import { logger, type Context } from './commerce.shared';
import { localDate } from './finance.service';

const include = { debt: { include: { customer: true, sale: { select: { netTotal: true, netPaid: true } } } } };

export function createRemindersService({ db, deviceId, openUrl }: Context & { openUrl: (url: string) => Promise<void> }) {
  const log = logger(deviceId);

  type Row = NonNullable<Awaited<ReturnType<typeof load>>>;
  function load(id: string) {
    return db.reminder.findUnique({ where: { id }, include });
  }
  function view(row: Row): ReminderItem {
    const { sale, customer } = row.debt;
    return {
      id: row.id,
      debtId: row.debtId,
      customerName: customer.name,
      remaining: sale.netTotal > sale.netPaid ? sale.netTotal - sale.netPaid : 0n,
      dueDate: row.dueDate,
      note: row.note,
      state: row.state as ReminderItem['state'],
      overdue: row.state !== 'DONE' && row.dueDate < localDate(),
      hasWhatsapp: Boolean(customer.whatsapp ?? customer.phone),
    };
  }
  async function require(id: string) {
    const row = await load(id);
    if (!row) throw new AppError('NOT_FOUND', 'Rappel introuvable.');
    return row;
  }

  async function openWhatsapp(debtId: string) {
    const debt = await db.debt.findUnique({ where: { id: debtId }, include: { customer: true, sale: { select: { netTotal: true, netPaid: true } } } });
    if (!debt) throw new AppError('NOT_FOUND', 'Dette introuvable.');
    const phone = normalizePhone(debt.customer.whatsapp ?? debt.customer.phone ?? '');
    if (!phone) throw new AppError('INVALID_INPUT', `Aucun numéro WhatsApp valide pour ${debt.customer.name}.`);
    const company = await db.company.findFirstOrThrow();
    const remaining = debt.sale.netTotal - debt.sale.netPaid;
    if (remaining <= 0n) throw new AppError('CONFLICT', 'Cette dette est déjà réglée.');
    await openUrl(whatsappUrl(phone, reminderMessage({ customerName: debt.customer.name, amount: formatAmount(remaining, company.currency), company: company.name })));
  }

  return {
    openWhatsapp,

    async list(includeDone: boolean): Promise<ReminderItem[]> {
      const rows = await db.reminder.findMany({ where: includeDone ? {} : { state: { not: 'DONE' } }, orderBy: { dueDate: 'asc' }, include });
      return rows.map(view);
    },

    async create(input: { debtId: string; dueDate: string; note: string | null }): Promise<ReminderItem> {
      if (!(await db.debt.findUnique({ where: { id: input.debtId } }))) throw new AppError('NOT_FOUND', 'Dette introuvable.');
      const id = newId();
      await db.$transaction(async (tx) => {
        await tx.reminder.create({ data: { id, ...input, createdAt: new Date().toISOString() } });
        await log(tx, 'reminder.create', 'Reminder', id, input);
      });
      return view(await require(id));
    },

    /** Ouvre WhatsApp : l'envoi reste à faire par le commerçant, donc l'état ne dit jamais « envoyé ». */
    async whatsapp(id: string): Promise<ReminderItem> {
      const row = await require(id);
      await openWhatsapp(row.debtId);
      await db.$transaction(async (tx) => {
        await tx.reminder.update({ where: { id }, data: { state: row.state === 'DONE' ? 'DONE' : 'OPENED', openedAt: new Date().toISOString() } });
        await log(tx, 'reminder.whatsapp', 'Reminder', id, {});
      });
      return view(await require(id));
    },

    async markDone(id: string): Promise<ReminderItem> {
      await require(id);
      await db.$transaction(async (tx) => {
        await tx.reminder.update({ where: { id }, data: { state: 'DONE', doneAt: new Date().toISOString() } });
        await log(tx, 'reminder.done', 'Reminder', id, {});
      });
      return view(await require(id));
    },

    /** Rappels à notifier aujourd'hui. */
    async due(): Promise<{ id: string; customerName: string; dueDate: string }[]> {
      const rows = await db.reminder.findMany({ where: { state: 'PLANNED', dueDate: { lte: localDate() } }, include });
      return rows.map((row) => ({ id: row.id, customerName: row.debt.customer.name, dueDate: row.dueDate }));
    },
  };
}
