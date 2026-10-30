import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, migrate, type PrismaClient } from '@gestion/db-local';
import { newId } from '@gestion/domain';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRecoveryCode } from '../services/backup';
import { createCatalogService } from './catalog.service';
import { createCompanyService } from './company.service';
import { createCustomersService } from './customers.service';
import { createFinanceService } from './finance.service';
import { createSalesService } from './sales.service';
import { createStockService } from './stock.service';
import { createSyncService, RECOVERY_KEY, type Transport } from './sync.service';

const KEY = 'b'.repeat(64);
const CODE = generateRecoveryCode();
const Q = (units: number) => BigInt(units) * 1000n;
const dirs: string[] = [];
const clients: PrismaClient[] = [];

/** Relais en mémoire au comportement du vrai serveur : le test HTTP est dans apps/api. */
function makeRelay() {
  const log: { seq: number; id: string; ciphertext: string; from: string }[] = [];
  const failing = { value: false };
  const transport = (from: string): Transport => ({
    async push(events) {
      if (failing.value) throw new Error('hors ligne');
      for (const event of events) {
        if (!log.some((item) => item.id === event.id)) log.push({ seq: log.length + 1, ...event, from });
      }
    },
    async pull(after) {
      if (failing.value) throw new Error('hors ligne');
      const rows = log.filter((item) => item.seq > Number(after));
      return { events: rows.filter((item) => item.from !== from), cursor: String(rows.at(-1)?.seq ?? after), hasMore: false };
    },
  });
  return { transport, log, failing };
}

async function makeDevice(name: string, relay: ReturnType<typeof makeRelay>) {
  const dir = mkdtempSync(join(tmpdir(), `gestion-sync-${name}-`));
  dirs.push(dir);
  const databasePath = join(dir, 'a.db');
  migrate({ databasePath, encryptionKey: KEY, migrationsDir: resolve(import.meta.dirname, '../../../../../packages/db-local/prisma/migrations'), backupDir: join(dir, 'b') });
  const db = createClient(databasePath, KEY);
  clients.push(db);
  const context = { db, deviceId: `poste-${name}-0000` };
  return {
    db,
    sync: createSyncService({ db, deviceId: context.deviceId, databasePath, encryptionKey: KEY, transport: () => relay.transport(name) }),
    company: createCompanyService(context),
    catalog: createCatalogService(context),
    sales: createSalesService(context),
    customers: createCustomersService(context),
    finance: createFinanceService(context),
    stock: createStockService(context),
  };
}
type Device = Awaited<ReturnType<typeof makeDevice>>;

async function firstDevice(relay: ReturnType<typeof makeRelay>) {
  const device = await makeDevice('a', relay);
  await device.company.completeSetup({
    company: { name: 'T', logoData: null, address: 'L', phone: '+22890000000', email: null, currency: 'XOF', taxInfo: null },
    sector: 'general', categories: ['Divers'], units: [{ name: 'Pièce', symbol: 'pce', allowsDecimal: false }], attributes: [{ name: 'Couleur', type: 'TEXT', required: false, options: [], categoryNames: [] }], paymentMethods: ['Espèces'],
    stock: { allowOutOfStockSales: false, lowStockThreshold: 2 }, owner: { name: 'P', login: 'patron', password: 'motdepasse' },
  });
  await device.db.setting.create({ data: { key: RECOVERY_KEY, value: CODE } });
  const product = await device.catalog.save({
    id: null, name: 'Savon', reference: null, categoryId: null, unitId: (await device.company.listUnits())[0]!.id, taxRateBp: 0, trackSerial: false, lowStockThreshold: null, attributes: {},
    variants: [{ id: null, label: '', sku: null, barcode: null, purchasePrice: 600n, salePrice: 1000n, initialQuantity: Q(10) }],
  });
  return { device, variantId: product.variants[0]!.id };
}
const sell = async (device: Device, variantId: string, qty = 1, paid: bigint | null = null, customerId: string | null = null) => {
  const methodId = (await device.company.listPaymentMethods())[0]!.id;
  const amount = paid ?? BigInt(qty) * 1000n;
  return device.sales.create({ id: newId(), customerId, cartDiscount: 0n, dueDate: null, lines: [{ variantId, quantity: Q(qty), lineDiscount: 0n, unitPrice: null, serialIds: [] }], payments: amount ? [{ methodId, amount }] : [] });
};
const level = async (device: Device, variantId: string) => (await device.db.stockLevel.findFirstOrThrow({ where: { variantId } })).quantity;

