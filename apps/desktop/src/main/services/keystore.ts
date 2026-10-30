import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface SecretProtector {
  isAvailable(): Promise<boolean>;
  encrypt(text: string): Promise<Buffer>;
  decrypt(data: Buffer): Promise<string>;
}

/**
 * Fournit la clé de la base, protégée par le système d'exploitation. Si la base existe et que la
 * clé manque, on s'arrête : en créer une nouvelle rendrait les données définitivement illisibles.
 */
export async function loadOrCreateKey(keyPath: string, databasePath: string, protector: SecretProtector): Promise<string> {
  if (!(await protector.isAvailable())) {
    throw new Error('Le stockage sécurisé du système est indisponible.');
  }
  if (existsSync(keyPath)) return protector.decrypt(readFileSync(keyPath));
  if (existsSync(databasePath)) {
    throw new Error('La base de données existe mais sa clé est introuvable. Restaurez une sauvegarde.');
  }
  const key = randomBytes(32).toString('hex');
  writeFileSync(keyPath, await protector.encrypt(key), { mode: 0o600 });
  return key;
}
