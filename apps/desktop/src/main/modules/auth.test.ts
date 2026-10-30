import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { channels, channelAccess } from '@gestion/contracts';
import { createClient, migrate, verifyAuditChain, type PrismaClient } from '@gestion/db-local';
import { newId } from '@gestion/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorize, currentUserId, getSession, runWithRequest, setSession } from '../core/session';
import { hashPassword, verifyPassword } from '../core/password';
import { createDispatcher, type Handlers } from '../ipc/dispatcher';
import { createAuthService } from './auth.service';
import { createCatalogService } from './catalog.service';
import { createCompanyService } from './company.service';
import { createReportsService } from './reports.service';
import { createSalesService } from './sales.service';

const KEY = 'f'.repeat(64);
let dir: string;
let db: PrismaClient;
let auth: ReturnType<typeof createAuthService>;
let company: ReturnType<typeof createCompanyService>;
let sales: ReturnType<typeof createSalesService>;
let reports: ReturnType<typeof createReportsService>;
let catalog: ReturnType<typeof createCatalogService>;
const SELLER = { id: null, name: 'Koffi', login: 'koffi', role: 'SELLER' as const, overrides: {}, password: 'vendeur123' };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'gestion-auth-'));
  const databasePath = join(dir, 'a.db');
  migrate({ databasePath, encryptionKey: KEY, migrationsDir: resolve(import.meta.dirname, '../../../../../packages/db-local/prisma/migrations'), backupDir: join(dir, 'b') });
  db = createClient(databasePath, KEY);
  const context = { db, deviceId: 'poste' };
  auth = createAuthService(context);
  company = createCompanyService(context);
  sales = createSalesService(context);
  reports = createReportsService(context);
  catalog = createCatalogService(context);
  setSession(null);
  const { ownerId } = await company.completeSetup({
    company: { name: 'T', logoData: null, address: 'L', phone: '+22890000000', email: null, currency: 'XOF', taxInfo: null },
    sector: 'general', categories: [], units: [{ name: 'Pièce', symbol: 'pce', allowsDecimal: false }], attributes: [], paymentMethods: ['Espèces'],
    stock: { allowOutOfStockSales: false, lowStockThreshold: 3 },
    owner: { name: 'Patron', login: 'patron', password: 'motdepasse' },
  });
  await auth.openSession(ownerId);
});
afterEach(async () => {
  setSession(null);
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('mots de passe', () => {
  it('sont salés, hachés et vérifiés', async () => {
    const first = await hashPassword('secret123');
    expect(first).not.toContain('secret123');
    expect(first).not.toBe(await hashPassword('secret123'));
    expect(await verifyPassword('secret123', first)).toBe(true);
    expect(await verifyPassword('autre', first)).toBe(false);
    expect(await verifyPassword('x', 'format-invalide')).toBe(false);
  });
  it('ne sont jamais stockés en clair', async () => {
    expect((await db.user.findFirstOrThrow()).passwordHash).not.toContain('motdepasse');
  });
});

describe('connexion', () => {
  it('donne le même message pour un mauvais mot de passe et un compte inconnu, et journalise', async () => {
    await auth.logout();
    const wrong = await auth.login('patron', 'mauvais').catch((error: Error) => error.message);
    const unknown = await auth.login('personne', 'mauvais').catch((error: Error) => error.message);
    expect(wrong).toBe(unknown);
    expect(getSession()).toBeNull();
    expect(await db.auditLog.count({ where: { action: 'auth.login.failed' } })).toBe(2);
    expect((await auth.login('patron', 'motdepasse'))?.role).toBe('OWNER');
  });

  it('bloque après cinq échecs, même avec le bon mot de passe ensuite', async () => {
    await auth.logout();
    for (let attempt = 0; attempt < 5; attempt += 1) await auth.login('patron', 'mauvais').catch(() => undefined);
    await expect(auth.login('patron', 'motdepasse')).rejects.toThrow(/Trop de tentatives/);
  });

  it('refuse un compte désactivé', async () => {
    const seller = await auth.saveUser(SELLER);
    await auth.setDisabled(seller.id, true);
    await auth.logout();
    await expect(auth.login('koffi', 'vendeur123')).rejects.toThrow(/incorrect/);
  });

  it('change son mot de passe seulement avec l’ancien', async () => {
    await expect(auth.changePassword('faux', 'nouveau123')).rejects.toThrow(/incorrect/);
    await auth.changePassword('motdepasse', 'nouveau123');
    await auth.logout();
    expect(await auth.login('patron', 'nouveau123')).not.toBeNull();
  });
});

describe('garde des canaux', () => {
  it('chaque canal a un niveau d’accès, et seuls les canaux prévus sont publics', () => {
    for (const channel of channels) expect(channelAccess[channel]).toBeDefined();
    expect(channels.filter((channel) => channelAccess[channel] === 'public').sort()).toEqual(
      ['auth.login', 'auth.logout', 'auth.session', 'company.pickLogo', 'settings.getTheme', 'setup.complete', 'setup.getState', 'sync.join'].sort(),
    );
  });

  const dispatcher = (spy: { called: boolean }) =>
    createDispatcher(
      { 'stock.movements': () => { spy.called = true; return []; }, 'settings.getTheme': () => 'system', 'audit.list': () => [] } as unknown as Handlers,
      () => true,
      authorize,
    );

  it('refuse sans session, puis sans la permission, avant tout traitement', async () => {
    const spy = { called: false };
    const dispatch = dispatcher(spy);
    setSession(null);
    expect(await runWithRequest(() => dispatch('stock.movements', 'x', { variantId: null }))).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    setSession({ id: 'u', name: 'K', login: 'k', role: 'SELLER', overrides: {} });
    expect(await runWithRequest(() => dispatch('stock.movements', 'x', { variantId: null }))).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(spy.called).toBe(false);
    setSession({ id: 'u', name: 'K', login: 'k', role: 'SELLER', overrides: { manage_stock: true } });
    expect(await runWithRequest(() => dispatch('stock.movements', 'x', { variantId: null }))).toMatchObject({ ok: true });
    expect(spy.called).toBe(true);
    setSession(null);
    expect(await runWithRequest(() => dispatch('settings.getTheme', 'x', undefined))).toMatchObject({ ok: true });
  });

  it('fige l’utilisateur pendant une requête', async () => {
    setSession({ id: 'u1', name: 'K', login: 'k', role: 'SELLER', overrides: {} });
    await runWithRequest(async () => {
      setSession({ id: 'u2', name: 'A', login: 'a', role: 'SELLER', overrides: {} });
      expect(currentUserId()).toBe('u1');
    });
  });
});

describe('permissions dans les opérations', () => {
  async function prepare() {
    const unitId = (await company.listUnits())[0]!.id;
    const product = await catalog.save({
      id: null, name: 'Savon', reference: null, categoryId: null, unitId, taxRateBp: 0, trackSerial: false, lowStockThreshold: null, attributes: {},
      variants: [{ id: null, label: '', sku: null, barcode: null, purchasePrice: 600n, salePrice: 1000n, initialQuantity: 5000n }],
    });
    return product.variants[0]!.id;
  }
  const as = <T>(overrides: Record<string, boolean>, run: () => Promise<T>) => {
    setSession({ id: 'vendeur', name: 'K', login: 'k', role: 'SELLER', overrides });
    return runWithRequest(run);
  };

  it('une remise exige le droit, le prix modifié aussi, et la vente porte son auteur', async () => {
    const variantId = await prepare();
    const methodId = (await company.listPaymentMethods())[0]!.id;
    const sale = (changes: object) => ({
      id: newId(), customerId: null, cartDiscount: 0n, dueDate: null,
      lines: [{ variantId, quantity: 1000n, lineDiscount: 0n, unitPrice: null, serialIds: [] }],
      payments: [{ methodId, amount: 900n }], ...changes,
    });
    await expect(as({}, () => sales.create(sale({ cartDiscount: 100n })))).rejects.toThrow(/autorisation/);
    await expect(as({}, () => sales.create(sale({ lines: [{ variantId, quantity: 1000n, lineDiscount: 0n, unitPrice: 900n, serialIds: [] }] })))).rejects.toThrow(/autorisation/);
    const created = await as({ discount: true }, () => sales.create(sale({ cartDiscount: 100n })));
    const row = await db.sale.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.userId).toBe('vendeur');
    expect((await db.auditLog.findFirstOrThrow({ where: { action: 'sale.create' } })).actorId).toBe('vendeur');
  });

  it('masque marge et bénéfice sans le droit, dans les données elles-mêmes', async () => {
    const period = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' };
    await prepare();
    const dash = await as({ view_dashboard: true }, () => reports.dashboard(period));
    expect([dash.margin, dash.profit]).toEqual([null, null]);
    const report = await as({ view_reports: true }, () => reports.run('dailySales', period));
    expect(report.columns.map((column) => column.key)).not.toContain('margin');
    await expect(as({ view_reports: true }, () => reports.run('margins', period))).rejects.toThrow(/autorisation/);
    const products = await as({}, () => catalog.list({ search: '', categoryId: null, archived: false, lowOnly: false }));
    expect(products[0]?.variants[0]?.purchasePrice).toBe(0n);
  });
});

describe('gestion des employés', () => {
  it('respecte la limite de la formule, y compris à la réactivation', async () => {
    const limited = createAuthService({ db, deviceId: 'poste', maxUsers: () => 2 });
    const seller = await limited.saveUser(SELLER);
    await expect(limited.saveUser({ ...SELLER, login: 'autre' })).rejects.toThrow(/limitée à 2/);
    await limited.setDisabled(seller.id, true);
    await limited.saveUser({ ...SELLER, login: 'autre' });
    await expect(limited.setDisabled(seller.id, false)).rejects.toThrow(/limitée à 2/);
  });


  it('protège le dernier propriétaire et son propre compte', async () => {
    const owner = (await auth.listUsers())[0]!;
    await expect(auth.saveUser({ ...owner, role: 'ADMIN', password: null })).rejects.toThrow(/au moins un propriétaire/);
    await expect(auth.setDisabled(owner.id, true)).rejects.toThrow(/propre compte/);
  });

  it('un administrateur ne touche pas à un propriétaire et ne s’élève pas', async () => {
    const owner = (await auth.listUsers())[0]!;
    const admin = await auth.saveUser({ ...SELLER, login: 'admin', role: 'ADMIN' });
    setSession({ ...admin, overrides: {} });
    await expect(auth.saveUser({ ...admin, role: 'OWNER', password: null })).rejects.toThrow(/propriétaire/);
    await expect(auth.resetPassword(owner.id, 'piratage123')).rejects.toThrow(/propriétaire/);
    await expect(auth.setDisabled(owner.id, true)).rejects.toThrow(/propriétaire/);
    await expect(auth.saveUser({ ...owner, name: 'X', password: null })).rejects.toThrow(/propriétaire/);
  });

  it('refuse un identifiant déjà pris et journalise', async () => {
    await auth.saveUser(SELLER);
    await expect(auth.saveUser(SELLER)).rejects.toThrow(/déjà utilisé/);
    const entries = await auth.auditList(50);
    expect(entries.some((entry) => entry.action === 'user.create')).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('vendeur123');
    expect(await verifyAuditChain(db)).toBe(true);
  });
});
