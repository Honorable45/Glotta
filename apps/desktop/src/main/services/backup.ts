import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'node:crypto';
import { closeSync, copyFileSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { AppError } from '../core/errors';

const MAGIC = Buffer.from('GCBACKUP1');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const BACKUP_EXTENSION = 'gcbackup';

/** Code lisible à recopier sur papier, 128 bits d'entropie environ. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(25);
  const chars = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return chars.match(/.{5}/g)!.join('-');
}

export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

const deriveKey = (code: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(normalizeCode(code), salt, 32, SCRYPT, (error, key) => (error ? reject(error) : resolve(key)));
  });

/**
 * La base est déjà chiffrée avec une clé protégée par Windows, qui ne survit pas à la perte du poste.
 * Une sauvegarde contient donc aussi cette clé, elle-même chiffrée par le code de récupération :
 * [magic][salt 16][iv 12][tag 16][clé chiffrée 64][sha256 du fichier 32][fichier de base chiffré].
 */
export async function writeBackup(input: { databasePath: string; encryptionKey: string; code: string; target: string }): Promise<void> {
  const db = new Database(input.databasePath, { encryptionKey: input.encryptionKey });
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    db.close();
  }
  const data = readFileSync(input.databasePath);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await deriveKey(input.code, salt), iv);
  const digest = createHash('sha256').update(data).digest();
  // L'empreinte est authentifiée : modifier le fichier sans le code est détecté.
  cipher.setAAD(digest);
  const wrapped = Buffer.concat([cipher.update(Buffer.from(input.encryptionKey, 'utf8')), cipher.final()]);
  const temporary = `${input.target}.tmp`;
  writeFileSync(temporary, Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), wrapped, digest, data]));
  // Le renommage évite de laisser une sauvegarde à moitié écrite en cas de coupure.
  copyFileSync(temporary, input.target);
  rmSync(temporary);
}

export async function readBackup(path: string, code: string): Promise<{ encryptionKey: string; data: Buffer }> {
  const file = readFileSync(path);
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new AppError('INVALID_INPUT', "Ce fichier n'est pas une sauvegarde valide.");
  let offset = MAGIC.length;
  const take = (length: number) => file.subarray(offset, (offset += length));
  const salt = take(16);
  const iv = take(12);
  const tag = take(16);
  const wrapped = take(64);
  const digest = take(32);
  const data = file.subarray(offset);
  if (!createHash('sha256').update(data).digest().equals(digest)) throw new AppError('INVALID_INPUT', 'Cette sauvegarde est endommagée.');
  const decipher = createDecipheriv('aes-256-gcm', await deriveKey(code, salt), iv);
  decipher.setAAD(digest);
  decipher.setAuthTag(tag);
  try {
    const key = Buffer.concat([decipher.update(wrapped), decipher.final()]).toString('utf8');
    return { encryptionKey: key, data };
  } catch {
    throw new AppError('FORBIDDEN', 'Code de récupération incorrect.');
  }
}

/** Remplace la base courante après avoir vérifié la sauvegarde, en gardant l'ancienne de côté. */
export async function restoreBackup(input: { path: string; code: string; databasePath: string; asidePath: string }): Promise<string> {
  const { encryptionKey, data } = await readBackup(input.path, input.code);
  const candidate = `${input.databasePath}.restauration`;
  writeFileSync(candidate, data);
  try {
    const db = new Database(candidate, { encryptionKey });
    const ok = db.pragma('integrity_check', { simple: true }) === 'ok';
    db.close();
    if (!ok) throw new AppError('INVALID_INPUT', 'Cette sauvegarde est endommagée.');
  } catch (error) {
    rmSync(candidate, { force: true });
    rmSync(`${candidate}-wal`, { force: true });
    rmSync(`${candidate}-shm`, { force: true });
    throw error instanceof AppError ? error : new AppError('INVALID_INPUT', 'Cette sauvegarde est illisible.');
  }
  rmSync(`${candidate}-wal`, { force: true });
  rmSync(`${candidate}-shm`, { force: true });
  copyFileSync(input.databasePath, input.asidePath);
  copyFileSync(candidate, input.databasePath);
  rmSync(`${input.databasePath}-wal`, { force: true });
  rmSync(`${input.databasePath}-shm`, { force: true });
  rmSync(candidate);
  return encryptionKey;
}

export function listBackups(folder: string) {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(`.${BACKUP_EXTENSION}`))
    .map((name) => {
      const stats = statSync(join(folder, name));
      return { name, createdAt: stats.mtime.toISOString(), size: stats.size };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Garde les sauvegardes les plus récentes. Ne touche qu'aux fichiers de ce type. */
export function pruneBackups(folder: string, keep: number) {
  for (const file of listBackups(folder).slice(keep)) rmSync(join(folder, basename(file.name)));
}

export function backupFileName(date = new Date()) {
  return `sauvegarde-${date.toISOString().replace(/[:.]/g, '-')}.${BACKUP_EXTENSION}`;
}

export const ensureFolder = (folder: string) => mkdirSync(folder, { recursive: true });

export function isBackupFile(path: string): boolean {
  const descriptor = openSync(path, 'r');
  const head = Buffer.alloc(MAGIC.length);
  readSync(descriptor, head, 0, MAGIC.length, 0);
  closeSync(descriptor);
  return head.equals(MAGIC);
}
