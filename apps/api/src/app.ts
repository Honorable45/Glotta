import { createHash, randomBytes } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { hashPassword, signLicense, verifyPassword, type LicensePayload, type PlanFeature } from '@gestion/license';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { v7 as newId } from 'uuid';
import { z } from 'zod';
import type { PrismaClient } from './generated/client';
import type { PaymentProvider } from './providers';
import { verifyTotp } from './totp';

const DAY = 86_400_000;
const ADMIN_SESSION_MS = 8 * 3_600_000;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

export interface AppOptions {
  db: PrismaClient;
  licensePrivateKey: string;
  /** Vide tant qu'aucun prestataire réel n'est configuré : le paiement en ligne est alors refusé. */
  providers: Record<string, PaymentProvider>;
  defaultProvider: string | null;
  now?: () => Date;
  rateLimitMax?: number;
  /** Dossier compilé de la console d'administration, servi sur /console. */
  adminDist?: string;
}

class ApiError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export async function buildApp(options: AppOptions) {
  const { db, providers } = options;
  const now = options.now ?? (() => new Date());
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  await app.register(rateLimit, { max: options.rateLimitMax ?? 120, timeWindow: '1 minute' });

  app.setErrorHandler(async (error: Error & { statusCode?: number }, _request, reply) => {
    if (error instanceof ApiError) return reply.status(error.statusCode).send({ error: error.message });
    if (error instanceof z.ZodError) return reply.status(400).send({ error: 'Données invalides.' });
    if (error.statusCode === 429) return reply.status(429).send({ error: 'Trop de requêtes. Réessayez plus tard.' });
    if (error.statusCode && error.statusCode < 500) return reply.status(error.statusCode).send({ error: 'Requête invalide.' });
    await db.technicalLog.create({ data: { id: newId(), level: 'error', message: String(error.stack ?? error.message).slice(0, 4000) } }).catch(() => undefined);
    return reply.status(500).send({ error: 'Erreur interne.' });
  });

