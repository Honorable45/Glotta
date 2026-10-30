import { generateLicenseKeys, verifyLicense } from '@gestion/license';
import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as newId } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '@gestion/license';
import { buildApp } from './app';
import { PrismaClient } from './generated/client';
import type { PaymentProvider } from './providers';
import { newTotpSecret, totpCode } from './totp';

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgresql://postgres:test@127.0.0.1:55432/gestion_test' }) });
const keys = generateLicenseKeys();
let remote: { status: 'CONFIRMED' | 'PENDING' | 'FAILED'; amount: number | null; providerRef: string | null };
let statusCalls = 0;
/** Doublure de test : le code de production n'enregistre aucun prestataire factice. */
const testProvider: PaymentProvider = {
  name: 'test',
  createPayment: async ({ intentId }) => ({ payUrl: `https://pay.test/${intentId}`, providerRef: 'ref' }),
  intentIdFromWebhook: (body) => (body as { id?: string }).id ?? null,
  fetchStatus: async () => { statusCalls += 1; return remote; },
};
let app: Awaited<ReturnType<typeof buildApp>>;
let adminToken: string;
const device = () => ({ deviceId: newId(), deviceName: 'Poste 1' });
const account = () => ({ email: `${newId()}@test.tg`, password: 'motdepasse1', ...device(), companyName: 'Boutique', phone: null });

async function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, payload, headers });
}
async function signup() {
  const input = account();
  const response = await post('/v1/signup', input);
  expect(response.statusCode).toBe(200);
  const body = response.json<{ deviceSecret: string; token: string }>();
  return { ...input, ...body, headers: { 'x-device-id': input.deviceId, 'x-device-secret': body.deviceSecret } };
}
const decode = (token: string) => verifyLicense(token, keys.publicKeyPem)!;
const admin = () => ({ authorization: `Bearer ${adminToken}` });

beforeAll(async () => {
  app = await buildApp({ db, licensePrivateKey: keys.privateKeyPem, providers: { test: testProvider }, defaultProvider: 'test', rateLimitMax: 100_000 });
  const secret = newTotpSecret();
  const email = `${newId()}@admin.tg`;
  await db.platformAdmin.create({ data: { id: newId(), email, passwordHash: await hashPassword('administrateur1'), totpSecret: secret } });
  const login = await post('/admin/login', { email, password: 'administrateur1', totp: totpCode(secret) });
  adminToken = login.json<{ token: string }>().token;
  const refused = await post('/admin/login', { email, password: 'administrateur1', totp: '000000' });
  expect(refused.statusCode).toBe(401);
});
afterAll(async () => { await app.close(); await db.$disconnect(); });
beforeEach(() => { statusCalls = 0; remote = { status: 'CONFIRMED', amount: 5000, providerRef: 'ref' }; });

describe('inscription et licence', () => {
  it('propose les trois formules aux prix prévus', async () => {
    const plans = (await app.inject({ url: '/v1/plans' })).json<{ code: string; price: number; maxUsers: number }[]>();
    expect(plans.map((plan) => [plan.code, plan.price, plan.maxUsers])).toEqual([['STARTER', 2500, 1], ['PRO', 5000, 5], ['BUSINESS', 10000, 15]]);
  });

  it('démarre un essai et émet une licence signée', async () => {
    const { token, deviceId } = await signup();
    const license = decode(token);
    expect([license.isTrial, license.deviceId, license.planCode]).toEqual([true, deviceId, 'PRO']);
    expect(Date.parse(license.offlineUntil)).toBeGreaterThan(Date.now());
    expect(verifyLicense(token, generateLicenseKeys().publicKeyPem)).toBeNull();
  });

  it('refuse un deuxième essai sur le même poste ou le même email', async () => {
    const first = await signup();
    expect((await post('/v1/signup', { ...account(), deviceId: first.deviceId })).statusCode).toBe(409);
    expect((await post('/v1/signup', { ...account(), email: first.email })).statusCode).toBe(409);
  });

  it('refuse un mauvais mot de passe sans préciser la cause', async () => {
    const first = await signup();
    const wrong = await post('/v1/activate', { email: first.email, password: 'mauvais-pass', ...device() });
    const unknown = await post('/v1/activate', { email: 'inconnu@test.tg', password: 'mauvais-pass', ...device() });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
    expect((await post('/v1/activate', { email: first.email, password: first.password, ...device() })).statusCode).toBe(200);
  });

  it('rafraîchit seulement avec le secret du poste', async () => {
    const first = await signup();
    expect((await post('/v1/license/refresh', {}, first.headers)).statusCode).toBe(200);
    expect((await post('/v1/license/refresh', {}, { ...first.headers, 'x-device-secret': 'faux' })).statusCode).toBe(401);
    expect((await post('/v1/license/refresh', {})).statusCode).toBe(401);
  });
});

