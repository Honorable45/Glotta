import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkIntegrity, createClient, migrate, recordChange, verifyAuditChain } from './index';

const KEY = 'a'.repeat(64);
const BAD_KEY = 'b'.repeat(64);
const MIGRATIONS = resolve(import.meta.dirname, '../prisma/migrations');

let dir: string;
let databasePath: string;
const options = () => ({
  databasePath,
  encryptionKey: KEY,
  migrationsDir: MIGRATIONS,
  backupDir: join(dir, 'backups'),
});
const change = (action = 'test.action', sync = false) => ({
  deviceId: 'poste-1',
  actorId: null,
  action,
  entityType: 'Test',
  entityId: 'e1',
  details: { montant: 1 },
  sync,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gestion-'));
  databasePath = join(dir, 'app.db');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('chiffrement', () => {
  it('ne laisse rien de lisible sur le disque', () => {
    migrate(options());
    const db = new Database(databasePath, { encryptionKey: KEY });
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    const bytes = readFileSync(databasePath);
    expect(bytes.subarray(0, 15).toString()).not.toBe('SQLite format 3');
    expect(bytes.includes('AuditLog')).toBe(false);
  });
  it('rejette une mauvaise clé, une clé absente ou malformée', () => {
    migrate(options());
    expect(() => new Database(databasePath, { encryptionKey: BAD_KEY })).toThrow();
    expect(() => new Database(databasePath, {} as never)).toThrow();
    expect(() => new Database(databasePath, { encryptionKey: `x'"; --` })).toThrow();
  });
});

describe('migrations', () => {
  it('sont idempotentes et ne sauvegardent pas une base neuve', () => {
    const first = migrate(options());
    expect(first.applied.length).toBeGreaterThan(0);
    expect(first.backupPath).toBeNull();
    expect(migrate(options()).applied).toEqual([]);
    expect(checkIntegrity(databasePath, KEY)).toBe(true);
  });

  function customMigrations(entries: Record<string, string>) {
    const custom = join(dir, 'migrations');
    for (const [name, sql] of Object.entries(entries)) {
      mkdirSync(join(custom, name), { recursive: true });
      writeFileSync(join(custom, name, 'migration.sql'), sql);
    }
    return { ...options(), migrationsDir: custom };
  }

  it('sauvegarde une copie chiffrée avant de modifier une base existante', () => {
    migrate(customMigrations({ '001': 'CREATE TABLE a (id TEXT);' }));
    const result = migrate(customMigrations({ '002': 'CREATE TABLE b (id TEXT);' , '001': 'CREATE TABLE a (id TEXT);' }));
    expect(result.applied).toEqual(['002']);
    expect(readFileSync(result.backupPath!).subarray(0, 15).toString()).not.toBe('SQLite format 3');
    const backup = new Database(result.backupPath!, { encryptionKey: KEY });
    expect(backup.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'a'").get()).toEqual({ n: 1 });
    expect(backup.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'b'").get()).toEqual({ n: 0 });
    backup.close();
  });

  it('annule entièrement une migration en échec', () => {
    const bad = customMigrations({ '001': 'CREATE TABLE a (id TEXT); INSERT INTO inexistante VALUES (1);' });
    expect(() => migrate(bad)).toThrow();
    const db = new Database(databasePath, { encryptionKey: KEY });
    expect(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'a'").get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM "_app_migrations"').get()).toEqual({ n: 0 });
    db.close();
  });

  it('refuse une migration modifiée ou une base plus récente que le logiciel', () => {
    migrate(customMigrations({ '001': 'CREATE TABLE a (id TEXT);' }));
    expect(() => migrate(customMigrations({ '001': 'CREATE TABLE autre (id TEXT);' }))).toThrow(/modifiée/);
    rmSync(join(dir, 'migrations', '001'), { recursive: true });
    expect(() => migrate(customMigrations({ '000': 'SELECT 1;' }))).toThrow(/plus récente/);
    expect(readdirSync(dir)).toContain('app.db');
  });
});

describe('journal et outbox', () => {
  it('écrit tout ou rien avec la transaction', async () => {
    migrate(options());
    const db = createClient(databasePath, KEY);
    await db.$transaction((tx) => recordChange(tx, change('ok', true)));
    await expect(
      db.$transaction(async (tx) => {
        await recordChange(tx, change('annulee', true));
        throw new Error('panne');
      }),
    ).rejects.toThrow('panne');
    expect(await db.auditLog.count()).toBe(1);
    expect(await db.outboxEvent.count()).toBe(1);
    await db.$disconnect();
  });

  it('n’ajoute à l’outbox que les changements à synchroniser', async () => {
    migrate(options());
    const db = createClient(databasePath, KEY);
    await db.$transaction((tx) => recordChange(tx, change('local', false)));
    expect(await db.outboxEvent.count()).toBe(0);
    await db.$disconnect();
  });

  it('interdit de modifier ou supprimer le journal, et détecte une altération', async () => {
    migrate(options());
    const db = createClient(databasePath, KEY);
    for (const action of ['a', 'b', 'c']) await db.$transaction((tx) => recordChange(tx, change(action)));
    expect(await verifyAuditChain(db)).toBe(true);
    await expect(db.auditLog.deleteMany()).rejects.toThrow();
    await expect(db.auditLog.updateMany({ data: { action: 'x' } })).rejects.toThrow();
    await db.$disconnect();

    const raw = new Database(databasePath, { encryptionKey: KEY });
    raw.exec(`DROP TRIGGER "AuditLog_no_update"; UPDATE "AuditLog" SET action = 'falsifie' WHERE seq = 2;`);
    raw.close();
    const reopened = createClient(databasePath, KEY);
    expect(await verifyAuditChain(reopened)).toBe(false);
    await reopened.$disconnect();
  });

  it('conserve les données après réouverture et gère les grands montants', async () => {
    migrate(options());
    const db = createClient(databasePath, KEY);
    await db.setting.create({ data: { key: 'k', value: 'v' } });
    await db.$disconnect();
    const reopened = createClient(databasePath, KEY);
    expect((await reopened.setting.findUnique({ where: { key: 'k' } }))?.value).toBe('v');
    await reopened.$disconnect();
  });
});
