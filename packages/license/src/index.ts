import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, scrypt, sign, timingSafeEqual, verify, type ScryptOptions } from 'node:crypto';

import type { PlanFeature } from './features';

export * from './features';

export interface LicensePayload {
  tenantId: string;
  deviceId: string;
  planCode: string;
  features: PlanFeature[];
  maxUsers: number;
  maxStores: number;
  suspended: boolean;
  isTrial: boolean;
  expiresAt: string;
  graceUntil: string;
  /** Au-delà, le poste doit se reconnecter : un poste hors ligne ne vit pas éternellement. */
  offlineUntil: string;
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
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  try {
    if (!verify(null, Buffer.from(body), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url'))) return null;
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as LicensePayload;
  } catch {
    return null;
  }
}

export type LicenseStatus = 'NONE' | 'ACTIVE' | 'EXPIRING' | 'GRACE' | 'EXPIRED' | 'SUSPENDED' | 'OFFLINE_EXPIRED' | 'CLOCK_TAMPERED';

const WARNING_MS = 7 * 86_400_000;
/** Tolère un petit recul d'horloge (synchronisation réseau, changement d'heure). */
const CLOCK_TOLERANCE_MS = 2 * 3_600_000;

export function licenseStatus(payload: LicensePayload | null, now: Date, lastSeen: Date | null): LicenseStatus {
  if (!payload) return 'NONE';
  if (payload.suspended) return 'SUSPENDED';
  if (lastSeen && now.getTime() < lastSeen.getTime() - CLOCK_TOLERANCE_MS) return 'CLOCK_TAMPERED';
  // L'heure la plus tardive fait foi : reculer l'horloge ne redonne pas de temps.
  const time = Math.max(now.getTime(), lastSeen?.getTime() ?? 0);
  if (time > Date.parse(payload.offlineUntil)) return 'OFFLINE_EXPIRED';
  const expires = Date.parse(payload.expiresAt);
  if (time < expires - WARNING_MS) return 'ACTIVE';
  if (time < expires) return 'EXPIRING';
  return time < Date.parse(payload.graceUntil) ? 'GRACE' : 'EXPIRED';
}

export const canOperate = (status: LicenseStatus) => status === 'ACTIVE' || status === 'EXPIRING' || status === 'GRACE';

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