describe('paiements', () => {
  async function pay() {
    const account = await signup();
    const created = await post('/v1/payments', { planCode: 'PRO', months: 1 }, account.headers);
    expect(created.statusCode).toBe(200);
    return { ...account, intentId: created.json<{ intentId: string }>().intentId };
  }
  const subscription = (token: string) => db.subscription.findUniqueOrThrow({ where: { tenantId: decode(token).tenantId } });

  it('une notification seule ne valide rien : le statut du prestataire décide', async () => {
    const { intentId, token } = await pay();
    remote = { status: 'PENDING', amount: null, providerRef: null };
    await post('/v1/payments/webhook/test', { id: intentId, status: 'SUCCESS' });
    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: intentId } })).status).toBe('PENDING');
    expect((await subscription(token)).isTrial).toBe(true);
  });

  it('confirme une seule fois, même notifié plusieurs fois en même temps', async () => {
    const { intentId, token } = await pay();
    const before = await subscription(token);
    await Promise.all([1, 2, 3, 4].map(() => post('/v1/payments/webhook/test', { id: intentId })));
    const after = await subscription(token);
    const added = (after.expiresAt.getTime() - before.expiresAt.getTime()) / 86_400_000;
    expect(added).toBeGreaterThanOrEqual(28);
    expect(added).toBeLessThanOrEqual(31);
    expect(after.isTrial).toBe(false);
    expect(await db.subscriptionEvent.count({ where: { tenantId: after.tenantId, type: 'payment.confirmed' } })).toBe(1);
  });

  it('refuse un montant incohérent', async () => {
    const { intentId } = await pay();
    remote = { status: 'CONFIRMED', amount: 100, providerRef: 'ref' };
    await post('/v1/payments/webhook/test', { id: intentId });
    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: intentId } })).status).toBe('PENDING');
  });

  it('un paiement échoué n’active rien, et le prix vient du serveur', async () => {
    const { intentId, token } = await pay();
    remote = { status: 'FAILED', amount: null, providerRef: null };
    await post('/v1/payments/webhook/test', { id: intentId });
    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: intentId } })).status).toBe('FAILED');
    expect((await subscription(token)).isTrial).toBe(true);
    expect((await db.paymentIntent.findUniqueOrThrow({ where: { id: intentId } })).amount).toBe(5000);
  });

  it('une entreprise ne lit pas le paiement d’une autre', async () => {
    const { intentId } = await pay();
    const other = await signup();
    expect((await app.inject({ url: `/v1/payments/${intentId}`, headers: other.headers })).statusCode).toBe(404);
  });

  it('sans prestataire configuré, le paiement est refusé clairement', async () => {
    const bare = await buildApp({ db, licensePrivateKey: keys.privateKeyPem, providers: {}, defaultProvider: null, rateLimitMax: 100_000 });
    const { headers } = await signup();
    const response = await bare.inject({ method: 'POST', url: '/v1/payments', payload: { planCode: 'PRO', months: 1 }, headers });
    expect(response.statusCode).toBe(503);
    await bare.close();
  });
});

describe('relais de synchronisation', () => {
  it('relaie entre postes d’une même entreprise, sans doublon ni fuite vers une autre', async () => {
    const first = await signup();
    const secondDevice = device();
    const activated = (await post('/v1/activate', { email: first.email, password: first.password, ...secondDevice })).json<{ deviceSecret: string }>();
    const second = { 'x-device-id': secondDevice.deviceId, 'x-device-secret': activated.deviceSecret };
    const event = { id: newId(), ciphertext: 'contenu-chiffre' };
    expect((await post('/v1/sync/push', { events: [event] }, first.headers)).statusCode).toBe(200);
    expect((await post('/v1/sync/push', { events: [event] }, first.headers)).statusCode).toBe(200);
    const pull = (headers: Record<string, string>, after = '0') => app.inject({ url: `/v1/sync/pull?after=${after}`, headers }).then((response) => response.json<{ events: { id: string }[]; cursor: string }>());
    const received = await pull(second);
    expect(received.events.map((item) => item.id)).toEqual([event.id]);
    expect((await pull(first.headers)).events).toEqual([]);
    expect((await pull(second, received.cursor)).events).toEqual([]);
    const stranger = await signup();
    expect((await pull(stranger.headers)).events).toEqual([]);
    expect((await app.inject({ url: '/v1/sync/pull?after=0' })).statusCode).toBe(401);
  });
});

