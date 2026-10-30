import { describe, expect, it } from 'vitest';
import { canOperate, coversVersion, decodeOfflineRequest, deviceFingerprint, encodeOfflineRequest, generateDeviceKeys, generateLicenseKeys, licenseStatus, signLicense, verifyLicense, verifyMessage, signMessage, type LicensePayload } from './index';

const base = new Date('2026-06-15T00:00:00Z');
const payload = (changes: Partial<LicensePayload> = {}): LicensePayload => ({
  v: 2, licenseId: 'l', activationId: 'a', deviceFingerprint: 'f', editionCode: 'PRO', editionName: 'Pro', features: ['cash'], maxUsers: 5, maxStores: 1,
  maxMajorVersion: 1, status: 'ACTIVE', isTrial: false, trialEndsAt: null, issuedAt: base.toISOString(), ...changes,
});

describe('signature', () => {
  const keys = generateLicenseKeys();
  it('accepte un jeton authentique et rejette toute falsification', () => {
    const token = signLicense(payload(), keys.privateKeyPem);
    expect(verifyLicense(token, keys.publicKeyPem)?.editionCode).toBe('PRO');
    const [body, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify(payload({ editionCode: 'BUSINESS', status: 'ACTIVE' }))).toString('base64url');
    expect(verifyLicense(`${forged}.${signature}`, keys.publicKeyPem)).toBeNull();
    expect(verifyLicense(`${body}.`, keys.publicKeyPem)).toBeNull();
    expect(verifyLicense('n-importe-quoi', keys.publicKeyPem)).toBeNull();
    expect(verifyLicense(token, generateLicenseKeys().publicKeyPem)).toBeNull();
    expect(verifyLicense(signLicense(payload(), generateLicenseKeys().privateKeyPem), keys.publicKeyPem)).toBeNull();
  });
  it('refuse un ancien jeton d’abonnement, même correctement signé', () => {
    expect(verifyLicense(signLicense({ ...payload(), v: 1 } as unknown as LicensePayload, keys.privateKeyPem), keys.publicKeyPem)).toBeNull();
  });
});

describe('état de la licence', () => {
  it('une licence à vie reste active quelle que soit la date', () => {
    expect(licenseStatus(payload(), new Date('2099-01-01T00:00:00Z'), null)).toBe('ACTIVE');
    expect(licenseStatus(null, base, null)).toBe('NONE');
    expect(licenseStatus(payload({ status: 'SUSPENDED' }), base, null)).toBe('SUSPENDED');
    expect(licenseStatus(payload({ status: 'REVOKED' }), base, null)).toBe('REVOKED');
    expect(licenseStatus(payload({ status: 'RELEASED' }), base, null)).toBe('NONE');
  });
  it('un essai se termine à sa date, et reculer l’horloge ne redonne pas de temps', () => {
    const trial = payload({ isTrial: true, trialEndsAt: '2026-06-20T00:00:00Z' });
    expect(licenseStatus(trial, base, null)).toBe('TRIAL');
    expect(licenseStatus(trial, new Date('2026-06-21T00:00:00Z'), null)).toBe('TRIAL_ENDED');
    expect(licenseStatus(trial, base, new Date('2026-06-21T00:00:00Z'))).toBe('TRIAL_ENDED');
  });
  it('autorise les opérations seulement avec une licence active ou un essai en cours', () => {
    expect(['ACTIVE', 'TRIAL'].every((value) => canOperate(value as never))).toBe(true);
    expect(['NONE', 'TRIAL_ENDED', 'SUSPENDED', 'REVOKED'].some((value) => canOperate(value as never))).toBe(false);
  });
  it('distingue le droit aux versions de la validité', () => {
    expect(coversVersion(payload({ maxMajorVersion: 1 }), '1.9.3')).toBe(true);
    expect(coversVersion(payload({ maxMajorVersion: 1 }), '2.0.0')).toBe(false);
    expect(licenseStatus(payload({ maxMajorVersion: 1 }), base, null)).toBe('ACTIVE');
    expect(coversVersion(null, '9.0.0')).toBe(true);
  });
});

describe('identité du poste et demande hors ligne', () => {
  const device = generateDeviceKeys();
  const request = { licenseKey: 'GC-AAAAA', devicePublicKey: device.publicKeyPem, deviceName: 'PC', appVersion: '1.0.0', createdAt: base.toISOString() };
  it('produit une empreinte stable propre au poste', () => {
    expect(deviceFingerprint(device.publicKeyPem)).toBe(deviceFingerprint(device.publicKeyPem));
    expect(deviceFingerprint(device.publicKeyPem)).not.toBe(deviceFingerprint(generateDeviceKeys().publicKeyPem));
  });
  it('vérifie la signature d’un message', () => {
    const signature = signMessage('bonjour', device.privateKeyPem);
    expect(verifyMessage('bonjour', signature, device.publicKeyPem)).toBe(true);
    expect(verifyMessage('autre', signature, device.publicKeyPem)).toBe(false);
    expect(verifyMessage('bonjour', 'x', 'pas une clé')).toBe(false);
  });
  it('rejette une demande modifiée ou signée par une autre clé', () => {
    const encoded = encodeOfflineRequest(request, device.privateKeyPem);
    expect(decodeOfflineRequest(encoded)?.licenseKey).toBe('GC-AAAAA');
    const signature = encoded.split('.')[1];
    const tampered = Buffer.from(JSON.stringify({ ...request, licenseKey: 'GC-BBBBB' })).toString('base64url');
    expect(decodeOfflineRequest(`${tampered}.${signature}`)).toBeNull();
    expect(decodeOfflineRequest(encodeOfflineRequest(request, generateDeviceKeys().privateKeyPem))).toBeNull();
    expect(decodeOfflineRequest('illisible')).toBeNull();
  });
});