let relay: ReturnType<typeof makeRelay>;
beforeEach(() => { relay = makeRelay(); });
afterAll(async () => {
  for (const client of clients) await client.$disconnect();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function pair() {
  const { device: a, variantId } = await firstDevice(relay);
  await a.sync.enable();
  const b = await makeDevice('b', relay);
  await b.sync.join(CODE);
  return { a, b, variantId };
}

describe('nouveau poste', () => {
  it('reçoit toute l’entreprise, chiffrée sur le relais, avec les liens et la connexion', async () => {
    const { a, b, variantId } = await pair();
    expect((await b.company.getCompany()).name).toBe('T');
    expect(await b.db.user.count()).toBe(1);
    expect((await b.catalog.list({ search: 'savon', categoryId: null, archived: false, lowOnly: false }))[0]?.variants[0]?.quantity).toBe(Q(10));
    expect(await level(b, variantId)).toBe(Q(10));
    expect((await b.company.listAttributes())[0]?.categoryIds).toHaveLength(1);
    expect((await b.company.getStockSettings()).lowStockThreshold).toBe(2);
    expect(JSON.stringify(relay.log)).not.toContain('Savon');
    expect(JSON.stringify(relay.log)).not.toContain('patron');
    expect((await a.sync.status()).pending).toBe(0);
  });

  it('refuse un mauvais code et reste vide', async () => {
    const { device: a } = await firstDevice(relay);
    await a.sync.enable();
    const b = await makeDevice('b', relay);
    await expect(b.sync.join(generateRecoveryCode())).rejects.toThrow(/illisibles/);
    expect(await b.db.company.count()).toBe(0);
    expect(await b.db.setting.findUnique({ where: { key: RECOVERY_KEY } })).toBeNull();
  });

  it('refuse d’écraser un poste qui a déjà des données', async () => {
    const { device: a } = await firstDevice(relay);
    await expect(a.sync.join(CODE)).rejects.toThrow(/déjà une entreprise/);
  });
});

describe('ventes hors ligne sur deux postes', () => {
  it('aucune vente n’est perdue et le stock converge exactement', async () => {
    const { a, b, variantId } = await pair();
    relay.failing.value = true;
    await sell(a, variantId, 3);
    await sell(b, variantId, 2);
    await sell(b, variantId, 1);
    expect((await a.sync.run()).lastError).toBe('hors ligne');
    expect((await a.sync.status()).pending).toBeGreaterThan(0);
    relay.failing.value = false;
    await a.sync.run();
    await b.sync.run();
    await a.sync.run();
    for (const device of [a, b]) {
      expect(await device.db.sale.count()).toBe(3);
      expect(await level(device, variantId)).toBe(Q(4));
      const sum = await device.db.stockMovement.aggregate({ where: { variantId }, _sum: { quantity: true } });
      expect(sum._sum.quantity).toBe(Q(4));
    }
  });

  it('un renvoi ne crée aucun doublon', async () => {
    const { a, b, variantId } = await pair();
    await sell(a, variantId, 1);
    await a.sync.run();
    await a.db.setting.update({ where: { key: 'sync.sentSeq' }, data: { value: '0' } });
    await a.sync.run();
    await b.sync.run();
    await b.db.setting.update({ where: { key: 'sync.cursor' }, data: { value: '0' } });
    await b.sync.run();
    expect(await b.db.sale.count()).toBe(1);
    expect(await level(b, variantId)).toBe(Q(9));
    expect(await b.db.salePayment.count()).toBe(1);
  });

  it('survente hors ligne : les deux ventes restent et un conflit est signalé', async () => {
    const { a, b, variantId } = await pair();
    relay.failing.value = true;
    await sell(a, variantId, 8);
    await sell(b, variantId, 8);
    relay.failing.value = false;
    await a.sync.run();
    await b.sync.run();
    await a.sync.run();
    expect(await level(a, variantId)).toBe(Q(-6));
    expect(await level(b, variantId)).toBe(Q(-6));
    expect(await a.db.sale.count()).toBe(2);
    const status = await a.sync.status();
    expect(status.conflicts.some((conflict) => conflict.kind === 'NEGATIVE_STOCK')).toBe(true);
    const resolved = await a.sync.resolveConflict(status.conflicts[0]!.id);
    expect(resolved.conflicts.length).toBe(status.conflicts.length - 1);
  });

  it('même numéro de série vendu sur deux postes : conflit visible', async () => {
    const { device: a } = await firstDevice(relay);
    const unitId = (await a.company.listUnits())[0]!.id;
    const product = await a.catalog.save({
      id: null, name: 'Téléphone', reference: null, categoryId: null, unitId, taxRateBp: 0, trackSerial: true, lowStockThreshold: null, attributes: {},
      variants: [{ id: null, label: '', sku: null, barcode: null, purchasePrice: 1n, salePrice: 1000n, initialQuantity: 0n }],
    });
    const variantId = product.variants[0]!.id;
    await a.stock.move({ variantId, direction: 'IN', quantity: Q(1), unitCost: null, reason: 'x', serials: ['IMEI9'] });
    await a.sync.enable();
    const b = await makeDevice('b', relay);
    await b.sync.join(CODE);
    relay.failing.value = true;
    const methodId = (await a.company.listPaymentMethods())[0]!.id;
    const [serial] = await a.stock.availableSerials(variantId);
    const input = () => ({ id: newId(), customerId: null, cartDiscount: 0n, dueDate: null, lines: [{ variantId, quantity: Q(1), lineDiscount: 0n, unitPrice: null, serialIds: [serial!.id] }], payments: [{ methodId, amount: 1000n }] });
    await a.sales.create(input());
    await b.sales.create(input());
    relay.failing.value = false;
    await a.sync.run();
    await b.sync.run();
    expect((await b.sync.status()).conflicts.some((conflict) => conflict.kind === 'SERIAL_SOLD_TWICE')).toBe(true);
    expect(await b.db.sale.count()).toBe(2);
  });
});

describe('collisions', () => {
  it('deux ventes de même numéro sont conservées, et la vente ne change pas de numéro ensuite', async () => {
    const { a, b, variantId } = await pair();
    relay.failing.value = true;
    await sell(a, variantId);
    await sell(b, variantId);
    relay.failing.value = false;
    await a.sync.run();
    await b.sync.run();
    await a.sync.run();
    for (const device of [a, b]) {
      const numbers = (await device.db.sale.findMany()).map((sale) => sale.number);
      expect(numbers).toHaveLength(2);
      expect(new Set(numbers).size).toBe(2);
    }
  });

  it('un même code-barres sur deux produits ne bloque pas la synchronisation', async () => {
    const { a, b } = await pair();
    const unitId = (await a.company.listUnits())[0]!.id;
    relay.failing.value = true;
    const product = (name: string) => ({ id: null, name, reference: null, categoryId: null, unitId, taxRateBp: 0, trackSerial: false, lowStockThreshold: null, attributes: {}, variants: [{ id: null, label: '', sku: null, barcode: '777', purchasePrice: 1n, salePrice: 2n, initialQuantity: Q(5) }] });
    const onA = await a.catalog.save(product('Produit A'));
    await b.catalog.save(product('Produit B'));
    await sell(a, onA.variants[0]!.id, 1, 2n);
    relay.failing.value = false;
    await a.sync.run();
    const status = await b.sync.run();
    expect(status.lastError).toBeNull();
    expect(status.conflicts.some((conflict) => conflict.kind === 'DUPLICATE_BARCODE')).toBe(true);
    expect(await b.db.product.count()).toBe(3);
    expect(await b.db.sale.count()).toBe(1);
  });
});

describe('opérations réparties', () => {
  it('paiements et retours sur postes différents s’additionnent', async () => {
    const { a, b, variantId } = await pair();
    const customer = await a.customers.save({ id: null, name: 'Afi', phone: null, whatsapp: null, address: null });
    const sale = await sell(a, variantId, 3, 500n, customer.id);
    await a.sync.run();
    await b.sync.run();
    const debt = (await b.finance.listDebts({ openOnly: true, customerId: null }))[0]!;
    expect(debt.remaining).toBe(2500n);
    relay.failing.value = true;
    const methodId = (await a.company.listPaymentMethods())[0]!.id;
    await b.finance.payDebt({ id: newId(), debtId: debt.id, amount: 1000n, methodId });
    const { lines } = await a.sales.detail(sale.id);
    await a.sales.returnItems({ saleId: sale.id, reason: 'R', refundMethodId: null, lines: [{ saleLineId: lines[0]!.id, quantity: Q(1), restock: true, serialIds: [] }] });
    relay.failing.value = false;
    await a.sync.run();
    await b.sync.run();
    await a.sync.run();
    for (const device of [a, b]) {
      const after = (await device.finance.listDebts({ openOnly: true, customerId: null }))[0]!;
      expect([after.total, after.paid, after.remaining]).toEqual([2000n, 1500n, 500n]);
      expect(await level(device, variantId)).toBe(Q(8));
    }
  });

  it('une modification simultanée se résout de la même façon partout, sans boucle', async () => {
    const { a, b, variantId: _variantId } = await pair();
    const customer = await a.customers.save({ id: null, name: 'Ancien', phone: null, whatsapp: null, address: null });
    await a.sync.run();
    await b.sync.run();
    relay.failing.value = true;
    await a.customers.save({ id: customer.id, name: 'Nom A', phone: null, whatsapp: null, address: null });
    await new Promise((done) => setTimeout(done, 5));
    await b.customers.save({ id: customer.id, name: 'Nom B', phone: null, whatsapp: null, address: null });
    relay.failing.value = false;
    await a.sync.run();
    await b.sync.run();
    await a.sync.run();
    const names = await Promise.all([a, b].map((device) => device.db.customer.findUniqueOrThrow({ where: { id: customer.id } })));
    expect(names.map((row) => row.name)).toEqual(['Nom B', 'Nom B']);
    const before = relay.log.length;
    await a.sync.run();
    await b.sync.run();
    expect(relay.log.length).toBe(before);
  });

  it('un changement reçu ne repart pas vers le relais', async () => {
    const { a, b, variantId } = await pair();
    await sell(a, variantId);
    await a.sync.run();
    const count = relay.log.length;
    await b.sync.run();
    await b.sync.run();
    expect(relay.log.length).toBe(count);
    expect((await b.sync.status()).pending).toBe(0);
  });
});

describe('boutiques', () => {
  it('le stock et la caisse sont propres à la boutique du poste', async () => {
    const { device: a, variantId } = await firstDevice(relay);
    const second = await a.company.saveStore({ id: null, name: 'Annexe' }, 5);
    await expect(a.company.saveStore({ id: null, name: 'Trop' }, 2)).rejects.toThrow(/limitée à 2/);
    await a.finance.openCash(100n);
    await a.company.setCurrentStore(second.id);
    expect((await a.catalog.posSearch('savon'))[0]?.quantity).toBe(0n);
    await expect(sell(a, variantId)).rejects.toThrow(/Stock insuffisant/);
    expect(await a.finance.currentCash()).toBeNull();
    await a.finance.openCash(50n);
    expect((await a.finance.currentCash())?.openingFloat).toBe(50n);
    expect((await a.company.listStores()).find((store) => store.isCurrent)?.name).toBe('Annexe');
  });
});
