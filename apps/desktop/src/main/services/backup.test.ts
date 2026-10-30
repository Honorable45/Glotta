import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, migrate } from '@gestion/db-local';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupFileName, generateRecoveryCode, listBackups, normalizeCode, pruneBackups, readBackup, restoreBackup, writeBackup } from './backup';

const KEY = '1'.repeat(64);
const CODE = generateRecoveryCode();
let dir: string;
let databasePath: string;
let target: string;

async function setValue(value: string) {
  const db = createClient(databasePath, KEY);
  await db.setting.upsert({ where: { key: 'k' }, create: { key: 'k', value }, update: { value } });
  await db.$disconnect();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gestion-bak-'));
  databasePath = join(dir, 'a.db');
  target = join(dir, 'sauvegarde.gcbackup');
  migrate({ databasePath, encryptionKey: KEY, migrationsDir: resolve(import.meta.dirname, '../../../../../packages/db-local/prisma/migrations'), backupDir: join(dir, 'm') });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sauvegardes', () => {
  it('le code est long et se saisit sans souci de casse ni de tirets', () => {
    expect(CODE).toMatch(/^([A-Z2-9]{5}-){4}[A-Z2-9]{5}$/);
    expect(normalizeCode(CODE.toLowerCase().replaceAll('-', ' '))).toBe(normalizeCode(CODE));
  });

  it('restaure les données d’avant, même sur un poste qui n’a plus la clé', async () => {
    await setValue('avant');
    await writeBackup({ databasePath, encryptionKey: KEY, code: CODE, target });
    await setValue('apres');
    const key = await restoreBackup({ path: target, code: CODE, databasePath, asidePath: join(dir, 'ancienne.db') });
    expect(key).toBe(KEY);
    const db = createClient(databasePath, key);
    expect((await db.setting.findUnique({ where: { key: 'k' } }))?.value).toBe('avant');
    await db.$disconnect();
    const aside = new Database(join(dir, 'ancienne.db'), { encryptionKey: KEY });
    expect(aside.prepare("SELECT value FROM Setting WHERE key = 'k'").get()).toEqual({ value: 'apres' });
    aside.close();
  });

  it('ne contient rien de lisible, ni la clé', async () => {
    await setValue('secret-commercial');
    await writeBackup({ databasePath, encryptionKey: KEY, code: CODE, target });
    const bytes = readFileSync(target);
    expect(bytes.includes('secret-commercial')).toBe(false);
    expect(bytes.includes(KEY)).toBe(false);
    expect(bytes.includes('SQLite format 3')).toBe(false);
  });

  it('refuse un mauvais code, un fichier modifié ou étranger, sans toucher à la base', async () => {
    await setValue('intact');
    await writeBackup({ databasePath, encryptionKey: KEY, code: CODE, target });
    const before = readFileSync(databasePath);
    const attempt = (path: string, code = CODE) => restoreBackup({ path, code, databasePath, asidePath: join(dir, 'x.db') });
    await expect(attempt(target, generateRecoveryCode())).rejects.toThrow(/incorrect/);
    const tampered = Buffer.from(readFileSync(target));
    tampered[tampered.length - 100]! ^= 0xff;
    writeFileSync(join(dir, 't.gcbackup'), tampered);
    await expect(attempt(join(dir, 't.gcbackup'))).rejects.toThrow(/endommagée/);
    writeFileSync(join(dir, 'f.gcbackup'), 'pas une sauvegarde');
    await expect(attempt(join(dir, 'f.gcbackup'))).rejects.toThrow(/pas une sauvegarde/);
    expect(readFileSync(databasePath).equals(before)).toBe(true);
  });

  it('une lecture de sauvegarde vérifie aussi l’authenticité de l’empreinte', async () => {
    await writeBackup({ databasePath, encryptionKey: KEY, code: CODE, target });
    expect((await readBackup(target, CODE)).encryptionKey).toBe(KEY);
  });

  it('ne garde que les plus récentes, sans toucher aux autres fichiers', () => {
    for (let index = 0; index < 5; index += 1) writeFileSync(join(dir, `${backupFileName(new Date(2026, 0, index + 1))}`), 'x');
    writeFileSync(join(dir, 'autre.txt'), 'x');
    pruneBackups(dir, 2);
    expect(listBackups(dir)).toHaveLength(2);
    expect(readFileSync(join(dir, 'autre.txt')).toString()).toBe('x');
  });
});