describe('administration', () => {
  it('refuse tout accès sans session d’administrateur, y compris à un poste commerçant', async () => {
    const shop = await signup();
    for (const url of ['/admin/tenants', '/admin/stats', '/admin/plans', '/admin/payments', '/admin/tickets', '/admin/logs', '/admin/settings']) {
      expect((await app.inject({ url })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: shop.headers })).statusCode).toBe(401);
      expect((await app.inject({ url, headers: { authorization: `Bearer ${shop.deviceSecret}` } })).statusCode).toBe(401);
    }
  });

  it('suspend et réactive, avec un motif obligatoire, et la licence le reflète', async () => {
    const shop = await signup();
    const { tenantId } = decode(shop.token);
    const url = `/admin/tenants/${tenantId}/subscription`;
    expect((await post(url, { action: 'suspend', reason: '' }, admin())).statusCode).toBe(400);
    expect((await post(url, { action: 'suspend', reason: 'Fraude constatée' }, admin())).statusCode).toBe(200);
    expect(decode((await post('/v1/license/refresh', {}, shop.headers)).json<{ token: string }>().token).suspended).toBe(true);
    await post(url, { action: 'resume', reason: 'Régularisé' }, admin());
    expect(decode((await post('/v1/license/refresh', {}, shop.headers)).json<{ token: string }>().token).suspended).toBe(false);
    expect(await db.adminAuditLog.count({ where: { action: 'subscription.suspend' } })).toBeGreaterThan(0);
  });

  it('modifie prix, limites et durées, qui s’appliquent aux nouvelles licences', async () => {
    const edited = await app.inject({ method: 'PUT', url: '/admin/plans/PRO', headers: admin(), payload: { name: 'PRO', price: 5000, maxUsers: 7, maxStores: 1, isActive: true } });
    expect(edited.statusCode).toBe(200);
    const shop = await signup();
    expect(decode(shop.token).maxUsers).toBe(7);
    await app.inject({ method: 'PUT', url: '/admin/plans/PRO', headers: admin(), payload: { name: 'PRO', price: 5000, maxUsers: 5, maxStores: 1, isActive: true } });
    await app.inject({ method: 'PUT', url: '/admin/settings', headers: admin(), payload: { trialDays: 1, graceDays: 3, offlineDays: 7 } });
    const short = await signup();
    const days = (Date.parse(decode(short.token).expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeLessThan(1.01);
    await app.inject({ method: 'PUT', url: '/admin/settings', headers: admin(), payload: { trialDays: 14, graceDays: 3, offlineDays: 7 } });
  });

  it('ne stocke aucun mot de passe ni donnée commerciale en clair', async () => {
    const shop = await signup();
    const tenants = (await app.inject({ url: '/admin/tenants', headers: admin() })).payload;
    expect(tenants).not.toContain('passwordHash');
    expect(tenants).not.toContain(shop.password);
    expect(tenants).not.toContain('secretHash');
  });

  it('gère assistance et publication', async () => {
    const shop = await signup();
    const ticket = (await post('/v1/support', { subject: 'Aide', message: 'Bonjour' }, shop.headers)).json<{ id: string }>();
    expect((await post(`/admin/tickets/${ticket.id}/reply`, { reply: 'Réponse' }, admin())).statusCode).toBe(200);
    const version = `1.${Date.now() % 100000}.0`;
    expect((await post('/admin/releases', { version, url: 'http://non-securise', sha512: 'a'.repeat(88), notes: '' }, admin())).statusCode).toBe(400);
    expect((await post('/admin/releases', { version, url: 'https://cdn.test/a.exe', sha512: 'a'.repeat(88), notes: '' }, admin())).statusCode).toBe(200);
    expect((await app.inject({ url: '/v1/releases/latest' })).json<{ version: string }>().version).toBe(version);
  });
});
