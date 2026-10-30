import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomInt } from 'node:crypto';

// Sans 0, O, 1, I ni L : une clé se dicte au téléphone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateLicenseKey(): string {
  const group = () => Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `GC-${group()}-${group()}-${group()}-${group()}`;
}

export const normalizeLicenseKey = (key: string) => key.trim().toUpperCase().replace(/\s+/g, '');
export const hashLicenseKey = (key: string) => createHash('sha256').update(normalizeLicenseKey(key)).digest('hex');

/** Le chiffrement au repos dépend d'un secret absent de la base : une copie de la base seule ne révèle aucune clé. */
export function createKeyVault(serverSecret: string) {
  const key = Buffer.from(hkdfSync('sha256', serverSecret, 'gestion-commerciale', 'license-key-vault', 32));
  return {
    seal(text: string) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
    },
    open(sealed: string) {
      const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
      const decipher = createDecipheriv('aes-256-gcm', key, iv!);
      decipher.setAuthTag(tag!);
      return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
    },
  };
}
