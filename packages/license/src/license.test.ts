import { describe, expect, it } from 'vitest';
import { canOperate, generateLicenseKeys, licenseStatus, signLicense, verifyLicense, type LicensePayload } from './index';

const day = 86_400_000;
const base = new Date('2026-06-15T00:00:00Z');
const at = (days: number) => new Date(base.getTime() + days * day);
const payload = (changes: Partial<LicensePayload> = {}): LicensePayload => ({
  tenantId: 't', deviceId: 'd', planCode: 'PRO', features: ['cash'], maxUsers: 5, maxStores: 1, suspended: false, isTrial: false,
  expiresAt: at(30).toISOString(), graceUntil: at(33).toISOString(), offlineUntil: at(100).toISOString(), issuedAt: base.toISOString(), ...changes,
});

describe('signature', () => {
  const keys = generateLicenseKeys();
  it('accepte un jeton authentique et rejette toute falsification', () => {
    const token = signLicense(payload(), keys.privateKeyPem);
    expect(verifyLicense(token, keys.publicKeyPem)?.planCode).toBe('PRO');
    const [body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify(payload({ planCode: 'BUSINESS', expiresAt: at(9999).toISOString() }))).toString('base64url');
    expect(verifyLicense(`${forged}.${signature}`, keys.publicKeyPem)).toBeNull();
    expect(verifyLicense(`${body}.`, keys.publicKeyPem)).toBeNull();
    expect(verifyLicense('n-importe-quoi', keys.publicKeyPem)).toBeNull();
    expect(verifyLicense(token, generateLicenseKeys().publicKeyPem)).toBeNull();
    expect(verifyLicense(signLicense(payload(), generateLicenseKeys().privateKeyPem), keys.publicKeyPem)).toBeNull();
  });
});

describe('état de la licence', () => {
  const status = (days: number, lastSeen: number | null = null, changes = {}) => licenseStatus(payload(changes), at(days), lastSeen === null ? null : at(lastSeen));
  it('suit le cycle de vie', () => {
    expect(licenseStatus(null, base, null)).toBe('NONE');
    expect(status(0)).toBe('ACTIVE');
    expect(status(25)).toBe('EXPIRING');
    expect(status(31)).toBe('GRACE');
    expect(status(34)).toBe('EXPIRED');
    expect(status(0, null, { suspended: true })).toBe('SUSPENDED');
    expect(status(0, null, { offlineUntil: at(-1).toISOString() })).toBe('OFFLINE_EXPIRED');
  });
  it('détecte un recul d’horloge et ne redonne jamais de temps', () => {
    expect(status(0, 40)).toBe('CLOCK_TAMPERED');
    expect(licenseStatus(payload(), new Date(at(40).getTime() - 3_600_000), at(40))).toBe('EXPIRED');
  });
  it('autorise les opérations jusqu’à la fin de la grâce seulement', () => {
    expect(['ACTIVE', 'EXPIRING', 'GRACE'].every((value) => canOperate(value as never))).toBe(true);
    expect(['NONE', 'EXPIRED', 'SUSPENDED', 'OFFLINE_EXPIRED', 'CLOCK_TAMPERED'].some((value) => canOperate(value as never))).toBe(false);
  });
});
