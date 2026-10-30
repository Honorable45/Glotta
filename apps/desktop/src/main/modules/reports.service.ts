import type { Dashboard, Period, Report, ReportKind } from '@gestion/contracts';
import { costOf } from '@gestion/domain';
import { hasPermission, requirePermission } from '../core/session';
import { logger, readStockSettings, requireStoreId, type Context } from './commerce.shared';
import { localDate } from './finance.service';

const HIDDEN_KEY = 'dashboard.hidden';
const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);

const monthLabel = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const inPeriod = (period: Period) => ({ gte: period.from, lte: period.to });

export function createReportsService({ db, deviceId }: Context) {
  const log = logger(deviceId);

  /** Ventes de la période, avec les quantités nettes des retours pour une marge juste. */
  async function loadSales(period: Period) {
    const sales = await db.sale.findMany({
      where: { occurredAt: inPeriod(period) },
      include: { lines: { include: { returnLines: { select: { quantity: true, amount: true } } } } },
    });
    return sales.map((sale) => {
      const lines = sale.lines.map((line) => {
        const quantity = line.quantity - sum(line.returnLines.map((row) => row.quantity));
        const revenue = line.lineTotal - sum(line.returnLines.map((row) => row.amount));
        const cost = costOf(quantity, line.unitCost);
        return { ...line, netQuantity: quantity, revenue, cost, margin: revenue - cost };
      });
      return { ...sale, lines, cost: sum(lines.map((line) => line.cost)) };
    });
  }

  const expensesTotal = async (period: Period) => {
    const result = await db.expense.aggregate({
      where: { voidedAt: null, date: { gte: localDate(new Date(period.from)), lte: localDate(new Date(period.to)) } },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0n;
  };

  const revenueOf = async (period: Period) =>
    (await db.sale.aggregate({ where: { occurredAt: inPeriod(period) }, _sum: { netTotal: true } }))._sum.netTotal ?? 0n;

  async function receivablesTotal() {
    const debts = await db.debt.findMany({ include: { sale: { select: { netTotal: true, netPaid: true } } } });
    return sum(debts.map((debt) => (debt.sale.netTotal > debt.sale.netPaid ? debt.sale.netTotal - debt.sale.netPaid : 0n)));
  }

  async function lowStock() {
    const { lowStockThreshold } = await readStockSettings(db);
    const storeId = await requireStoreId(db);
    const variants = await db.productVariant.findMany({
      where: { archivedAt: null, product: { archivedAt: null } },
      include: { product: { include: { unit: true } }, stockLevels: true },
    });
    return variants.flatMap((variant) => {
      const quantity = sum(variant.stockLevels.filter((level) => level.storeId === storeId).map((level) => level.quantity));
      const threshold = variant.product.lowStockThreshold ?? BigInt(lowStockThreshold) * 1000n;
      return quantity <= threshold
        ? [{ id: variant.id, name: [variant.product.name, variant.label].filter(Boolean).join(' '), quantity, unitSymbol: variant.product.unit.symbol }]
        : [];
    });
  }

  const groupRows = <T,>(items: T[], keyOf: (item: T) => string) => {
    const groups = new Map<string, T[]>();
    for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
    return groups;
  };

  async function salesByTime(period: Period, keyOf: (date: Date) => string, title: string, label: string): Promise<Report> {
    const sales = await loadSales(period);
    const rows = [...groupRows(sales, (sale) => keyOf(new Date(sale.occurredAt))).entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => ({
        period: key,
        count: String(group.length),
        revenue: sum(group.map((sale) => sale.netTotal)),
        margin: sum(group.map((sale) => sale.netTotal - sale.cost)),
      }));
    return {
      title,
      columns: [
        { key: 'period', label, kind: 'text' },
        { key: 'count', label: 'Ventes', kind: 'text' },
        { key: 'revenue', label: "Chiffre d'affaires", kind: 'money' },
        { key: 'margin', label: 'Marge estimée', kind: 'money' },
      ],
      rows,
      totals: { period: 'Total', count: String(sales.length), revenue: sum(rows.map((row) => row.revenue)), margin: sum(rows.map((row) => row.margin)) },
    };
  }

  async function byProduct(period: Period, title: string, top: boolean): Promise<Report> {
    const lines = (await loadSales(period)).flatMap((sale) => sale.lines);
    let rows = [...groupRows(lines, (line) => line.variantId).values()].map((group) => ({
      product: [group[0]!.productName, group[0]!.variantLabel].filter(Boolean).join(' '),
      quantity: sum(group.map((line) => line.netQuantity)),
      revenue: sum(group.map((line) => line.revenue)),
      margin: sum(group.map((line) => line.margin)),
    }));
    const compare = (a: bigint, b: bigint) => (a < b ? 1 : a > b ? -1 : 0);
    rows = top ? rows.sort((a, b) => compare(a.quantity, b.quantity)).slice(0, 20) : rows.sort((a, b) => compare(a.revenue, b.revenue));
    return {
      title,
      columns: [
        { key: 'product', label: 'Produit', kind: 'text' },
        { key: 'quantity', label: 'Quantité', kind: 'quantity' },
        { key: 'revenue', label: "Chiffre d'affaires", kind: 'money' },
        { key: 'margin', label: 'Marge estimée', kind: 'money' },
      ],
      rows,
      totals: top ? null : { product: 'Total', quantity: sum(rows.map((row) => row.quantity)), revenue: sum(rows.map((row) => row.revenue)), margin: sum(rows.map((row) => row.margin)) },
    };
  }

  const reports: Record<ReportKind, (period: Period) => Promise<Report>> = {
    dailySales: (period) => salesByTime(period, (date) => localDate(date), 'Ventes quotidiennes', 'Jour'),
    monthlySales: (period) => salesByTime(period, monthLabel, 'Ventes mensuelles', 'Mois'),
    async salesByEmployee(period) {
      const sales = await loadSales(period);
      const users = await db.user.findMany({ select: { id: true, name: true } });
      const nameOf = (id: string | null) => users.find((user) => user.id === id)?.name ?? 'Sans compte';
      const rows = [...groupRows(sales, (sale) => nameOf(sale.userId)).entries()].map(([employee, group]) => ({
        employee,
        count: String(group.length),
        revenue: sum(group.map((sale) => sale.netTotal)),
      }));
      return {
        title: 'Ventes par employé',
        columns: [
          { key: 'employee', label: 'Employé', kind: 'text' },
          { key: 'count', label: 'Ventes', kind: 'text' },
          { key: 'revenue', label: "Chiffre d'affaires", kind: 'money' },
        ],
        rows,
        totals: { employee: 'Total', count: String(sales.length), revenue: sum(rows.map((row) => row.revenue)) },
      };
    },
    async salesByStore(period) {
      const [sales, stores] = await Promise.all([loadSales(period), db.store.findMany({ select: { id: true, name: true } })]);
      const rows = [...groupRows(sales, (sale) => sale.storeId).entries()].map(([storeId, group]) => ({
        store: stores.find((store) => store.id === storeId)?.name ?? 'Boutique inconnue',
        count: String(group.length),
        revenue: sum(group.map((sale) => sale.netTotal)),
        margin: sum(group.map((sale) => sale.netTotal - sale.cost)),
      }));
      return {
        title: 'Performances par boutique',
        columns: [
          { key: 'store', label: 'Boutique', kind: 'text' },
          { key: 'count', label: 'Ventes', kind: 'text' },
          { key: 'revenue', label: "Chiffre d'affaires", kind: 'money' },
          { key: 'margin', label: 'Marge estimée', kind: 'money' },
        ],
        rows,
        totals: { store: 'Total', count: String(sales.length), revenue: sum(rows.map((row) => row.revenue)), margin: sum(rows.map((row) => row.margin)) },
      };
    },
    salesByProduct: (period) => byProduct(period, 'Ventes par produit', false),
    topProducts: (period) => byProduct(period, 'Produits les plus vendus', true),
    async expenses(period) {
      const rows = await db.expense.findMany({
        where: { voidedAt: null, date: { gte: localDate(new Date(period.from)), lte: localDate(new Date(period.to)) } },
        orderBy: { date: 'asc' },
        include: { category: { select: { name: true } } },
      });
      return {
        title: 'Dépenses',
        columns: [
          { key: 'date', label: 'Date', kind: 'text' },
          { key: 'label', label: 'Libellé', kind: 'text' },
          { key: 'category', label: 'Catégorie', kind: 'text' },
          { key: 'amount', label: 'Montant', kind: 'money' },
        ],
        rows: rows.map((row) => ({ date: row.date, label: row.label, category: row.category.name, amount: row.amount })),
        totals: { date: 'Total', label: '', category: '', amount: sum(rows.map((row) => row.amount)) },
      };
    },
    async receivables() {
      const debts = await db.debt.findMany({ include: { sale: { select: { number: true, netTotal: true, netPaid: true } }, customer: { select: { name: true } } } });
      const rows = debts
        .filter((debt) => debt.sale.netTotal > debt.sale.netPaid)
        .map((debt) => ({
          customer: debt.customer.name,
          sale: debt.sale.number,
          due: debt.dueDate ?? '',
          total: debt.sale.netTotal,
          paid: debt.sale.netPaid,
          remaining: debt.sale.netTotal - debt.sale.netPaid,
        }));
      return {
        title: 'Créances clients',
        columns: [
          { key: 'customer', label: 'Client', kind: 'text' },
          { key: 'sale', label: 'Vente', kind: 'text' },
          { key: 'due', label: 'Échéance', kind: 'text' },
          { key: 'total', label: 'Total', kind: 'money' },
          { key: 'paid', label: 'Payé', kind: 'money' },
          { key: 'remaining', label: 'Restant', kind: 'money' },
        ],
        rows,
        totals: { customer: 'Total', sale: '', due: '', total: sum(rows.map((row) => row.total)), paid: sum(rows.map((row) => row.paid)), remaining: sum(rows.map((row) => row.remaining)) },
      };
    },
    async stock() {
      const variants = await db.productVariant.findMany({
        where: { archivedAt: null, product: { archivedAt: null } },
        include: { product: { include: { unit: true } }, stockLevels: true },
      });
      const rows = variants
        .map((variant) => {
          const quantity = sum(variant.stockLevels.map((level) => level.quantity));
          return {
            product: [variant.product.name, variant.label].filter(Boolean).join(' '),
            unit: variant.product.unit.symbol,
            quantity,
            value: costOf(quantity > 0n ? quantity : 0n, variant.purchasePrice),
          };
        })
        .sort((a, b) => a.product.localeCompare(b.product, 'fr'));
      return {
        title: 'État des stocks',
        columns: [
          { key: 'product', label: 'Produit', kind: 'text' },
          { key: 'unit', label: 'Unité', kind: 'text' },
          { key: 'quantity', label: 'Quantité', kind: 'quantity' },
          { key: 'value', label: "Valeur d'achat", kind: 'money' },
        ],
        rows,
        totals: { product: 'Total', unit: '', quantity: '', value: sum(rows.map((row) => row.value)) },
      };
    },
    margins: (period) => byProduct(period, 'Marges estimées', false),
    async cash(period) {
      const sessions = await db.cashSession.findMany({ where: { openedAt: inPeriod(period), closedAt: { not: null } }, orderBy: { openedAt: 'asc' } });
      const rows = sessions.map((session) => ({
        opened: new Date(session.openedAt).toLocaleString('fr-FR'),
        closed: new Date(session.closedAt!).toLocaleString('fr-FR'),
        float: session.openingFloat,
        expected: session.expected ?? 0n,
        counted: session.counted ?? 0n,
        difference: (session.counted ?? 0n) - (session.expected ?? 0n),
      }));
      return {
        title: 'Résultats de caisse',
        columns: [
          { key: 'opened', label: 'Ouverture', kind: 'text' },
          { key: 'closed', label: 'Fermeture', kind: 'text' },
          { key: 'float', label: 'Solde initial', kind: 'money' },
          { key: 'expected', label: 'Attendu', kind: 'money' },
          { key: 'counted', label: 'Compté', kind: 'money' },
          { key: 'difference', label: 'Écart', kind: 'money' },
        ],
        rows,
        totals: null,
      };
    },
  };

  return {
    async run(kind: ReportKind, period: Period): Promise<Report> {
      if (kind === 'margins') requirePermission('view_profit');
      const report = await reports[kind](period);
      if (hasPermission('view_profit')) return report;
      // Sans ce droit, la marge disparaît du résultat, pas seulement de l'écran.
      const strip = <T extends Record<string, unknown>>(row: T) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'margin')) as T;
      return { ...report, columns: report.columns.filter((column) => column.key !== 'margin'), rows: report.rows.map(strip), totals: report.totals ? strip(report.totals) : null };
    },

    async dashboard(period: Period): Promise<Dashboard> {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const sales = await loadSales(period);
      const revenue = sum(sales.map((sale) => sale.netTotal));
      const margin = revenue - sum(sales.map((sale) => sale.cost));
      const expenses = await expensesTotal(period);
      const collections = (await db.salePayment.aggregate({ where: { occurredAt: inPeriod(period) }, _sum: { amount: true } }))._sum.amount ?? 0n;
      const days = (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000;
      const bucket = days > 62 ? monthLabel : (date: Date) => localDate(date);
      const trend = [...groupRows(sales, (sale) => bucket(new Date(sale.occurredAt))).entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([label, group]) => ({ label, revenue: sum(group.map((sale) => sale.netTotal)) }));
      const recent = await db.sale.findMany({ orderBy: { occurredAt: 'desc' }, take: 8, include: { customer: { select: { name: true } } } });
      const canSeeProfit = hasPermission('view_profit');
      return {
        revenue,
        revenueToday: await revenueOf({ from: startOfDay.toISOString(), to: now.toISOString() }),
        revenueMonth: await revenueOf({ from: startOfMonth.toISOString(), to: now.toISOString() }),
        collections,
        salesCount: sales.filter((sale) => sale.status !== 'CANCELLED').length,
        margin: canSeeProfit ? margin : null,
        expenses,
        profit: canSeeProfit ? margin - expenses : null,
        receivables: await receivablesTotal(),
        lowStock: (await lowStock()).slice(0, 10),
        recentSales: recent.map((sale) => ({
          id: sale.id,
          number: sale.number,
          status: sale.status,
          customerName: sale.customer?.name ?? null,
          netTotal: sale.netTotal,
          netPaid: sale.netPaid,
          occurredAt: sale.occurredAt,
        })),
        trend,
      };
    },

    async getHidden(): Promise<string[]> {
      const setting = await db.setting.findUnique({ where: { key: HIDDEN_KEY } });
      return setting ? (JSON.parse(setting.value) as string[]) : [];
    },

    async setHidden(hidden: string[]): Promise<string[]> {
      const value = JSON.stringify(hidden);
      await db.setting.upsert({ where: { key: HIDDEN_KEY }, create: { key: HIDDEN_KEY, value }, update: { value } });
      return hidden;
    },

    log,
  };
}
