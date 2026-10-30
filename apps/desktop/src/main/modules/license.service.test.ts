import { deviceFingerprint, generateDeviceKeys, generateLicenseKeys, signLicense, type LicensePayload } from '@gestion/license';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLicenseService } from './license.service';

const keys = generateLicenseKeys();
const device = generateDeviceKeys();
const identity = { ...device, fingerprint: deviceFingerprint(device.publicKeyPem) };
const start = new Date('2026-06-01T00:00:00Z');
const after = (days: number) => new Date(start.getTime() + days * 86_400_000);
let clock: Date;
let saved: string | null;
const store = { read: () => saved, write: (value: string) => { saved = value; } };

const token = (changes: Partial<LicensePayload> = {}) =>
  signLicense(
    { v: 2, licenseId: 'l', activationId: 'a', deviceFingerprint: identity.fingerprint, editionCode: 'BASE', editionName: 'Base', features: [], maxUsers: 1, maxStores: 1, maxMajorVersion: 1, status: 'ACTIVE', isTrial: false, trialEndsAt: null, issuedAt: clock.toISOString(), ...changes },
    keys.privateKeyPem,
  );

const service = (apiUrl: string | null = 'https://api.test') => {
  const license = createLicenseService({ store, identity, apiUrl, publicKey: keys.publicKeyPem, deviceName: 'PC', appVersion: '1.2.0', now: () => clock });
  license.load();
  return license;
};

/** Répond au défi, puis avec la réponse voulue. */
function mockServer(body: object, status = 200) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith('/v1/challenge') ? new Response(JSON.stringify({ challenge: 'defi' })) : new Response(JSON.stringify(body), { status })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const offline = () => vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('hors ligne'); }));

beforeEach(() => { clock = start; saved = null; });
afterEach(() => vi.unstubAllGlobals());

