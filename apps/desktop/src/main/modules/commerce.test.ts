import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, migrate, verifyAuditChain, type PrismaClient } from '@gestion/db-local';
import { newId } from '@gestion/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCatalogService } from './catalog.service';
import { createCompanyService } from './company.service';
import { createCustomersService } from './customers.service';
import { createSalesService } from './sales.service';
import { createStockService } from './stock.service';

const KEY = 'd'.repeat(64);
const Q = (units: number) => BigInt(units) * 1000n;
let dir: string;
let db: PrismaClient;
let company: ReturnType<typeof createCompanyService>;
let catalog: ReturnType<typeof createCatalogService>;
let stock: ReturnType<typeof createStockService>;
let customers: ReturnType<typeof createCustomersService>;
let sales: ReturnType<typeof createSalesService>;
let unitId: string;
let categoryId: string;
let cashId: string;

async function makeProduct(options: { name?: string; qty?: number; price?: bigint; cost?: bigint; serial?: boolean; barcode?: string | null; tax?: number } = {}) {
  const product = await catalog.save({
    id: null,
    name: options.name ?? 'Savon',
    reference: null,
    categoryId,
    unitId,
    taxRateBp: options.tax ?? 0,
    trackSerial: options.serial ?? false,
    lowStockThreshold: null,
    attributes: {},
    variants: [{ id: null, label: '', sku: null, barcode: options.barcode ?? null, purchasePrice: options.cost ?? 600n, salePrice: options.price ?? 1000n, initialQuantity: options.serial ? 0n : Q(options.qty ?? 10) }],
  });
  return product.variants[0]!.id;
}

const sell = (variantId: string, overrides: Partial<Parameters<typeof sales.create>[0]> = {}, qty = 1, paid: bigint | null = 1000n) =>
  sales.create({
    id: newId(),
    customerId: null,
    cartDiscount: 0n,
    dueDate: null,
    lines: [{ variantId, quantity: Q(qty), lineDiscount: 0n, unitPrice: null, serialIds: [] }],
    payments: paid ? [{ methodId: cashId, amount: paid }] : [],
    ...overrides,
  });

