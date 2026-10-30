import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, migrate, type PrismaClient } from '@gestion/db-local';
import { newId } from '@gestion/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCatalogService } from './catalog.service';
import { createCompanyService } from './company.service';
import { createCustomersService } from './customers.service';
import { createFinanceService } from './finance.service';
import { createRemindersService } from './reminders.service';
import { createSalesService } from './sales.service';

let dir: string;
let db: PrismaClient;
let opened: string[];
let reminders: ReturnType<typeof createRemindersService>;
let debtId: string;
let finance: ReturnType<typeof createFinanceService>;
let customers: ReturnType<typeof createCustomersService>;
let customerId: string;
let methodId: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gestion-rem-'));
  const databasePath = join(dir, 'a.db');
  const key = 'a'.repeat(64);
  migrate({ databasePath, encryptionKey: key, migrationsDir: resolve(import.meta.dirname, '../../../../../packages/db-local/prisma/migrations'), backupDir: join(dir, 'b') });
  db = createClient(databasePath, key);
  const context = { db, deviceId: 'poste' };
  opened = [];
  reminders = createRemindersService({ ...context, openUrl: async (url) => { opened.push(url); } });
  finance = createFinanceService(context);
  customers = createCustomersService(context);
  const company = createCompanyService(context);
  await company.completeSetup({
    company: { name: 'Boutique Afi', logoData: null, address: 'L', phone: '+22890000000', email: null, currency: 'XOF', taxInfo: null },
    sector: 'general', categories: [], units: [{ name: 'Pièce', symbol: 'pce', allowsDecimal: false }], attributes: [], paymentMethods: ['Espèces'],
    stock: { allowOutOfStockSales: false, lowStockThreshold: 0 }, owner: { name: 'P', login: 'patron', password: 'motdepasse' },
  });
  const product = await createCatalogService(context).save({
    id: null, name: 'Savon', reference: null, categoryId: null, unitId: (await company.listUnits())[0]!.id, taxRateBp: 0, trackSerial: false, lowStockThreshold: null, attributes: {},
    variants: [{ id: null, label: '', sku: null, barcode: null, purchasePrice: 1n, salePrice: 2000n, initialQuantity: 5000n }],
  });
  const customer = await customers.save({ id: null, name: 'Kossi', phone: null, whatsapp: '90 12 34 56', address: null });
  customerId = customer.id;
  methodId = (await company.listPaymentMethods())[0]!.id;
  await createSalesService(context).create({
    id: newId(), customerId, cartDiscount: 0n, dueDate: null,
    lines: [{ variantId: product.variants[0]!.id, quantity: 1000n, lineDiscount: 0n, unitPrice: null, serialIds: [] }],
    payments: [{ methodId, amount: 500n }],
  });
  debtId = (await db.debt.findFirstOrThrow()).id;
});
afterEach(async () => { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); });

describe('rappels', () => {
  it('ouvrir WhatsApp ne marque jamais le rappel comme fait', async () => {
    const reminder = await reminders.create({ debtId, dueDate: '2020-01-01', note: 'Promis vendredi' });
    expect([reminder.state, reminder.overdue]).toEqual(['PLANNED', true]);
    const after = await reminders.whatsapp(reminder.id);
    expect(after.state).toBe('OPENED');
    expect(new URL(opened[0]!).pathname).toBe('/22890123456');
    const text = new URL(opened[0]!).searchParams.get('text')!.replace(/[  ]/g, ' ');
    expect(text).toContain('Bonjour Kossi,');
    expect(text).toContain('1 500 FCFA');
    expect(text).toContain('Boutique Afi');
    expect((await reminders.markDone(reminder.id)).state).toBe('DONE');
    expect(await reminders.list(false)).toEqual([]);
    expect(await reminders.list(true)).toHaveLength(1);
  });

  it('refuse sans numéro valide, et n’ouvre rien', async () => {
    await customers.save({ id: customerId, name: 'Kossi', phone: null, whatsapp: null, address: null });
    const reminder = await reminders.create({ debtId, dueDate: '2030-01-01', note: null });
    await expect(reminders.whatsapp(reminder.id)).rejects.toThrow(/numéro WhatsApp/);
    expect(opened).toEqual([]);
    expect((await reminders.list(false))[0]?.state).toBe('PLANNED');
  });

  it('refuse d’envoyer un rappel pour une dette réglée', async () => {
    await finance.payDebt({ id: newId(), debtId, amount: 1500n, methodId });
    await expect(reminders.openWhatsapp(debtId)).rejects.toThrow(/déjà réglée/);
  });

  it('ne notifie que les rappels planifiés et échus', async () => {
    await reminders.create({ debtId, dueDate: '2020-01-01', note: null });
    await reminders.create({ debtId, dueDate: '2999-01-01', note: null });
    const opened2 = await reminders.create({ debtId, dueDate: '2020-01-02', note: null });
    await reminders.whatsapp(opened2.id);
    expect(await reminders.due()).toHaveLength(1);
  });
});