describe('licence sur le poste', () => {
  it('sans licence, bloque les opérations commerciales mais jamais la consultation ni l’export', async () => {
    const license = service();
    expect((await license.state()).status).toBe('NONE');
    expect(() => license.guard('sales.create')).toThrow(/licence/);
    expect(() => license.guard('sales.list')).not.toThrow();
    expect(() => license.guard('reports.export')).not.toThrow();
  });

  it('active en ligne puis fonctionne sans réseau, indéfiniment', async () => {
    mockServer({ token: token() });
    await service().activate('gc-aaaaa');
    offline();
    clock = after(36500);
    const later = service();
    expect((await later.state()).status).toBe('ACTIVE');
    expect(() => later.guard('sales.create')).not.toThrow();
    await expect(later.refresh()).rejects.toThrow(/Internet/);
    expect((await later.state()).status).toBe('ACTIVE');
    expect(() => later.guard('sales.create')).not.toThrow();
  });

  it('reculer l’horloge ne perturbe jamais une licence à vie', async () => {
    mockServer({ token: token() });
    const license = service();
    await license.activate('gc-aaaaa');
    clock = after(-5000);
    expect((await license.state()).status).toBe('ACTIVE');
  });

  it('envoie la clé publique et une signature, jamais la clé privée', async () => {
    const fetchMock = mockServer({ token: token() });
    await service().activate('gc-aaaaa');
    const body = String(fetchMock.mock.calls.find(([url]) => String(url).endsWith('/v1/activate'))![1]!.body);
    expect(body).toContain('PUBLIC KEY');
    expect(body).not.toContain('PRIVATE KEY');
    expect(body).toContain('GC-AAAAA');
  });

  it('refuse un jeton falsifié ou destiné à un autre poste, sans perdre l’actuel', async () => {
    mockServer({ token: signLicense({ v: 2 } as LicensePayload, generateLicenseKeys().privateKeyPem) });
    await expect(service().activate('k')).rejects.toThrow(/invalide/);
    expect(saved).toBeNull();
    mockServer({ token: token({ deviceFingerprint: 'autre' }) });
    await expect(service().activate('k')).rejects.toThrow(/autre ordinateur/);
    const license = service();
    license.importToken(token());
    expect(() => license.importToken('x.y')).toThrow(/invalide/);
    expect((await license.state()).status).toBe('ACTIVE');
    // Un fichier copié d'un autre poste, trafiqué sur le disque, donne une licence absente.
    saved = JSON.stringify({ token: token({ deviceFingerprint: 'autre' }) });
    expect((await service().state()).status).toBe('NONE');
    saved = 'pas du json';
    expect((await service().state()).status).toBe('NONE');
  });

  it('active hors ligne par jeton signé, sans aucun accès au réseau', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const license = service(null);
    expect(license.offlineRequest('gc-aaaaa').split('.')).toHaveLength(2);
    expect((await license.state()).online).toBe(false);
    license.importToken(token());
    expect((await license.state()).status).toBe('ACTIVE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('change de statut uniquement par réponse signée, et refuse de revenir à un ancien jeton', async () => {
    const old = token();
    const license = service();
    license.importToken(old);
    clock = after(1);
    mockServer({ token: token({ status: 'SUSPENDED' }) });
    await license.refresh();
    expect((await license.state()).status).toBe('SUSPENDED');
    expect(() => license.guard('sales.create')).toThrow(/consultables/);
    expect(() => license.guard('sales.list')).not.toThrow();
    expect(() => license.importToken(old)).toThrow(/plus ancienne/);
    // Une réponse non signée n'a aucun effet.
    mockServer({ status: 'ACTIVE' });
    await expect(license.refresh()).rejects.toThrow();
    expect((await license.state()).status).toBe('SUSPENDED');
  });

  it('un refus du serveur ne touche pas à la licence', async () => {
    const license = service();
    license.importToken(token());
    mockServer({ error: 'Ce poste n’est pas activé.' }, 401);
    await expect(license.refresh()).rejects.toThrow(/pas activé/);
    expect((await license.state()).status).toBe('ACTIVE');
  });

  it('transfert : le poste libéré n’opère plus mais garde la consultation', async () => {
    const license = service();
    license.importToken(token());
    clock = after(1);
    mockServer({ token: token({ status: 'RELEASED' }) });
    expect((await license.transfer()).status).toBe('NONE');
    expect(() => license.guard('sales.create')).toThrow(/consultables/);
    expect(() => license.guard('customers.list')).not.toThrow();
  });

  it('applique l’édition', async () => {
    const license = service();
    license.importToken(token());
    expect(() => license.guard('cash.open')).toThrow(/édition/);
    expect(() => license.guard('expenses.list')).toThrow(/édition/);
    expect(() => license.requireFeature('export_files')).toThrow(/édition/);
    expect(license.limits().maxUsers).toBe(1);
    expect(license.syncTransport()).toBeNull();
    clock = after(1);
    license.importToken(token({ features: ['cash', 'sync'] }));
    expect(() => license.guard('cash.open')).not.toThrow();
    expect(license.syncTransport()).not.toBeNull();
  });

  it('un essai se termine à sa date, et reculer l’horloge ne le prolonge pas', async () => {
    const license = service();
    license.importToken(token({ isTrial: true, trialEndsAt: after(14).toISOString() }));
    expect((await license.state()).status).toBe('TRIAL');
    expect(() => license.guard('sales.create')).not.toThrow();
    clock = after(15);
    expect((await license.state()).status).toBe('TRIAL_ENDED');
    expect(() => license.guard('sales.create')).toThrow(/consultables/);
    clock = after(1);
    expect((await service().state()).status).toBe('TRIAL_ENDED');
  });

  it('distingue le droit aux versions de la validité', async () => {
    const license = service();
    license.importToken(token({ maxMajorVersion: 1 }));
    expect(license.coversApp()).toBe(true);
    expect(license.covers('2.0.0')).toBe(false);
    expect((await license.state()).canOperate).toBe(true);
    // Sans licence, rien ne bloque le démarrage : la consultation reste possible.
    saved = null;
    const empty = service();
    expect(empty.coversApp()).toBe(true);
  });
});
