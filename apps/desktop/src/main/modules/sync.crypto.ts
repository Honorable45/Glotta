import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { normalizeCode } from '../services/backup';

/** Dérivée du code de récupération, qui ne quitte jamais les postes : le serveur ne peut rien déchiffrer. */
export function deriveSyncKey(code: string): Buffer {
  return Buffer.from(hkdfSync('sha256', normalizeCode(code), 'gestion-commerciale', 'sync-v1', 32));
}

export function seal(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function open(sealed: string, key: Buffer): string {
  const bytes = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
