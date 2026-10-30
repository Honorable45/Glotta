import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, migrate, type PrismaClient } from '@gestion/db-local';
import { generateLicenseKeys, signLicense, type LicensePayload } from '@gestion/license';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLicenseService } from './license.service';

const keys = generateLicenseKeys();
const day = 86_400_000;
const start = new Date('2026-06-01T00:00:00Z');
const after = (days: number) => new Date(start.getTime() + days * day);
let dir: string;
let db: PrismaClient;
let clock: Date;

const token = (changes: Partial<LicensePayload> = {}) =>
  signLicense(
    {
      tenantId: 't', deviceId: 'poste', planCode: 'STARTER', features: [], maxUsers: 1, maxStores: 1, suspended: false, isTrial: false,
      expiresAt: after(30).toISOString(), graceUntil: after(33).toISOString(), offlineUntil: after(7).toISOString(), issuedAt: start.toISOString(), ...changes,
    },
    keys.privateKeyPem,
  );

const service = () => createLicenseService({ db, deviceId: 'poste', apiUrl: 'https://api.test', publicKey: keys.publicKeyPem, deviceName: 'PC', now: () => clock });

function mockServer(body: object, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gestion-lic-'));
  const databasePath = join(dir, 'a.db');
  const key = 'a'.repeat(64);
  migrate({ databasePath, encryptionKey: key, migrationsDir: resolve(import.meta.dirname, '../../../../../packages/db-local/prisma/migrations'), backupDir: join(dir, 'b') });
  db = createClient(databasePath, key);
  clock = start;
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe('licence sur le poste', () => {
  it('sans licence, bloque les opérations commerciales mais pas la consultation', async () => {
    const license = service();
    expect((await license.state()).status).toBe('NONE');
    expect(() => license.guard('sales.create')).toThrow(/abonnement/);
    expect(() => license.guard('sales.list')).not.toThrow();
    expect(() => license.guard('reports.export')).not.toThrow();
  });

  it('active, conserve la licence et fonctionne hors ligne jusqu’à la date limite', async () => {
    mockServer({ token: token(), deviceSecret: 'secret' });
    await service().activate('a@b.tg', 'motdepasse');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('hors ligne'); }));
    clock = after(6);
    const later = service();
    expect((await later.state()).status).toBe('ACTIVE');
    expect(() => later.guard('sales.create')).not.toThrow();
    await expect(later.refresh()).rejects.toThrow(/Internet/);
    clock = after(8);
    expect((await later.state()).status).toBe('OFFLINE_EXPIRED');
    expect(() => later.guard('sales.create')).toThrow(/abonnement/);
    expect(() => later.guard('sales.list')).not.toThrow();
  });

  it('reculer l’horloge ne prolonge rien', async () => {
    mockServer({ token: token(), deviceSecret: 's' });
    const license = service();
    await license.activate('a@b.tg', 'motdepasse');
    clock = after(6);
    await license.state();
    clock = after(1);
    const restarted = service();
    expect((await restarted.state()).status).toBe('CLOCK_TAMPERED');
    expect(() => restarted.guard('sales.create')).toThrow();
  });

  it('refuse un jeton falsifié ou destiné à un autre poste', async () => {
    mockServer({ token: signLicense(JSON.parse(Buffer.from(token().split('.')[0]!, 'base64url').toString()), generateLicenseKeys().privateKeyPem), deviceSecret: 's' });
    await expect(service().activate('a@b.tg', 'motdepasse')).rejects.toThrow(/invalide/);
    expect(await db.setting.findUnique({ where: { key: 'license.token' } })).toBeNull();
    mockServer({ token: token({ deviceId: 'autre' }), deviceSecret: 's' });
    const license = service();
    await license.activate('a@b.tg', 'motdepasse');
    expect((await license.state()).status).toBe('NONE');
    await db.setting.upsert({ where: { key: 'license.token' }, create: { key: 'license.token', value: 'x' }, update: { value: 'x.y' } });
    expect((await service().state()).status).toBe('NONE');
  });

  it('applique la formule et conserve la grâce', async () => {
    mockServer({ token: token(), deviceSecret: 's' });
    const license = service();
    await license.activate('a@b.tg', 'motdepasse');
    expect(() => license.guard('cash.open')).toThrow(/formule/);
    expect(() => license.guard('expenses.list')).toThrow(/formule/);
    expect(() => license.requireFeature('export_files')).toThrow(/formule/);
    expect(license.limits().maxUsers).toBe(1);
    mockServer({ token: token({ features: ['cash'], offlineUntil: after(40).toISOString() }) });
    await license.refresh();
    expect(() => license.guard('cash.open')).not.toThrow();
    clock = after(31);
    expect((await license.state()).status).toBe('GRACE');
    expect(() => license.guard('sales.create')).not.toThrow();
    clock = after(34);
    expect((await license.state()).status).toBe('EXPIRED');
    expect(() => license.guard('sales.create')).toThrow(/consultables/);
    // Après expiration, les dépenses passées restent lisibles.
    expect(() => license.guard('cash.history')).not.toThrow();
  });

  it('transmet le refus du serveur sans perdre la licence existante', async () => {
    mockServer({ token: token(), deviceSecret: 's' });
    const license = service();
    await license.activate('a@b.tg', 'motdepasse');
    mockServer({ error: 'Poste non authentifié.' }, 401);
    await expect(license.refresh()).rejects.toThrow(/non authentifié/);
    expect((await license.state()).status).toBe('ACTIVE');
  });
});