  if (options.adminDist) {
    await app.register(fastifyStatic, { root: options.adminDist, prefix: '/console/' });
    app.addHook('onSend', async (request, reply) => {
      if (request.url.startsWith('/console')) {
        reply.header('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
        reply.header('x-frame-options', 'DENY');
      }
    });
  }

  const setting = async (key: string, fallback: number) => (await db.platformSetting.findUnique({ where: { key } }))?.value ?? fallback;

  async function issueToken(tenantId: string, deviceId: string): Promise<string> {
    const subscription = await db.subscription.findUniqueOrThrow({ where: { tenantId } });
    const plan = await db.plan.findUniqueOrThrow({ where: { code: subscription.planCode } });
    const [graceDays, offlineDays] = await Promise.all([setting('graceDays', 3), setting('offlineDays', 7)]);
    const issuedAt = now();
    const payload: LicensePayload = {
      tenantId,
      deviceId,
      planCode: plan.code,
      features: plan.features as PlanFeature[],
      maxUsers: plan.maxUsers,
      maxStores: plan.maxStores,
      suspended: subscription.suspendedAt !== null,
      isTrial: subscription.isTrial,
      expiresAt: subscription.expiresAt.toISOString(),
      graceUntil: new Date(subscription.expiresAt.getTime() + graceDays * DAY).toISOString(),
      offlineUntil: new Date(issuedAt.getTime() + offlineDays * DAY).toISOString(),
      issuedAt: issuedAt.toISOString(),
    };
    return signLicense(payload, options.licensePrivateKey);
  }

  async function attachDevice(tenantId: string, deviceId: string, deviceName: string) {
    const deviceSecret = randomBytes(32).toString('base64url');
    const existing = await db.tenantDevice.findUnique({ where: { id: deviceId } });
    if (existing && existing.tenantId !== tenantId) throw new ApiError(409, 'Ce poste est déjà rattaché à une autre entreprise.');
    if (existing?.revokedAt) throw new ApiError(403, 'Ce poste a été révoqué.');
    await db.tenantDevice.upsert({
      where: { id: deviceId },
      create: { id: deviceId, tenantId, name: deviceName, secretHash: sha256(deviceSecret), lastSeenAt: now() },
      update: { secretHash: sha256(deviceSecret), name: deviceName, lastSeenAt: now() },
    });
    return deviceSecret;
  }

  async function requireDevice(request: FastifyRequest) {
    const deviceId = request.headers['x-device-id'];
    const secret = request.headers['x-device-secret'];
    if (typeof deviceId !== 'string' || typeof secret !== 'string') throw new ApiError(401, 'Poste non authentifié.');
    const device = await db.tenantDevice.findUnique({ where: { id: deviceId } });
    if (!device || device.revokedAt || device.secretHash !== sha256(secret)) throw new ApiError(401, 'Poste non authentifié.');
    await db.tenantDevice.update({ where: { id: deviceId }, data: { lastSeenAt: now() } });
    return device;
  }

  const authLimit = { config: { rateLimit: { max: options.rateLimitMax ?? 10, timeWindow: '1 minute' } } };

  app.get('/v1/plans', async () => {
    const plans = await db.plan.findMany({ where: { isActive: true }, orderBy: { price: 'asc' } });
    return plans.map(({ code, name, price, maxUsers, maxStores, features }) => ({ code, name, price, maxUsers, maxStores, features }));
  });

  const credentials = z.object({
    email: z.email().transform((email) => email.toLowerCase()),
    password: z.string().min(8).max(200),
    deviceId: z.uuid(),
    deviceName: z.string().min(1).max(120),
  });

  app.post('/v1/signup', authLimit, async (request) => {
    const input = credentials.extend({ companyName: z.string().trim().min(1).max(120), phone: z.string().max(30).nullable() }).parse(request.body);
    if (await db.tenant.findUnique({ where: { email: input.email } })) throw new ApiError(409, 'Un compte existe déjà avec cet email.');
    // Un poste déjà connu n'ouvre pas un nouvel essai gratuit.
    if (await db.tenantDevice.findUnique({ where: { id: input.deviceId } })) throw new ApiError(409, 'Ce poste est déjà rattaché à une entreprise.');
    const [trialDays, passwordHash] = await Promise.all([setting('trialDays', 14), hashPassword(input.password)]);
    const tenantId = newId();
    const startsAt = now();
    await db.tenant.create({
      data: {
        id: tenantId,
        name: input.companyName,
        email: input.email,
        phone: input.phone,
        passwordHash,
        subscription: {
          create: {
            planCode: 'PRO',
            status: 'ACTIVE',
            isTrial: true,
            startsAt,
            expiresAt: new Date(startsAt.getTime() + trialDays * DAY),
            events: { create: { id: newId(), type: 'trial.start', details: { trialDays }, actor: 'system' } },
          },
        },
      },
    });
    const deviceSecret = await attachDevice(tenantId, input.deviceId, input.deviceName);
    return { deviceSecret, token: await issueToken(tenantId, input.deviceId) };
  });

  app.post('/v1/activate', authLimit, async (request) => {
    const input = credentials.parse(request.body);
    const tenant = await db.tenant.findUnique({ where: { email: input.email } });
    if (!tenant || !(await verifyPassword(input.password, tenant.passwordHash))) throw new ApiError(401, 'Email ou mot de passe incorrect.');
    const deviceSecret = await attachDevice(tenant.id, input.deviceId, input.deviceName);
    return { deviceSecret, token: await issueToken(tenant.id, input.deviceId) };
  });

  app.post('/v1/license/refresh', async (request) => {
    const device = await requireDevice(request);
    return { token: await issueToken(device.tenantId, device.id) };
  });

  async function applyConfirmedPayment(intentId: string, provider: PaymentProvider) {
    const intent = await db.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent) return null;
    if (intent.status !== 'PENDING') return intent;
    const remote = await provider.fetchStatus({ intentId, providerRef: intent.providerRef });
    if (remote.status === 'PENDING') return intent;
    if (remote.status === 'FAILED') return db.paymentIntent.update({ where: { id: intentId }, data: { status: 'FAILED' } });
    if (remote.amount !== intent.amount) {
      await db.technicalLog.create({ data: { id: newId(), level: 'warn', message: `Montant incohérent pour le paiement ${intentId} : ${remote.amount} au lieu de ${intent.amount}` } });
      return intent;
    }
    return db.$transaction(async (tx) => {
      // Passage atomique PENDING -> CONFIRMED : deux notifications simultanées n'ajoutent pas deux mois.
      const claimed = await tx.paymentIntent.updateMany({ where: { id: intentId, status: 'PENDING' }, data: { status: 'CONFIRMED', appliedAt: now(), providerRef: remote.providerRef ?? intent.providerRef } });
      if (claimed.count === 0) return tx.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
      const subscription = await tx.subscription.findUniqueOrThrow({ where: { tenantId: intent.tenantId } });
      const from = new Date(Math.max(subscription.expiresAt.getTime(), now().getTime()));
      const expiresAt = new Date(from);
      expiresAt.setMonth(expiresAt.getMonth() + intent.months);
      await tx.subscription.update({ where: { tenantId: intent.tenantId }, data: { planCode: intent.planCode, expiresAt, status: 'ACTIVE', isTrial: false } });
      await tx.subscriptionEvent.create({ data: { id: newId(), tenantId: intent.tenantId, type: 'payment.confirmed', details: { intentId, months: intent.months, amount: intent.amount, provider: intent.provider }, actor: 'provider' } });
      return tx.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    });
  }

