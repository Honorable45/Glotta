import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { deviceFingerprint, generateDeviceKeys } from '@gestion/license';
import type { SecretProtector } from './keystore';

export interface DeviceIdentity {
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;
}

/**
 * Identité de ce poste, protégée par le système d'exploitation : elle ne dépend d'aucun numéro matériel.
 * Copiée sur un autre ordinateur, elle est illisible et le poste en crée une nouvelle, sans toucher aux données.
 */
export async function loadDeviceIdentity(path: string, protector: SecretProtector): Promise<DeviceIdentity> {
  if (existsSync(path)) {
    try {
      const { publicKeyPem, privateKeyPem } = JSON.parse(await protector.decrypt(readFileSync(path))) as { publicKeyPem: string; privateKeyPem: string };
      return { publicKeyPem, privateKeyPem, fingerprint: deviceFingerprint(publicKeyPem) };
    } catch {
      // Identité illisible : le poste devra simplement être réactivé.
    }
  }
  const { publicKeyPem, privateKeyPem } = generateDeviceKeys();
  writeFileSync(path, await protector.encrypt(JSON.stringify({ publicKeyPem, privateKeyPem })), { mode: 0o600 });
  return { publicKeyPem, privateKeyPem, fingerprint: deviceFingerprint(publicKeyPem) };
}

/** Le jeton est signé et ne contient aucun secret. Il vit hors de la base pour être lu avant toute migration. */
export function fileLicenseStore(path: string) {
  return {
    read(): string | null {
      return existsSync(path) ? readFileSync(path, 'utf8') : null;
    },
    write(value: string) {
      writeFileSync(path, value, { mode: 0o600 });
    },
  };
}
