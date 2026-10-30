import type { Customer, CustomerInput } from '@gestion/contracts';
import { newId, normalizeSearch } from '@gestion/domain';
import { AppError } from '../core/errors';
import { hasPermission } from '../core/session';
import { logger, type Context } from './commerce.shared';

export function createCustomersService({ db, deviceId }: Context) {
  const log = logger(deviceId);

  async function balanceOf(customerId: string): Promise<bigint> {
    const debts = await db.debt.findMany({ where: { customerId }, include: { sale: { select: { netTotal: true, netPaid: true } } } });
    return debts.reduce((sum, debt) => {
      const due = debt.sale.netTotal - debt.sale.netPaid;
      return sum + (due > 0n ? due : 0n);
    }, 0n);
  }

  async function view(row: { id: string; name: string; phone: string | null; whatsapp: string | null; address: string | null; archivedAt: Date | null }): Promise<Customer> {
    const { archivedAt, ...fields } = row;
    return { ...fields, archived: archivedAt !== null, balance: hasPermission('view_debts') ? await balanceOf(row.id) : 0n };
  }

  return {
    async list(search: string): Promise<Customer[]> {
      const normalized = normalizeSearch(search);
      const rows = await db.customer.findMany({
        where: { archivedAt: null, ...(normalized ? { searchText: { contains: normalized } } : {}) },
        orderBy: { name: 'asc' },
        take: 200,
      });
      return Promise.all(rows.map(view));
    },

    async get(id: string) {
      const row = await db.customer.findUnique({
        where: { id },
        include: { sales: { orderBy: { occurredAt: 'desc' }, take: 100 } },
      });
      if (!row) throw new AppError('NOT_FOUND', 'Client introuvable.');
      const { sales, ...customer } = row;
      return {
        ...(await view(customer)),
        sales: sales.map((sale) => ({
          id: sale.id,
          number: sale.number,
          status: sale.status,
          customerName: row.name,
          netTotal: sale.netTotal,
          netPaid: sale.netPaid,
          occurredAt: sale.occurredAt,
        })),
      };
    },

    async save(input: CustomerInput): Promise<Customer> {
      const id = input.id ?? newId();
      const { id: _id, ...fields } = input;
      const data = { ...fields, searchText: normalizeSearch([input.name, input.phone, input.whatsapp].filter(Boolean).join(' ')) };
      const row = await db.$transaction(async (tx) => {
        const saved = input.id ? await tx.customer.update({ where: { id }, data }) : await tx.customer.create({ data: { id, ...data } });
        await log(tx, 'customer.save', 'Customer', id, { name: input.name });
        return saved;
      });
      return view(row);
    },

    async setArchived(id: string, archived: boolean) {
      await db.$transaction(async (tx) => {
        await tx.customer.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
        await log(tx, archived ? 'customer.archive' : 'customer.restore', 'Customer', id, {});
      });
    },
  };
}