  app.post('/v1/payments', async (request) => {
    const device = await requireDevice(request);
    const input = z.object({ planCode: z.string().min(1), months: z.number().int().min(1).max(12) }).parse(request.body);
    const provider = options.defaultProvider ? providers[options.defaultProvider] : undefined;
    if (!provider) throw new ApiError(503, 'Le paiement en ligne n’est pas encore disponible. Contactez l’assistance.');
    const plan = await db.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.isActive) throw new ApiError(404, 'Formule introuvable.');
    const amount = plan.price * input.months;
    const id = newId();
    await db.paymentIntent.create({ data: { id, tenantId: device.tenantId, planCode: plan.code, months: input.months, amount, provider: provider.name } });
    const created = await provider.createPayment({ intentId: id, amount, description: `Abonnement ${plan.name}` });
    await db.paymentIntent.update({ where: { id }, data: { providerRef: created.providerRef } });
    return { intentId: id, payUrl: created.payUrl, amount };
  });

  app.get('/v1/payments/:id', async (request) => {
    const device = await requireDevice(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const intent = await db.paymentIntent.findUnique({ where: { id } });
    if (!intent || intent.tenantId !== device.tenantId) throw new ApiError(404, 'Paiement introuvable.');
    const provider = providers[intent.provider];
    const current = provider ? await applyConfirmedPayment(id, provider) : intent;
    return { status: current?.status ?? intent.status, token: await issueToken(device.tenantId, device.id) };
  });

  app.post('/v1/payments/webhook/:provider', async (request, reply) => {
    const provider = providers[z.object({ provider: z.string() }).parse(request.params).provider];
    if (!provider) throw new ApiError(404, 'Prestataire inconnu.');
    const intentId = provider.intentIdFromWebhook(request.body);
    if (intentId) await applyConfirmedPayment(intentId, provider);
    return reply.status(200).send({ received: true });
  });

  app.post('/v1/sync/push', { bodyLimit: 8 * 1024 * 1024 }, async (request) => {
    const device = await requireDevice(request);
    const { events } = z.object({ events: z.array(z.object({ id: z.uuid(), ciphertext: z.string().min(1).max(4_000_000) })).max(500) }).parse(request.body);
    // Un renvoi après coupure est sans effet : l'identifiant de l'événement est unique.
    await db.syncEnvelope.createMany({
      data: events.map((event) => ({ id: event.id, tenantId: device.tenantId, deviceId: device.id, ciphertext: event.ciphertext })),
      skipDuplicates: true,
    });
    return { accepted: events.length };
  });

  app.get('/v1/sync/pull', async (request) => {
    const device = await requireDevice(request);
    const { after, limit } = z.object({ after: z.coerce.bigint().min(0n), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(request.query);
    const rows = await db.syncEnvelope.findMany({ where: { tenantId: device.tenantId, seq: { gt: after } }, orderBy: { seq: 'asc' }, take: limit });
    return {
      events: rows.filter((row) => row.deviceId !== device.id).map((row) => ({ id: row.id, ciphertext: row.ciphertext })),
      cursor: String(rows.at(-1)?.seq ?? after),
      hasMore: rows.length === limit,
    };
  });

  app.post('/v1/support', async (request) => {
    const device = await requireDevice(request);
    const input = z.object({ subject: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(5000) }).parse(request.body);
    const id = newId();
    await db.supportTicket.create({ data: { id, tenantId: device.tenantId, ...input } });
    return { id };
  });

  app.get('/v1/releases/latest', async () => {
    return db.appRelease.findFirst({ orderBy: { publishedAt: 'desc' }, select: { version: true, url: true, sha512: true, notes: true } });
  });

  // Administration centrale : routes séparées, session distincte de celle des commerçants.

  async function requireAdmin(request: FastifyRequest, _reply: FastifyReply) {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'Non authentifié.');
    const session = await db.adminSession.findUnique({ where: { tokenHash: sha256(token) } });
    if (!session || session.expiresAt < now()) throw new ApiError(401, 'Session expirée.');
    return session.adminId;
  }
  const audit = (adminId: string, action: string, details: object) =>
    db.adminAuditLog.create({ data: { id: newId(), adminId, action, details: details as never } });

  app.post('/admin/login', authLimit, async (request) => {
    const input = z.object({ email: z.email(), password: z.string().max(200), totp: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const admin = await db.platformAdmin.findUnique({ where: { email: input.email.toLowerCase() } });
    const valid = admin && (await verifyPassword(input.password, admin.passwordHash)) && verifyTotp(admin.totpSecret, input.totp, now().getTime());
    if (!valid) throw new ApiError(401, 'Identifiants incorrects.');
    const token = randomBytes(32).toString('base64url');
    await db.adminSession.create({ data: { tokenHash: sha256(token), adminId: admin.id, expiresAt: new Date(now().getTime() + ADMIN_SESSION_MS) } });
    await audit(admin.id, 'admin.login', {});
    return { token };
  });

  app.post('/admin/logout', async (request) => {
    await requireAdmin(request, undefined as never);
    await db.adminSession.delete({ where: { tokenHash: sha256(request.headers.authorization!.slice(7)) } });
    return { ok: true };
  });

  app.get('/admin/tenants', async (request) => {
    await requireAdmin(request, undefined as never);
    const tenants = await db.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { id: true, name: true, email: true, phone: true, createdAt: true, subscription: true, _count: { select: { devices: true } } },
    });
    return tenants;
  });

  app.get('/admin/stats', async (request) => {
    await requireAdmin(request, undefined as never);
    const [tenants, active, trials, suspended, paid] = await Promise.all([
      db.tenant.count(),
      db.subscription.count({ where: { expiresAt: { gt: now() }, suspendedAt: null, isTrial: false } }),
      db.subscription.count({ where: { expiresAt: { gt: now() }, suspendedAt: null, isTrial: true } }),
      db.subscription.count({ where: { suspendedAt: { not: null } } }),
      db.paymentIntent.aggregate({ where: { status: 'CONFIRMED' }, _sum: { amount: true } }),
    ]);
    return { tenants, active, trials, suspended, revenue: paid._sum.amount ?? 0 };
  });

  app.post('/admin/tenants/:id/subscription', async (request) => {
    const adminId = await requireAdmin(request, undefined as never);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = z
      .object({
        action: z.enum(['suspend', 'resume', 'extend', 'setPlan']),
        reason: z.string().trim().min(3).max(500),
        days: z.number().int().min(1).max(366).optional(),
        planCode: z.string().optional(),
      })
      .parse(request.body);
    const subscription = await db.subscription.findUnique({ where: { tenantId: id } });
    if (!subscription) throw new ApiError(404, 'Abonnement introuvable.');
    const data: Record<string, unknown> = {};
    if (input.action === 'suspend') data['suspendedAt'] = now();
    if (input.action === 'resume') data['suspendedAt'] = null;
    if (input.action === 'extend') {
      if (!input.days) throw new ApiError(400, 'Indiquez le nombre de jours.');
      const from = Math.max(subscription.expiresAt.getTime(), now().getTime());
      data['expiresAt'] = new Date(from + input.days * DAY);
    }
    if (input.action === 'setPlan') {
      if (!input.planCode || !(await db.plan.findUnique({ where: { code: input.planCode } }))) throw new ApiError(404, 'Formule introuvable.');
      data['planCode'] = input.planCode;
    }
    await db.$transaction([
      db.subscription.update({ where: { tenantId: id }, data }),
      db.subscriptionEvent.create({ data: { id: newId(), tenantId: id, type: `admin.${input.action}`, details: input, actor: adminId } }),
    ]);
    await audit(adminId, `subscription.${input.action}`, { tenantId: id, ...input });
    return db.subscription.findUnique({ where: { tenantId: id } });
  });

  app.get('/admin/plans', async (request) => {
    await requireAdmin(request, undefined as never);
    return db.plan.findMany({ orderBy: { price: 'asc' } });
  });

  app.put('/admin/plans/:code', async (request) => {
    const adminId = await requireAdmin(request, undefined as never);
    const { code } = z.object({ code: z.string() }).parse(request.params);
    const input = z.object({ name: z.string().min(1).max(60), price: z.number().int().min(0), maxUsers: z.number().int().min(1), maxStores: z.number().int().min(1), isActive: z.boolean() }).parse(request.body);
    const plan = await db.plan.update({ where: { code }, data: input });
    await audit(adminId, 'plan.update', { code, ...input });
    return plan;
  });

  app.get('/admin/settings', async (request) => {
    await requireAdmin(request, undefined as never);
    return { trialDays: await setting('trialDays', 14), graceDays: await setting('graceDays', 3), offlineDays: await setting('offlineDays', 7) };
  });

  app.put('/admin/settings', async (request) => {
    const adminId = await requireAdmin(request, undefined as never);
    const input = z.object({ trialDays: z.number().int().min(0).max(365), graceDays: z.number().int().min(0).max(90), offlineDays: z.number().int().min(1).max(90) }).parse(request.body);
    for (const [key, value] of Object.entries(input)) {
      await db.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    await audit(adminId, 'settings.update', input);
    return input;
  });

  app.get('/admin/payments', async (request) => {
    await requireAdmin(request, undefined as never);
    return db.paymentIntent.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { tenant: { select: { name: true } } } });
  });

  app.get('/admin/tickets', async (request) => {
    await requireAdmin(request, undefined as never);
    return db.supportTicket.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { tenant: { select: { name: true, email: true } } } });
  });

  app.post('/admin/tickets/:id/reply', async (request) => {
    const adminId = await requireAdmin(request, undefined as never);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = z.object({ reply: z.string().trim().min(1).max(5000) }).parse(request.body);
    const ticket = await db.supportTicket.update({ where: { id }, data: { reply: input.reply, status: 'ANSWERED' } });
    await audit(adminId, 'ticket.reply', { id });
    return ticket;
  });

  app.post('/admin/releases', async (request) => {
    const adminId = await requireAdmin(request, undefined as never);
    const input = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), url: z.url().startsWith('https://'), sha512: z.string().min(40).max(200), notes: z.string().max(5000) }).parse(request.body);
    const release = await db.appRelease.create({ data: { id: newId(), ...input } });
    await audit(adminId, 'release.publish', { version: input.version });
    return release;
  });

  app.get('/admin/logs', async (request) => {
    await requireAdmin(request, undefined as never);
    return db.technicalLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  });

  return app;
}
