import { decodeOfflineRequest, encodeOfflineRequest, generateDeviceKeys, generateLicenseKeys, hashPassword, signMessage, verifyLicense } from '@gestion/license';
import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as newId } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { PrismaClient } from './generated/client';
import { newTotpSecret, totpCode } from './totp';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgresql://postgres:test@127.0.0.1:55432/gestion_test' }) });
const keys = generateLicenseKeys();
let app: Awaited<ReturnType<typeof buildApp>>;
let ownerToken: string;
let staffToken: string;

const owner = () => ({ authorization: `Bearer ${ownerToken}` });
const staff = () => ({ authorization: `Bearer ${staffToken}` });
const post = (url: string, payload: object, headers: Record<string, string> = {}) => app.inject({ method: 'POST', url, payload, headers });
const decode = (token: string) => verifyLicense(token, keys.publicKeyPem)!;

async function adminLogin(role: string) {
  const secret = newTotpSecret();
  const email = `${newId()}@admin.tg`;
  await db.platformAdmin.create({ data: { id: newId(), email, role, passwordHash: await hashPassword('administrateur1'), totpSecret: secret } });
  const login = await post('/admin/login', { email, password: 'administrateur1', totp: totpCode(secret) });
  expect(login.statusCode).toBe(200);
  expect((await post('/admin/login', { email, password: 'administrateur1', totp: '000000' })).statusCode).toBe(401);
  return login.json<{ token: string }>().token;
}

