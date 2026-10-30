import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, migrate, verifyAuditChain, type PrismaClient } from '@gestion/db-local';
import { newId } from '@gestion/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { protectFormula, reportToCsv, reportToHtml, reportToXlsx } from '../services/exporter';
import { createCatalogService } from './catalog.service';
import { createCompanyService } from './company.service';
import { createCustomersService } from './customers.service';
import { createFinanceService, localDate } from './finance.service';
import { createReportsService } from './reports.service';
import { createSalesService } from './sales.service';

const KEY = 'e'.repeat(64);
const Q = (units: number) => BigInt(units) * 1000n;
let dir: string;
let db: PrismaClient;
let finance: ReturnType<typeof createFinanceService>;
let reports: ReturnType<typeof createReportsService>;
let sales: ReturnType<typeof createSalesService>;
let customers: ReturnType<typeof createCustomersService>;
let variantId: string;
let cashId: string;
let floozId: string;

const period = () => ({ from: new Date(Date.now() - 86_400_000).toISOString(), to: new Date(Date.now() + 86_400_000).toISOString() });

function sell(qty: number, paid: bigint, method = cashId, customerId: string | null = null, dueDate: string | null = null) {
  return sales.create({
    id: newId(),
    customerId,
    cartDiscount: 0n,
    dueDate,
    lines: [{ variantId, quantity: Q(qty), lineDiscount: 0n, unitPrice: null, serialIds: [] }],
    payments: paid ? [{ methodId: method, amount: paid }] : [],
  });
}

