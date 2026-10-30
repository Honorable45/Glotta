import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, scrypt, sign, timingSafeEqual, verify, type ScryptOptions } from 'node:crypto';

import type { PlanFeature } from './features';

export * from './features';

export type LicenseServerStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'RELEASED';

/** Licence à vie : aucune date d'expiration. Seul un essai porte une date de fin. */
export interface LicensePayload {
  v: 2;
  licenseId: string;
  activationId: string;
  /** Empreinte de la clé publique du poste : un jeton copié ailleurs ne vaut rien. */
  deviceFingerprint: string;
  editionCode: string;
  editionName: string;
  features: PlanFeature[];
  maxUsers: number;
  maxStores: number;
  /** Dernière grande version couverte : distincte de la validité de la licence. */
  maxMajorVersion: number;
  status: LicenseServerStatus;
  isTrial: boolean;
  trialEndsAt: string | null;
  issuedAt: string;
}

export function generateLicenseKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function signLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(null, Buffer.from(body), createPrivateKey(privateKeyPem)).toString('base64url');
  return `${body}.${signature}`;
}

/** Renvoie null pour tout jeton illisible ou mal signé : la licence est alors absente, jamais valide. */
export function verifyLicense(token: string, publicKeyPem: string): LicensePayload | null {
  const [body, signature, extra] = token.trim().split('.');
  if (!body || !signature || extra !== undefined) return null;
  try {
    if (!verify(null, Buffer.from(body), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as LicensePayload;
    return payload.v === 2 ? payload : null;
  } catch {
    return null;
  }
}

export type LicenseStatus = 'NONE' | 'ACTIVE' | 'TRIAL' | 'TRIAL_ENDED' | 'SUSPENDED' | 'REVOKED';

/**
 * L'absence de réseau et la date ne jouent aucun rôle pour une licence à vie.
 * Pour un essai, l'heure la plus tardive vue fait foi : reculer l'horloge ne redonne pas de temps.
 */
export function licenseStatus(payload: LicensePayload | null, now: Date, lastSeen: Date | null): LicenseStatus {
  if (!payload || payload.status === 'RELEASED') return 'NONE';
  if (payload.status === 'REVOKED') return 'REVOKED';
  if (payload.status === 'SUSPENDED') return 'SUSPENDED';
  if (!payload.isTrial) return 'ACTIVE';
  const time = Math.max(now.getTime(), lastSeen?.getTime() ?? 0);
  return payload.trialEndsAt && time < Date.parse(payload.trialEndsAt) ? 'TRIAL' : 'TRIAL_ENDED';
}

export const canOperate = (status: LicenseStatus) => status === 'ACTIVE' || status === 'TRIAL';

export const majorOf = (version: string) => Number(version.split('.')[0]);

/** Une grande version non couverte ne démarre pas, mais la licence reste valide pour les versions couvertes. */
export const coversVersion = (payload: LicensePayload | null, version: string) => !payload || majorOf(version) <= payload.maxMajorVersion;

/** Identité du poste : une paire de clés, sans dépendre de l'adresse MAC ni du numéro de disque. */
export function generateDeviceKeys() {
  return generateLicenseKeys();
}

export function deviceFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

export const signMessage = (message: string, privateKeyPem: string) => sign(null, Buffer.from(message), createPrivateKey(privateKeyPem)).toString('base64url');

export function verifyMessage(message: string, signature: string, publicKeyPem: string): boolean {
  try {
    return verify(null, Buffer.from(message), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

/** Demande d'activation hors ligne : signée par le poste, elle prouve qu'il détient sa clé privée. */
export interface OfflineRequest {
  licenseKey: string;
  devicePublicKey: string;
  deviceName: string;
  appVersion: string;
  createdAt: string;
}

export function encodeOfflineRequest(request: OfflineRequest, devicePrivateKey: string): string {
  const body = Buffer.from(JSON.stringify(request)).toString('base64url');
  return `${body}.${signMessage(body, devicePrivateKey)}`;
}

/** Null pour une demande illisible ou dont la signature ne correspond pas à la clé publique annoncée. */
export function decodeOfflineRequest(encoded: string): OfflineRequest | null {
  const [body, signature, extra] = encoded.trim().split('.');
  if (!body || !signature || extra !== undefined) return null;
  try {
    const request = JSON.parse(Buffer.from(body, 'base64url').toString()) as OfflineRequest;
    if (typeof request.licenseKey !== 'string' || typeof request.devicePublicKey !== 'string') return null;
    return verifyMessage(body, signature, request.devicePublicKey) ? request : null;
  } catch {
    return null;
  }
}

const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const derive = (password: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, 32, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

/** Les paramètres sont stockés avec le hachage pour pouvoir les renforcer plus tard. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !N || !r || !p || !salt || !hash) return false;
  const key = await derive(password, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  return timingSafeEqual(key, Buffer.from(hash, 'base64'));
}