const edition = async (changes: object = {}) => {
  const code = `E${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const response = await post('/admin/editions', { code, name: `Édition ${code}`, description: '', price: 150000, maxUsers: 5, maxStores: 1, maxDevices: 1, features: ['cash'], majorVersion: 1, syncQuotaMb: 0, isActive: true, ...changes }, owner());
  expect(response.statusCode).toBe(200);
  return code;
};
const customer = async () => (await post('/admin/customers', { name: 'Boutique Afi', contactName: null, email: null, phone: '+228 90 00 00 00', address: null, notes: null }, staff())).json<{ id: string }>().id;

async function sale(changes: object = {}, editionChanges: object = {}) {
  const customerId = await customer();
  const editionCode = await edition(editionChanges);
  const response = await post('/admin/sales', { customerId, editionCode, ...changes }, staff());
  expect(response.statusCode).toBe(200);
  return { customerId, editionCode, sale: response.json<{ id: string; licenseId: string; amount: number; status: string }>() };
}
const confirm = (id: string) => post(`/admin/sales/${id}/confirm`, { paymentMethod: 'Mobile Money', paymentReference: 'TX1' }, staff());
const revealKey = async (licenseId: string) => (await post(`/admin/licenses/${licenseId}/reveal-key`, {}, staff())).json<{ key: string }>().key;
async function paidLicense(editionChanges: object = {}) {
  const made = await sale({}, editionChanges);
  expect((await confirm(made.sale.id)).statusCode).toBe(200);
  return { ...made, licenseId: made.sale.licenseId, key: await revealKey(made.sale.licenseId) };
}

class Device {
  keys = generateDeviceKeys();
  activationId = '';
  token = '';
  async challenge() {
    return (await post('/v1/challenge', {})).json<{ challenge: string }>().challenge;
  }
  async activate(licenseKey: string) {
    const challenge = await this.challenge();
    const response = await post('/v1/activate', { licenseKey, devicePublicKey: this.keys.publicKeyPem, deviceName: 'Poste', appVersion: '1.0.0', challenge, signature: signMessage(`activate\n${challenge}\n${licenseKey}`, this.keys.privateKeyPem) });
    if (response.statusCode === 200) {
      this.token = response.json<{ token: string }>().token;
      this.activationId = decode(this.token).activationId;
    }
    return response;
  }
  async auth(method: string, url: string) {
    const challenge = await this.challenge();
    return { 'x-activation-id': this.activationId, 'x-challenge': challenge, 'x-signature': signMessage(`${challenge}\n${method}\n${url}`, this.keys.privateKeyPem) };
  }
  async status() {
    return decode((await post('/v1/activation/status', {}, await this.auth('POST', '/v1/activation/status'))).json<{ token: string }>().token);
  }
}

beforeAll(async () => {
  app = await buildApp({ db, licensePrivateKey: keys.privateKeyPem, rateLimitMax: 100_000 });
  ownerToken = await adminLogin('OWNER');
  staffToken = await adminLogin('ADMIN');
});
afterAll(async () => { await app.close(); await db.$disconnect(); });

describe('vente et délivrance', () => {
  it('ne délivre rien avant la confirmation réelle du paiement', async () => {
    const { sale: created } = await sale();
    expect(created.status).toBe('PENDING');
    expect(created.amount).toBe(150000);
    const license = await db.license.findUniqueOrThrow({ where: { id: created.licenseId } });
    expect(license.status).toBe('PENDING');
    // La clé en attente n'est ni lisible ni utilisable.
    expect((await post(`/admin/licenses/${license.id}/reveal-key`, {}, staff())).statusCode).toBe(409);
    expect((await app.inject({ url: `/admin/sales/${created.id}/receipt`, headers: staff() })).statusCode).toBe(409);
    expect((await confirm(created.id)).statusCode).toBe(200);
    expect((await db.license.findUniqueOrThrow({ where: { id: license.id } })).status).toBe('ACTIVE');
  });

  it('refuse d’activer une licence en attente', async () => {
    const { sale: created } = await sale();
    const licenseKey = `GC-${created.id.slice(-12)}`;
    // La clé réelle n'est jamais exposée : on vérifie via la base de test.
    const { hashLicenseKey } = await import('./licenseKeys');
    await db.license.update({ where: { id: created.licenseId }, data: { keyHash: hashLicenseKey(licenseKey) } });
    expect((await new Device().activate(licenseKey)).statusCode).toBe(403);
  });

  it('confirme une seule fois, même en parallèle', async () => {
    const { sale: created } = await sale();
    const results = await Promise.all([1, 2, 3, 4].map(() => confirm(created.id)));
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(1);
    expect(await db.licenseEvent.count({ where: { licenseId: created.licenseId, type: 'license.issue' } })).toBe(1);
  });

  it('le prix vient de l’édition, modifiable, sans affecter les licences déjà vendues', async () => {
    const { key, licenseId, editionCode } = await paidLicense({ maxUsers: 5 });
    await app.inject({ method: 'PUT', url: `/admin/editions/${editionCode}`, headers: owner(), payload: { name: 'Nouveau', description: '', price: 999, maxUsers: 1, maxStores: 1, maxDevices: 1, features: [], majorVersion: 1, syncQuotaMb: 0, isActive: true } });
    const device = new Device();
    await device.activate(key);
    expect(decode(device.token).maxUsers).toBe(5);
    expect(decode(device.token).features).toEqual(['cash']);
    const customerId = (await db.license.findUniqueOrThrow({ where: { id: licenseId } })).customerId;
    const second = await post('/admin/sales', { customerId, editionCode }, staff());
    expect(second.json<{ amount: number }>().amount).toBe(999);
  });

  it('annule une vente en attente sans jamais délivrer', async () => {
    const { sale: created } = await sale();
    expect((await post(`/admin/sales/${created.id}/cancel`, { reason: '' }, staff())).statusCode).toBe(400);
    expect((await post(`/admin/sales/${created.id}/cancel`, { reason: 'Client désisté' }, staff())).statusCode).toBe(200);
    expect((await confirm(created.id)).statusCode).toBe(409);
    expect((await db.license.findUniqueOrThrow({ where: { id: created.licenseId } })).status).toBe('REVOKED');
  });

  it('rembourser révoque la licence, et le poste l’apprend par réponse signée', async () => {
    const { key, sale: created } = await paidLicense();
    const device = new Device();
    await device.activate(key);
    expect((await post(`/admin/sales/${created.id}/refund`, { reason: 'Erreur de commande' }, staff())).statusCode).toBe(403);
    expect((await post(`/admin/sales/${created.id}/refund`, { reason: 'Erreur de commande' }, owner())).statusCode).toBe(200);
    expect((await device.status()).status).toBe('REVOKED');
  });

  it('produit un reçu PDF réel après paiement', async () => {
    await app.inject({ method: 'PUT', url: '/admin/settings', headers: owner(), payload: { trialDays: 14, vendorName: 'Vendeur', vendorAddress: 'Lomé', vendorPhone: '', vendorEmail: '' } });
    const { sale: created } = await paidLicense();
    const receipt = await app.inject({ url: `/admin/sales/${created.id}/receipt`, headers: staff() });
    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers['content-type']).toBe('application/pdf');
    expect(receipt.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(receipt.headers['content-disposition']).toMatch(/R-\d{6}\.pdf/);
  });
});

describe('activation', () => {
  it('émet un jeton signé lié au poste, sans date d’expiration', async () => {
    const { key } = await paidLicense();
    const device = new Device();
    expect((await device.activate(key)).statusCode).toBe(200);
    const token = decode(device.token);
    expect(token.status).toBe('ACTIVE');
    expect(token.isTrial).toBe(false);
    expect(token.trialEndsAt).toBeNull();
    expect(token).not.toHaveProperty('expiresAt');
  });

  it('une licence = un ordinateur par défaut ; le même poste se réactive sans consommer de place', async () => {
    const { key } = await paidLicense();
    const first = new Device();
    await first.activate(key);
    expect((await first.activate(key)).statusCode).toBe(200);
    const second = new Device();
    const refused = await second.activate(key);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: string }>().error).toMatch(/1 ordinateur/);
  });

  it('ne dépasse pas la limite même avec des activations simultanées', async () => {
    const { key, licenseId } = await paidLicense({ maxDevices: 2 });
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => new Device().activate(key)));
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(2);
    expect(await db.activation.count({ where: { licenseId, releasedAt: null } })).toBe(2);
  });

  it('exige la preuve de la clé privée du poste et un défi valide', async () => {
    const { key } = await paidLicense();
    const device = new Device();
    const challenge = await device.challenge();
    const base = { licenseKey: key, devicePublicKey: device.keys.publicKeyPem, deviceName: 'P', appVersion: '1.0.0' };
    expect((await post('/v1/activate', { ...base, challenge, signature: signMessage(`activate\n${challenge}\n${key}`, generateDeviceKeys().privateKeyPem) })).statusCode).toBe(401);
    expect((await post('/v1/activate', { ...base, challenge: 'faux.defi.x', signature: signMessage(`activate\nfaux.defi.x\n${key}`, device.keys.privateKeyPem) })).statusCode).toBe(401);
  });

  it('refuse un défi expiré', async () => {
    let clock = new Date();
    const dated = await buildApp({ db, licensePrivateKey: keys.privateKeyPem, rateLimitMax: 100_000, now: () => clock });
    const { challenge } = (await dated.inject({ method: 'POST', url: '/v1/challenge' })).json<{ challenge: string }>();
    clock = new Date(clock.getTime() + 6 * 60_000);
    const device = new Device();
    const response = await dated.inject({ method: 'POST', url: '/v1/activate', payload: { licenseKey: 'GC-AAAAA-AAAAA', devicePublicKey: device.keys.publicKeyPem, deviceName: 'P', appVersion: '1', challenge, signature: signMessage(`activate\n${challenge}\nGC-AAAAA-AAAAA`, device.keys.privateKeyPem) } });
    expect(response.statusCode).toBe(401);
    await dated.close();
  });

  it('refuse une clé inconnue', async () => {
    expect((await new Device().activate('GC-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ')).statusCode).toBe(404);
  });

  it('hors ligne : demande signée, jeton signé, demande falsifiée refusée', async () => {
    const { key } = await paidLicense();
    const device = new Device();
    const encoded = encodeOfflineRequest({ licenseKey: key, devicePublicKey: device.keys.publicKeyPem, deviceName: 'Sans réseau', appVersion: '1.0.0', createdAt: new Date().toISOString() }, device.keys.privateKeyPem);
    expect(decodeOfflineRequest(encoded)?.licenseKey).toBe(key);
    expect((await post('/admin/activations/offline', { request: `${encoded}x` }, staff())).statusCode).toBe(400);
    expect((await post('/admin/activations/offline', { request: encoded })).statusCode).toBe(401);
    const response = await post('/admin/activations/offline', { request: encoded }, staff());
    expect(response.statusCode).toBe(200);
    const body = response.json<{ token: string; fileName: string }>();
    expect(body.fileName).toMatch(/\.gclicence$/);
    expect(decode(body.token).status).toBe('ACTIVE');
    expect(await db.activation.count({ where: { id: decode(body.token).activationId, method: 'OFFLINE' } })).toBe(1);
  });
});

describe('statut et transfert', () => {
  it('suspend et réactive avec un motif, révocation définitive', async () => {
    const { key, licenseId } = await paidLicense();
    const device = new Device();
    await device.activate(key);
    const url = `/admin/licenses/${licenseId}/status`;
    expect((await post(url, { action: 'suspend', reason: '' }, staff())).statusCode).toBe(400);
    expect((await post(url, { action: 'suspend', reason: 'Fraude constatée' }, staff())).statusCode).toBe(200);
    expect((await device.status()).status).toBe('SUSPENDED');
    expect((await post(url, { action: 'resume', reason: 'Régularisé' }, staff())).statusCode).toBe(200);
    expect((await device.status()).status).toBe('ACTIVE');
    expect((await post(url, { action: 'revoke', reason: 'Fraude confirmée' }, staff())).statusCode).toBe(200);
    expect((await device.status()).status).toBe('REVOKED');
    expect((await post(url, { action: 'resume', reason: 'Tentative' }, staff())).statusCode).toBe(409);
    expect(await db.adminAuditLog.count({ where: { action: 'license.revoke' } })).toBeGreaterThan(0);
  });

  it('le statut exige la signature du poste', async () => {
    const { key } = await paidLicense();
    const device = new Device();
    await device.activate(key);
    const stranger = generateDeviceKeys();
    const challenge = await device.challenge();
    const forged = { 'x-activation-id': device.activationId, 'x-challenge': challenge, 'x-signature': signMessage(`${challenge}\nPOST\n/v1/activation/status`, stranger.privateKeyPem) };
    expect((await post('/v1/activation/status', {}, forged)).statusCode).toBe(401);
    expect((await post('/v1/activation/status', {})).statusCode).toBe(401);
  });

  it('transfert depuis le poste : place libérée, nouveau poste accepté, ancien jeton marqué libéré', async () => {
    const { key } = await paidLicense();
    const first = new Device();
    await first.activate(key);
    const response = await post('/v1/activation/transfer', {}, await first.auth('POST', '/v1/activation/transfer'));
    expect(decode(response.json<{ token: string }>().token).status).toBe('RELEASED');
    expect((await first.status()).status).toBe('RELEASED');
    const second = new Device();
    expect((await second.activate(key)).statusCode).toBe(200);
    // Le premier poste ne peut plus reprendre la place occupée.
    expect((await first.activate(key)).statusCode).toBe(409);
  });

  it('poste perdu : l’administrateur libère la place avec un motif', async () => {
    const { key } = await paidLicense();
    const lost = new Device();
    await lost.activate(key);
    const url = `/admin/activations/${lost.activationId}/release`;
    expect((await post(url, { reason: '' }, staff())).statusCode).toBe(400);
    expect((await post(url, { reason: 'Ordinateur volé' }, staff())).statusCode).toBe(200);
    expect((await post(url, { reason: 'Ordinateur volé' }, staff())).statusCode).toBe(409);
    expect((await new Device().activate(key)).statusCode).toBe(200);
  });

  it('mise à niveau : le droit de version augmente seulement après paiement', async () => {
    const { key, licenseId, customerId } = await paidLicense();
    const device = new Device();
    await device.activate(key);
    expect((await device.status()).maxMajorVersion).toBe(1);
    const v2 = await edition({ majorVersion: 2, price: 50000 });
    const upgrade = (await post('/admin/sales', { customerId, editionCode: v2, upgradeLicenseId: licenseId }, staff())).json<{ id: string; kind: string }>();
    expect(upgrade.kind).toBe('UPGRADE');
    expect((await device.status()).maxMajorVersion).toBe(1);
    await confirm(upgrade.id);
    expect((await device.status()).maxMajorVersion).toBe(2);
    const v1 = await edition({ majorVersion: 1 });
    expect((await post('/admin/sales', { customerId, editionCode: v1, upgradeLicenseId: licenseId }, staff())).statusCode).toBe(409);
    await post(`/admin/sales/${upgrade.id}/refund`, { reason: 'Annulation' }, owner());
    const after = await device.status();
    expect(after.maxMajorVersion).toBe(1);
    // Rembourser une mise à niveau ne retire pas la licence d'origine.
    expect(after.status).toBe('ACTIVE');
  });

  it('essai : licence distincte, date signée, sans synchronisation', async () => {
    const customerId = await customer();
    const editionCode = await edition({ features: ['cash', 'sync'], maxDevices: 3, syncQuotaMb: 10 });
    const trial = (await post('/admin/licenses/trial', { customerId, editionCode }, staff())).json<{ id: string }>();
    const device = new Device();
    await device.activate(await revealKey(trial.id));
    const token = decode(device.token);
    expect(token.isTrial).toBe(true);
    const days = (Date.parse(token.trialEndsAt!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    expect(token.features).toEqual(['cash']);
    expect(await db.sale.count({ where: { licenseId: trial.id } })).toBe(0);
    expect((await new Device().activate(await revealKey(trial.id))).statusCode).toBe(409);
  });
});

describe('relais de synchronisation', () => {
  const syncEdition = { features: ['sync'], maxDevices: 2, syncQuotaMb: 1 };
  const pull = async (device: Device, after = '0') => {
    const url = `/v1/sync/pull?after=${after}`;
    return (await app.inject({ url, headers: await device.auth('GET', url) })).json<{ events: { id: string }[]; cursor: string }>();
  };
  const push = async (device: Device, events: object[]) => post('/v1/sync/push', { events }, await device.auth('POST', '/v1/sync/push'));

  it('relaie entre postes d’une même licence, sans doublon ni fuite vers une autre', async () => {
    const { key } = await paidLicense(syncEdition);
    const [first, second] = [new Device(), new Device()];
    await first.activate(key);
    await second.activate(key);
    const event = { id: newId(), ciphertext: 'contenu-chiffre' };
    expect((await push(first, [event])).statusCode).toBe(200);
    expect((await push(first, [event])).statusCode).toBe(200);
    const received = await pull(second);
    expect(received.events.map((item) => item.id)).toEqual([event.id]);
    expect((await pull(first)).events).toEqual([]);
    expect((await pull(second, received.cursor)).events).toEqual([]);
    const stranger = new Device();
    await stranger.activate((await paidLicense(syncEdition)).key);
    expect((await pull(stranger)).events).toEqual([]);
    expect((await app.inject({ url: '/v1/sync/pull?after=0' })).statusCode).toBe(401);
  });

  it('applique la limite de stockage, sans compter deux fois un renvoi', async () => {
    const { key, licenseId } = await paidLicense(syncEdition);
    const device = new Device();
    await device.activate(key);
    const event = { id: newId(), ciphertext: 'x'.repeat(600_000) };
    await push(device, [event]);
    await push(device, [event]);
    expect((await db.license.findUniqueOrThrow({ where: { id: licenseId } })).syncBytes).toBe(600_000n);
    expect((await push(device, [{ id: newId(), ciphertext: 'x'.repeat(600_000) }])).statusCode).toBe(413);
  });

  it('refuse une édition sans synchronisation et une licence suspendue', async () => {
    const plain = new Device();
    await plain.activate((await paidLicense()).key);
    expect((await push(plain, [{ id: newId(), ciphertext: 'a' }])).statusCode).toBe(403);
    const { key, licenseId } = await paidLicense(syncEdition);
    const device = new Device();
    await device.activate(key);
    await post(`/admin/licenses/${licenseId}/status`, { action: 'suspend', reason: 'Test de suspension' }, staff());
    expect((await push(device, [{ id: newId(), ciphertext: 'a' }])).statusCode).toBe(403);
  });
});

describe('plateforme', () => {
  const urls = ['/admin/dashboard', '/admin/customers', '/admin/editions', '/admin/sales', '/admin/licenses', '/admin/activations', '/admin/audit', '/admin/tickets', '/admin/logs', '/admin/settings'];

  it('refuse tout accès sans session, y compris avec la signature d’un poste', async () => {
    const device = new Device();
    await device.activate((await paidLicense()).key);
    for (const url of urls) {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: await device.auth('GET', url) })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: { authorization: 'Bearer faux' } })).statusCode).toBe(401);
    }
  });

  it('réserve éditions, remboursements et comptes au propriétaire', async () => {
    expect((await post('/admin/editions', { code: 'INTERDIT', name: 'x', description: '', price: 1, maxUsers: 1, maxStores: 1, maxDevices: 1, features: [], majorVersion: 1, syncQuotaMb: 0, isActive: true }, staff())).statusCode).toBe(403);
    expect((await app.inject({ url: '/admin/admins', headers: staff() })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/admin/settings', headers: staff(), payload: { trialDays: 1, vendorName: '', vendorAddress: '', vendorPhone: '', vendorEmail: '' } })).statusCode).toBe(403);
  });

  it('un compte désactivé perd aussitôt sa session', async () => {
    const created = await post('/admin/admins', { email: `${newId()}@admin.tg`, name: 'Temp', role: 'ADMIN', password: 'motdepasseadmin' }, owner());
    const { id, totpSecret } = created.json<{ id: string; totpSecret: string }>();
    const { email } = await db.platformAdmin.findUniqueOrThrow({ where: { id } });
    const session = (await post('/admin/login', { email, password: 'motdepasseadmin', totp: totpCode(totpSecret) })).json<{ token: string }>().token;
    expect((await app.inject({ url: '/admin/dashboard', headers: { authorization: `Bearer ${session}` } })).statusCode).toBe(200);
    await post(`/admin/admins/${id}/disabled`, { disabled: true }, owner());
    expect((await app.inject({ url: '/admin/dashboard', headers: { authorization: `Bearer ${session}` } })).statusCode).toBe(401);
  });

  it('chiffre les clés au repos, ne les expose pas dans les listes, journalise leur lecture', async () => {
    const { key, licenseId } = await paidLicense();
    const row = await db.license.findUniqueOrThrow({ where: { id: licenseId } });
    expect(row.keyEncrypted).not.toContain(key);
    expect(row.keyHash).not.toContain(key);
    for (const url of ['/admin/licenses', `/admin/licenses/${licenseId}`, '/admin/sales']) {
      const payload = (await app.inject({ url, headers: staff() })).payload;
      expect(payload).not.toContain(key);
      expect(payload).not.toContain('keyEncrypted');
      expect(payload).not.toContain('keyHash');
    }
    const before = await db.adminAuditLog.count({ where: { action: 'license.key.reveal' } });
    await revealKey(licenseId);
    expect(await db.adminAuditLog.count({ where: { action: 'license.key.reveal' } })).toBe(before + 1);
  });

  it('protège les historiques contre toute modification', async () => {
    const { licenseId } = await paidLicense();
    await expect(db.licenseEvent.deleteMany({ where: { licenseId } })).rejects.toThrow();
    await expect(db.adminAuditLog.updateMany({ data: { action: 'x' } })).rejects.toThrow();
  });

  it('calcule le tableau de bord sur les ventes réellement payées', async () => {
    const before = (await app.inject({ url: '/admin/dashboard', headers: staff() })).json<{ revenue: number; pendingSales: number }>();
    await sale();
    const { sale: paid } = await sale();
    await confirm(paid.id);
    const after = (await app.inject({ url: '/admin/dashboard', headers: staff() })).json<{ revenue: number; pendingSales: number; monthRevenue: number }>();
    expect(after.revenue - before.revenue).toBe(150000);
    expect(after.pendingSales - before.pendingSales).toBe(1);
    expect(after.monthRevenue).toBeGreaterThanOrEqual(150000);
  });

  it('gère assistance et publication', async () => {
    const device = new Device();
    await device.activate((await paidLicense()).key);
    const ticket = (await post('/v1/support', { subject: 'Aide', message: 'Bonjour' }, await device.auth('POST', '/v1/support'))).json<{ id: string }>();
    expect((await post(`/admin/tickets/${ticket.id}/reply`, { reply: 'Réponse' }, staff())).statusCode).toBe(200);
    const version = `1.${Date.now() % 100000}.0`;
    expect((await post('/admin/releases', { version, url: 'http://non-securise', sha512: 'a'.repeat(88), notes: '' }, owner())).statusCode).toBe(400);
    expect((await post('/admin/releases', { version, url: 'https://cdn.test/a.exe', sha512: 'a'.repeat(88), notes: '' }, owner())).statusCode).toBe(200);
    expect((await app.inject({ url: '/v1/releases/latest' })).json<{ version: string }>().version).toBe(version);
  });
});