const stockOf = async (variantId: string) => (await db.stockLevel.findFirstOrThrow({ where: { variantId } })).quantity;
const movementSum = async (variantId: string) => (await db.stockMovement.aggregate({ where: { variantId }, _sum: { quantity: true } }))._sum.quantity ?? 0n;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gestion-com-'));
  const databasePath = join(dir, 'a.db');
  migrate({ databasePath, encryptionKey: KEY, migrationsDir: resolve(import.meta.dirname, '../../../../../packages/db-local/prisma/migrations'), backupDir: join(dir, 'b') });
  db = createClient(databasePath, KEY);
  const context = { db, deviceId: '01a18d21-c867-717d-a7ea-8ff30202abcd' };
  company = createCompanyService(context);
  catalog = createCatalogService(context);
  stock = createStockService(context);
  customers = createCustomersService(context);
  sales = createSalesService(context);
  await company.completeSetup({
    company: { name: 'T', logoData: null, address: 'L', phone: '+22890000000', email: null, currency: 'XOF', taxInfo: null },
    sector: 'general',
    categories: ['Divers'],
    units: [{ name: 'Pièce', symbol: 'pce', allowsDecimal: false }, { name: 'Kilo', symbol: 'kg', allowsDecimal: true }],
    attributes: [],
    paymentMethods: ['Espèces', 'Flooz'],
    stock: { allowOutOfStockSales: false, lowStockThreshold: 3 },
    owner: { name: 'Patron', login: 'patron', password: 'motdepasse' },
  });
  unitId = (await company.listUnits()).find((unit) => unit.name === 'Pièce')!.id;
  categoryId = (await company.listCategories())[0]!.id;
  cashId = (await company.listPaymentMethods())[0]!.id;
});
afterEach(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('produits', () => {
  it('impose les caractéristiques obligatoires et valide leur type', async () => {
    const required = await company.saveAttribute({ id: null, name: 'IMEI', type: 'TEXT', required: true, options: [], categoryIds: [categoryId] });
    const ram = await company.saveAttribute({ id: null, name: 'RAM', type: 'NUMBER', required: false, options: [], categoryIds: [categoryId] });
    const base = { id: null, name: 'Tel', reference: null, categoryId, unitId, taxRateBp: 0, trackSerial: false, lowStockThreshold: null, variants: [{ id: null, label: '', sku: null, barcode: null, purchasePrice: 1n, salePrice: 2n, initialQuantity: 0n }] };
    await expect(catalog.save({ ...base, attributes: {} })).rejects.toThrow(/obligatoire/);
    await expect(catalog.save({ ...base, attributes: { [required.id]: 'x', [ram.id]: 'abc' } })).rejects.toThrow(/nombre/);
    const saved = await catalog.save({ ...base, attributes: { [required.id]: 'x', [ram.id]: '8' } });
    expect(saved.attributes[ram.id]).toBe('8');
    await expect(company.saveAttribute({ ...ram, type: 'TEXT', id: ram.id })).rejects.toThrow(/type ne peut plus/);
  });

  it('refuse un code-barres déjà pris et signale le stock faible', async () => {
    await makeProduct({ name: 'A', barcode: '123', qty: 2 });
    await expect(makeProduct({ name: 'B', barcode: '123' })).rejects.toThrow(/déjà utilisé/);
    const [low] = await catalog.list({ search: '', categoryId: null, archived: false, lowOnly: true });
    expect(low?.name).toBe('A');
  });

  it('trouve par nom sans accents, référence et code-barres', async () => {
    await makeProduct({ name: 'Téléphone Écran', barcode: '999' });
    expect((await catalog.posSearch('telephone'))[0]?.productName).toBe('Téléphone Écran');
    const [exact] = await catalog.posSearch('999');
    expect(exact?.exactMatch).toBe(true);
    expect(await catalog.posSearch('   ')).toEqual([]);
  });

  it('un produit archivé n’est plus vendable, mais reste historisé', async () => {
    const variantId = await makeProduct();
    const product = await db.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    await catalog.setArchived(product.productId, true);
    await expect(sell(variantId)).rejects.toThrow(/plus disponible/);
    expect(await catalog.posSearch('savon')).toEqual([]);
  });

  it('recherche vite sur un grand catalogue', async () => {
    const data = Array.from({ length: 50_000 }, (_, index) => ({ id: newId(), name: `Produit ${index}`, searchText: `produit ${index}`, unitId, categoryId }));
    await db.product.createMany({ data });
    await db.productVariant.createMany({ data: data.map((row) => ({ id: newId(), productId: row.id, purchasePrice: 1n, salePrice: 2n })) });
    const start = performance.now();
    const results = await catalog.posSearch('produit 4999');
    expect(results.length).toBeGreaterThan(0);
    expect(performance.now() - start).toBeLessThan(500);
  }, 60_000);
});

describe('ventes', () => {
  it('enregistre vente, stock, paiement et journal ensemble', async () => {
    const variantId = await makeProduct();
    const sale = await sell(variantId, {}, 2, 2000n);
    expect(sale.netTotal).toBe(2000n);
    expect(await stockOf(variantId)).toBe(Q(8));
    expect(await movementSum(variantId)).toBe(Q(8));
    expect(await db.salePayment.count()).toBe(1);
    expect(await verifyAuditChain(db)).toBe(true);
    expect(sale.number).toMatch(/^V-ABCD-000001$/);
  });

  it('refuse une vente sans stock, sans rien écrire', async () => {
    const variantId = await makeProduct({ qty: 1 });
    await expect(sell(variantId, {}, 2, 2000n)).rejects.toThrow(/Stock insuffisant/);
    expect(await db.sale.count()).toBe(0);
    expect(await stockOf(variantId)).toBe(Q(1));
    expect(await db.setting.findUnique({ where: { key: 'sale.sequence' } })).toBeNull();
  });

  it('contrôle le cumul quand un article figure sur deux lignes', async () => {
    const variantId = await makeProduct({ qty: 1 });
    const line = { variantId, quantity: Q(1), lineDiscount: 0n, unitPrice: null, serialIds: [] };
    await expect(sell(variantId, { lines: [line, line] }, 1, 2000n)).rejects.toThrow(/Stock insuffisant/);
  });

  it('autorise le hors stock uniquement si le propriétaire l’a choisi', async () => {
    const variantId = await makeProduct({ qty: 0 });
    await company.saveStockSettings({ allowOutOfStockSales: true, lowStockThreshold: 3 });
    await sell(variantId);
    expect(await stockOf(variantId)).toBe(Q(-1));
  });

  it('ne crée pas deux ventes si la même est renvoyée', async () => {
    const variantId = await makeProduct();
    const id = newId();
    const first = await sell(variantId, { id });
    const second = await sell(variantId, { id });
    expect(second.id).toBe(first.id);
    expect(await db.sale.count()).toBe(1);
    expect(await stockOf(variantId)).toBe(Q(9));
  });

  it('exige un client pour le crédit et crée la dette', async () => {
    const variantId = await makeProduct();
    await expect(sell(variantId, {}, 1, 400n)).rejects.toThrow(/client/);
    const customer = await customers.save({ id: null, name: 'Afi', phone: null, whatsapp: null, address: null });
    await sell(variantId, { customerId: customer.id, dueDate: '2026-12-01' }, 1, 400n);
    expect(await db.debt.count()).toBe(1);
    expect((await customers.get(customer.id)).balance).toBe(600n);
  });

  it('refuse un trop-perçu et une remise excessive', async () => {
    const variantId = await makeProduct();
    await expect(sell(variantId, {}, 1, 1500n)).rejects.toThrow(/dépasse le total/);
    await expect(sell(variantId, { cartDiscount: 2000n }, 1, null)).rejects.toThrow(/remise/i);
  });

  it('refuse une fraction pour une unité entière', async () => {
    const variantId = await makeProduct();
    await expect(sell(variantId, { lines: [{ variantId, quantity: 1500n, lineDiscount: 0n, unitPrice: null, serialIds: [] }] })).rejects.toThrow(/unité entière/);
  });

  it('fige prix et coût : modifier le produit ne change pas la vente', async () => {
    const variantId = await makeProduct();
    const sale = await sell(variantId);
    const variant = await db.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    await db.productVariant.update({ where: { id: variant.id }, data: { salePrice: 9999n, purchasePrice: 9999n } });
    const line = await db.saleLine.findFirstOrThrow({ where: { saleId: sale.id } });
    expect([line.unitPrice, line.unitCost]).toEqual([1000n, 600n]);
  });

  it('interdit de supprimer une vente ou un paiement', async () => {
    const variantId = await makeProduct();
    const sale = await sell(variantId);
    await expect(db.sale.delete({ where: { id: sale.id } })).rejects.toThrow();
    await expect(db.salePayment.deleteMany()).rejects.toThrow();
    await expect(db.stockMovement.deleteMany()).rejects.toThrow();
  });
});

describe('numéros de série', () => {
  it('suit chaque unité de l’entrée à la vente et au retour', async () => {
    const variantId = await makeProduct({ serial: true });
    await stock.move({ variantId, direction: 'IN', quantity: Q(2), unitCost: null, reason: 'Achat', serials: ['IMEI1', 'IMEI2'] });
    await expect(stock.move({ variantId, direction: 'IN', quantity: Q(1), unitCost: null, reason: 'Achat', serials: ['IMEI1'] })).rejects.toThrow(/déjà en stock/);
    await expect(sell(variantId)).rejects.toThrow(/numéro de série/);
    const [first] = await stock.availableSerials(variantId);

    const [found] = await catalog.posSearch('IMEI1');
    expect(found?.matchedSerialId).toBe(first!.id);

    const line = { variantId, quantity: Q(1), lineDiscount: 0n, unitPrice: null, serialIds: [first!.id] };
    const sale = await sell(variantId, { lines: [line] });
    expect((await stock.availableSerials(variantId)).map((row) => row.serial)).toEqual(['IMEI2']);
    await expect(sell(variantId, { lines: [line] })).rejects.toThrow(/plus disponible/);

    const detail = await sales.detail(sale.id);
    await sales.returnItems({ saleId: sale.id, reason: 'Défaut', refundMethodId: cashId, lines: [{ saleLineId: detail.lines[0]!.id, quantity: Q(1), restock: true, serialIds: [first!.id] }] });
    expect(await stock.availableSerials(variantId)).toHaveLength(2);
  });
});

describe('retours et annulations', () => {
  it('rembourse, remet en stock et garde l’historique', async () => {
    const variantId = await makeProduct();
    const sale = await sell(variantId, {}, 3, 3000n);
    const { lines } = await sales.detail(sale.id);
    const after = await sales.returnItems({ saleId: sale.id, reason: 'Erreur', refundMethodId: cashId, lines: [{ saleLineId: lines[0]!.id, quantity: Q(1), restock: true, serialIds: [] }] });
    expect(after.netTotal).toBe(2000n);
    expect(after.netPaid).toBe(2000n);
    expect(after.payments.map((payment) => payment.amount)).toEqual([3000n, -1000n]);
    expect(await stockOf(variantId)).toBe(Q(8));
    await expect(sales.returnItems({ saleId: sale.id, reason: 'x', refundMethodId: cashId, lines: [{ saleLineId: lines[0]!.id, quantity: Q(3), restock: true, serialIds: [] }] })).rejects.toThrow(/trop élevée/);
  });

  it('un article défectueux ne revient pas en stock', async () => {
    const variantId = await makeProduct();
    const sale = await sell(variantId);
    const { lines } = await sales.detail(sale.id);
    await sales.returnItems({ saleId: sale.id, reason: 'Cassé', refundMethodId: cashId, lines: [{ saleLineId: lines[0]!.id, quantity: Q(1), restock: false, serialIds: [] }] });
    expect(await stockOf(variantId)).toBe(Q(9));
  });

  it('un retour sur crédit réduit la dette avant de rembourser', async () => {
    const variantId = await makeProduct();
    const customer = await customers.save({ id: null, name: 'Afi', phone: null, whatsapp: null, address: null });
    const sale = await sell(variantId, { customerId: customer.id }, 2, 500n);
    const { lines } = await sales.detail(sale.id);
    const after = await sales.returnItems({ saleId: sale.id, reason: 'R', refundMethodId: null, lines: [{ saleLineId: lines[0]!.id, quantity: Q(1), restock: true, serialIds: [] }] });
    expect([after.netTotal, after.netPaid]).toEqual([1000n, 500n]);
    expect((await customers.get(customer.id)).balance).toBe(500n);
  });

  it('exige le mode de remboursement si de l’argent est rendu', async () => {
    const variantId = await makeProduct();
    const sale = await sell(variantId);
    await expect(sales.cancel({ saleId: sale.id, reason: 'x', refundMethodId: null })).rejects.toThrow(/remboursement/);
    expect((await sales.detail(sale.id)).status).toBe('COMPLETED');
    expect(await stockOf(variantId)).toBe(Q(9));
  });

  it('annule une fois, après un retour partiel, sans doubler le stock', async () => {
    const variantId = await makeProduct();
    const sale = await sell(variantId, {}, 2, 2000n);
    const { lines } = await sales.detail(sale.id);
    await sales.returnItems({ saleId: sale.id, reason: 'R', refundMethodId: cashId, lines: [{ saleLineId: lines[0]!.id, quantity: Q(1), restock: true, serialIds: [] }] });
    const cancelled = await sales.cancel({ saleId: sale.id, reason: 'Annulée', refundMethodId: cashId });
    expect([cancelled.status, cancelled.netTotal, cancelled.netPaid]).toEqual(['CANCELLED', 0n, 0n]);
    expect(await stockOf(variantId)).toBe(Q(10));
    await expect(sales.cancel({ saleId: sale.id, reason: 'x', refundMethodId: cashId })).rejects.toThrow(/déjà annulée/);
  });
});

describe('stock et inventaire', () => {
  it('ne compte pas deux fois une vente faite avant le comptage de l’article', async () => {
    const variantId = await makeProduct({ qty: 10 });
    const count = (await stock.startInventory())!;
    await sell(variantId);
    const line = await db.inventoryCountLine.findFirstOrThrow({ where: { countId: count.id, variantId } });
    await stock.setCounted(line.id, Q(9));
    expect(await stock.closeInventory()).toEqual({ adjusted: 0 });
    expect(await stockOf(variantId)).toBe(Q(9));
  });

  it('refuse une sortie sans stock et garde cache et mouvements cohérents', async () => {
    const variantId = await makeProduct({ qty: 2 });
    await expect(stock.move({ variantId, direction: 'OUT', quantity: Q(3), unitCost: null, reason: 'Perte', serials: [] })).rejects.toThrow(/insuffisant/);
    await stock.move({ variantId, direction: 'OUT', quantity: Q(1), unitCost: null, reason: 'Perte', serials: [] });
    await stock.move({ variantId, direction: 'IN', quantity: Q(5), unitCost: 700n, reason: 'Achat', serials: [] });
    expect(await stockOf(variantId)).toBe(Q(6));
    expect(await movementSum(variantId)).toBe(Q(6));
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).purchasePrice).toBe(700n);
  });

  it('ajuste l’écart de comptage sans perdre une vente faite pendant l’inventaire', async () => {
    const variantId = await makeProduct({ qty: 10 });
    const other = await makeProduct({ name: 'Autre', qty: 4 });
    const count = (await stock.startInventory())!;
    await expect(stock.startInventory()).rejects.toThrow(/déjà en cours/);
    const lineOf = async (id: string) => db.inventoryCountLine.findFirstOrThrow({ where: { countId: count.id, variantId: id } });
    await stock.setCounted((await lineOf(variantId)).id, Q(7));
    await sell(variantId);
    expect(await stock.closeInventory()).toEqual({ adjusted: 1 });
    // 10 attendus, 7 comptés avant la vente, 1 vendu ensuite : 6 en rayon.
    expect(await stockOf(variantId)).toBe(Q(6));
    expect(await movementSum(variantId)).toBe(Q(6));
    expect(await stockOf(other)).toBe(Q(4));
    expect(await stock.currentInventory()).toBeNull();
  });
});