async function creditSale(total = 2, paid = 500n, dueDate: string | null = null) {
  const customer = await customers.save({ id: null, name: 'Afi', phone: null, whatsapp: null, address: null });
  await sell(total, paid, cashId, customer.id, dueDate);
  return (await finance.listDebts({ openOnly: true, customerId: customer.id }))[0]!;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gestion-fin-'));
  const databasePath = join(dir, 'a.db');
  migrate({ databasePath, encryptionKey: KEY, migrationsDir: resolve(import.meta.dirname, '../../../../../packages/db-local/prisma/migrations'), backupDir: join(dir, 'b') });
  db = createClient(databasePath, KEY);
  const context = { db, deviceId: 'poste-abcd' };
  const company = createCompanyService(context);
  const catalog = createCatalogService(context);
  finance = createFinanceService(context);
  reports = createReportsService(context);
  sales = createSalesService(context);
  customers = createCustomersService(context);
  await company.completeSetup({
    company: { name: 'T', logoData: null, address: 'L', phone: '+22890000000', email: null, currency: 'XOF', taxInfo: null },
    sector: 'general',
    categories: ['Divers'],
    units: [{ name: 'Pièce', symbol: 'pce', allowsDecimal: false }],
    attributes: [],
    paymentMethods: ['Espèces', 'Flooz'],
    stock: { allowOutOfStockSales: false, lowStockThreshold: 3 },
    owner: { name: 'Patron', login: 'patron', password: 'motdepasse' },
  });
  const methods = await company.listPaymentMethods();
  cashId = methods.find((method) => method.isCash)!.id;
  floozId = methods.find((method) => !method.isCash)!.id;
  const unitId = (await company.listUnits())[0]!.id;
  const product = await catalog.save({
    id: null, name: 'Savon', reference: null, categoryId: null, unitId, taxRateBp: 0, trackSerial: false, lowStockThreshold: null, attributes: {},
    variants: [{ id: null, label: '', sku: null, barcode: null, purchasePrice: 600n, salePrice: 1000n, initialQuantity: Q(20) }],
  });
  variantId = product.variants[0]!.id;
});
afterEach(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('dettes', () => {
  it('accepte des paiements fractionnés jusqu’au solde, en gardant l’historique', async () => {
    const debt = await creditSale();
    expect([debt.total, debt.paid, debt.remaining, debt.status]).toEqual([2000n, 500n, 1500n, 'PARTIAL']);
    const after = await finance.payDebt({ id: newId(), debtId: debt.id, amount: 1000n, methodId: floozId });
    expect(after.remaining).toBe(500n);
    await expect(finance.payDebt({ id: newId(), debtId: debt.id, amount: 501n, methodId: cashId })).rejects.toThrow(/dépasse/);
    const last = await finance.payDebt({ id: newId(), debtId: debt.id, amount: 500n, methodId: cashId });
    expect(last.status).toBe('PAID');
    expect(await finance.listDebts({ openOnly: true, customerId: null })).toEqual([]);
    const detail = await sales.detail(debt.saleId);
    expect(detail.payments.map((payment) => payment.kind)).toEqual(['PAYMENT', 'DEBT_PAYMENT', 'DEBT_PAYMENT']);
    await expect(db.salePayment.deleteMany()).rejects.toThrow();
  });

  it('n’encaisse pas deux fois le même paiement', async () => {
    const debt = await creditSale();
    const id = newId();
    await finance.payDebt({ id, debtId: debt.id, amount: 100n, methodId: cashId });
    const again = await finance.payDebt({ id, debtId: debt.id, amount: 100n, methodId: cashId });
    expect(again.paid).toBe(600n);
    expect(await db.salePayment.count({ where: { kind: 'DEBT_PAYMENT' } })).toBe(1);
  });

  it('passe en retard après l’échéance et suit un retour', async () => {
    const debt = await creditSale(2, 0n, '2020-01-01');
    expect(debt.status).toBe('OVERDUE');
    await finance.setDueDate(debt.id, '2999-01-01');
    expect((await finance.listDebts({ openOnly: true, customerId: null }))[0]?.status).toBe('PENDING');
    const { lines } = await sales.detail(debt.saleId);
    await sales.returnItems({ saleId: debt.saleId, reason: 'R', refundMethodId: null, lines: [{ saleLineId: lines[0]!.id, quantity: Q(1), restock: true, serialIds: [] }] });
    expect((await finance.listDebts({ openOnly: true, customerId: null }))[0]?.remaining).toBe(1000n);
  });
});

describe('caisse', () => {
  it('calcule l’attendu et l’écart', async () => {
    await finance.openCash(10_000n);
    await expect(finance.openCash(1n)).rejects.toThrow(/déjà ouverte/);
    await sell(2, 2000n);           // espèces : compte
    await sell(1, 1000n, floozId);  // mobile money : hors tiroir
    await finance.moveCash({ type: 'IN', amount: 500n, reason: 'Apport' });
    await finance.moveCash({ type: 'WITHDRAWAL', amount: 1500n, reason: 'Banque' });
    const open = (await finance.currentCash())!;
    expect(open.expected).toBe(11_000n);
    const closed = await finance.closeCash({ counted: 10_900n, note: null });
    expect([closed.expected, closed.counted, closed.difference]).toEqual([11_000n, 10_900n, -100n]);
    expect(await finance.currentCash()).toBeNull();
    await expect(finance.moveCash({ type: 'IN', amount: 1n, reason: 'x' })).rejects.toThrow(/Ouvrez/);
  });

  it('refuse de retirer plus que le tiroir', async () => {
    await finance.openCash(1000n);
    await expect(finance.moveCash({ type: 'OUT', amount: 1001n, reason: 'x' })).rejects.toThrow(/dépasse/);
  });

  it('une clôture reste figée après une vente ultérieure', async () => {
    await finance.openCash(0n);
    await sell(1, 1000n);
    const closed = await finance.closeCash({ counted: 1000n, note: null });
    await sell(1, 1000n);
    const [history] = await finance.cashHistory(5);
    expect(history?.expected).toBe(closed.expected);
    expect(history?.difference).toBe(0n);
  });

  it('une dépense prise en caisse exige une caisse ouverte et réduit l’attendu', async () => {
    const [category] = await finance.listExpenseCategories();
    const input = { label: 'Taxi', categoryId: category!.id, amount: 300n, date: localDate(), comment: null, paidFromCash: true };
    await expect(finance.createExpense(input)).rejects.toThrow(/Ouvrez/);
    expect(await db.expense.count()).toBe(0);
    await finance.openCash(1000n);
    await finance.createExpense(input);
    expect((await finance.currentCash())!.expected).toBe(700n);
  });
});

describe('annulation de dépense', () => {
  it('remet l’argent dans le tiroir ouvert', async () => {
    const [category] = await finance.listExpenseCategories();
    await finance.openCash(1000n);
    const expense = await finance.createExpense({ label: 'Taxi', categoryId: category!.id, amount: 300n, date: localDate(), comment: null, paidFromCash: true });
    await finance.voidExpense(expense.id, 'Erreur');
    expect((await finance.currentCash())!.expected).toBe(1000n);
    await expect(finance.voidExpense(expense.id, 'Encore')).rejects.toThrow(/déjà annulée/);
  });
});

describe('tableau de bord', () => {
  it('distingue chiffre d’affaires, encaissements, marge et bénéfice sur un cas calculé à la main', async () => {
    const debt = await creditSale(2, 500n);      // CA 2000, encaissé 500, coût 1200
    await sell(1, 1000n, floozId);               // CA 1000, encaissé 1000, coût 600
    const [category] = await finance.listExpenseCategories();
    await finance.createExpense({ label: 'Loyer', categoryId: category!.id, amount: 400n, date: localDate(), comment: null, paidFromCash: false });
    await finance.payDebt({ id: newId(), debtId: debt.id, amount: 200n, methodId: cashId }); // encaissé 200
    const dash = await reports.dashboard(period());
    expect(dash.revenue).toBe(3000n);
    expect(dash.collections).toBe(1700n);
    expect(dash.margin).toBe(1200n);
    expect(dash.expenses).toBe(400n);
    expect(dash.profit).toBe(800n);
    expect(dash.receivables).toBe(1300n);
    expect(dash.salesCount).toBe(2);
    expect(dash.revenueToday).toBe(3000n);
    expect(dash.trend.reduce((total, point) => total + point.revenue, 0n)).toBe(3000n);
  });

  it('retire retours et annulations, et ignore les dépenses annulées', async () => {
    const sale = await sell(3, 3000n);
    const { lines } = await sales.detail(sale.id);
    await sales.returnItems({ saleId: sale.id, reason: 'R', refundMethodId: cashId, lines: [{ saleLineId: lines[0]!.id, quantity: Q(1), restock: true, serialIds: [] }] });
    const cancelled = await sell(1, 1000n);
    await sales.cancel({ saleId: cancelled.id, reason: 'C', refundMethodId: cashId });
    const [category] = await finance.listExpenseCategories();
    const expense = await finance.createExpense({ label: 'X', categoryId: category!.id, amount: 100n, date: localDate(), comment: null, paidFromCash: false });
    await finance.voidExpense(expense.id, 'Erreur');
    const dash = await reports.dashboard(period());
    expect([dash.revenue, dash.margin, dash.collections, dash.expenses, dash.salesCount]).toEqual([2000n, 800n, 2000n, 0n, 1]);
  });

  it('une période vide donne des zéros', async () => {
    await sell(1, 1000n);
    const past = { from: '2001-01-01T00:00:00.000Z', to: '2001-01-02T00:00:00.000Z' };
    const dash = await reports.dashboard(past);
    expect([dash.revenue, dash.collections, dash.profit]).toEqual([0n, 0n, 0n]);
    expect(dash.trend).toEqual([]);
  });
});

describe('rapports', () => {
  it('produit chaque rapport, avec des totaux cohérents', async () => {
    await creditSale(2, 500n);
    await sell(1, 1000n);
    for (const kind of ['dailySales', 'monthlySales', 'salesByEmployee', 'salesByProduct', 'topProducts', 'expenses', 'receivables', 'stock', 'margins', 'cash'] as const) {
      const report = await reports.run(kind, period());
      expect(report.title.length).toBeGreaterThan(0);
    }
    const daily = await reports.run('dailySales', period());
    expect(daily.totals?.['revenue']).toBe(3000n);
    expect(daily.totals?.['margin']).toBe(1200n);
    const stock = await reports.run('stock', period());
    expect(stock.rows[0]?.['quantity']).toBe(Q(17));
    expect(stock.totals?.['value']).toBe(10_200n);
    expect((await reports.run('receivables', period())).totals?.['remaining']).toBe(1500n);
  });

  it('exporte sans exécution de formule ni injection', async () => {
    expect(protectFormula('=HYPERLINK("x")')).toBe(`'=HYPERLINK("x")`);
    expect(protectFormula('Savon')).toBe('Savon');
    const report = {
      title: 'Test', columns: [{ key: 'a', label: 'Nom', kind: 'text' as const }, { key: 'b', label: 'Montant', kind: 'money' as const }],
      rows: [{ a: '=1+1', b: 2500n }, { a: '<img src=x>;"', b: 1n }], totals: { a: 'Total', b: 2501n },
    };
    const csv = reportToCsv(report, 'XOF');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(`"'=1+1";2 500 FCFA`);
    expect(csv).toContain('"<img src=x>;"""');
    const html = reportToHtml(report, 'XOF', 'Boutique', 'Octobre');
    expect(html).not.toContain('<img');
    const xlsx = await reportToXlsx(report, 'XOF');
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
  });
});

describe('journal', () => {
  it('reste intègre après des opérations financières', async () => {
    const debt = await creditSale();
    await finance.payDebt({ id: newId(), debtId: debt.id, amount: 100n, methodId: cashId });
    await finance.openCash(0n);
    await finance.closeCash({ counted: 0n, note: null });
    expect(await verifyAuditChain(db)).toBe(true);
  });
});
