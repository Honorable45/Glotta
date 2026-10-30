import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { SetupInput } from '@gestion/contracts';
import { setupInputSchema } from '@gestion/contracts';
import { createClient, migrate, verifyAuditChain, type PrismaClient } from '@gestion/db-local';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLogo } from '../services/logo';
import { createCompanyService } from './company.service';

const KEY = 'c'.repeat(64);
let dir: string;
let db: PrismaClient;
let service: ReturnType<typeof createCompanyService>;

const setup = (): SetupInput => ({
  company: { name: 'Boutique Test', logoData: null, address: 'Lomé', phone: '+228 90 00 00 00', email: null, currency: 'XOF', taxInfo: null },
  sector: 'phones',
  categories: ['Téléphones', 'Accessoires'],
  units: [{ name: 'Pièce', symbol: 'pce', allowsDecimal: false }],
  attributes: [
    { name: 'RAM', type: 'SELECT', required: false, options: ['4 Go'], categoryNames: ['Téléphones'] },
    { name: 'Marque', type: 'TEXT', required: false, options: [], categoryNames: [] },
  ],
  paymentMethods: ['Espèces', 'TMoney'],
  stock: { allowOutOfStockSales: false, lowStockThreshold: 3 },
  owner: { name: 'Patron', login: 'patron', password: 'motdepasse' },
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gestion-svc-'));
  const databasePath = join(dir, 'a.db');
  migrate({ databasePath, encryptionKey: KEY, migrationsDir: resolve(import.meta.dirname, '../../../../../packages/db-local/prisma/migrations'), backupDir: join(dir, 'b') });
  db = createClient(databasePath, KEY);
  service = createCompanyService({ db, deviceId: 'poste' });
});
afterEach(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('assistant de configuration', () => {
  it('crée tout en une transaction, avec les bons liens', async () => {
    expect(await service.getSetupState()).toEqual({ completed: false });
    await service.completeSetup(setup());
    expect(await service.getSetupState()).toEqual({ completed: true });
    expect((await service.getCompany()).name).toBe('Boutique Test');
    expect(await db.store.count()).toBe(1);
    const categories = await service.listCategories();
    const phones = categories.find((row) => row.name === 'Téléphones')!;
    const attributes = await service.listAttributes();
    expect(attributes.find((row) => row.name === 'RAM')?.categoryIds).toEqual([phones.id]);
    expect(attributes.find((row) => row.name === 'Marque')?.categoryIds).toHaveLength(2);
    expect((await service.getStockSettings()).lowStockThreshold).toBe(3);
    expect(await db.outboxEvent.count()).toBe(1);
    expect(await verifyAuditChain(db)).toBe(true);
  });

  it('refuse une deuxième configuration sans rien modifier', async () => {
    await service.completeSetup(setup());
    await expect(service.completeSetup({ ...setup(), categories: ['Autre'], attributes: [] })).rejects.toThrow(/déjà configurée/);
    expect(await db.company.count()).toBe(1);
    expect((await service.listCategories()).map((row) => row.name)).not.toContain('Autre');
  });

  it('ne garde rien si la configuration échoue', async () => {
    await expect(service.completeSetup({ ...setup(), categories: ['A', 'a'] })).rejects.toThrow(/double/);
    await expect(service.completeSetup({ ...setup(), sector: 'inconnu' })).rejects.toThrow(/Secteur/);
    expect(await db.company.count()).toBe(0);
    expect(await db.auditLog.count()).toBe(0);
  });

  it('valide les champs saisis', () => {
    const bad = (company: Partial<SetupInput['company']>) => setupInputSchema.safeParse({ ...setup(), company: { ...setup().company, ...company } }).success;
    expect(bad({})).toBe(true);
    expect(bad({ name: '  ' })).toBe(false);
    expect(bad({ phone: 'abc' })).toBe(false);
    expect(bad({ email: 'pas-un-email' })).toBe(false);
    expect(bad({ logoData: 'data:image/svg+xml;base64,AAAA' })).toBe(false);
  });
});

describe('configuration modifiable', () => {
  beforeEach(() => service.completeSetup(setup()));

  it('modifie l’entreprise et conserve le secteur', async () => {
    const company = await service.getCompany();
    const { id: _id, sector: _sector, ...input } = company;
    expect((await service.updateCompany({ ...input, name: 'Nouveau nom' })).sector).toBe('phones');
    expect((await service.getCompany()).name).toBe('Nouveau nom');
  });

  it('refuse les catégories en double et les cycles', async () => {
    await expect(service.saveCategory({ id: null, name: 'téléphones', parentId: null })).rejects.toThrow(/existe déjà/);
    const parent = await service.saveCategory({ id: null, name: 'Parent', parentId: null });
    const child = await service.saveCategory({ id: null, name: 'Enfant', parentId: parent.id });
    await expect(service.saveCategory({ id: parent.id, name: 'Parent', parentId: child.id })).rejects.toThrow(/elle-même/);
    await expect(service.saveCategory({ id: parent.id, name: 'Parent', parentId: parent.id })).rejects.toThrow(/elle-même/);
    await expect(service.archiveCategory(parent.id)).rejects.toThrow(/sous-catégories/);
  });

  it('archive sans supprimer', async () => {
    const [category] = await service.listCategories();
    await service.archiveCategory(category!.id);
    expect((await service.listCategories()).map((row) => row.id)).not.toContain(category!.id);
    expect(await db.category.count()).toBe(2);
  });

  it('ajoute une caractéristique sans code et remplace ses liens', async () => {
    const [category, other] = await service.listCategories();
    const saved = await service.saveAttribute({ id: null, name: 'IMEI', type: 'TEXT', required: true, options: ['ignoré'], categoryIds: [category!.id] });
    expect(saved.options).toEqual([]);
    const updated = await service.saveAttribute({ ...saved, categoryIds: [other!.id] });
    expect(updated.categoryIds).toEqual([other!.id]);
    expect((await service.listAttributes()).find((row) => row.id === saved.id)?.categoryIds).toEqual([other!.id]);
  });

  it('garde au moins une unité et un mode de paiement actif', async () => {
    const [unit] = await service.listUnits();
    await expect(service.archiveUnit(unit!.id)).rejects.toThrow(/au moins une/);
    const methods = await service.listPaymentMethods();
    await service.savePaymentMethod({ id: methods[1]!.id, name: methods[1]!.name, isActive: false });
    await expect(service.savePaymentMethod({ id: methods[0]!.id, name: methods[0]!.name, isActive: false })).rejects.toThrow(/au moins un/);
  });

  it('journalise chaque changement avec une chaîne valide', async () => {
    const before = await db.auditLog.count();
    await service.saveStockSettings({ allowOutOfStockSales: true, lowStockThreshold: 9 });
    expect(await db.auditLog.count()).toBe(before + 1);
    expect(await verifyAuditChain(db)).toBe(true);
    expect((await service.getStockSettings()).allowOutOfStockSales).toBe(true);
  });
});

describe('logo', () => {
  it('se fie au contenu réel du fichier', async () => {
    const png = join(dir, 'a.txt');
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]));
    expect(await readLogo(png)).toMatch(/^data:image\/png;base64,/);
    const fake = join(dir, 'faux.png');
    writeFileSync(fake, '<svg onload="x()"/>');
    await expect(readLogo(fake)).rejects.toThrow(/PNG ou JPEG/);
    const big = join(dir, 'big.png');
    writeFileSync(big, Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(readLogo(big)).rejects.toThrow(/2 Mo/);
  });
});
