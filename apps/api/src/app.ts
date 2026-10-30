import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { deviceFingerprint, signLicense, verifyMessage, type LicensePayload, type LicenseServerStatus, type PlanFeature } from '@gestion/license';
import Fastify, { type FastifyRequest } from 'fastify';
import { v7 as newId } from 'uuid';
import { z } from 'zod';
import { registerAdminRoutes } from './admin';
import type { Activation, License, PrismaClient } from './generated/client';
import { createKeyVault, hashLicenseKey } from './licenseKeys';

const CHALLENGE_MS = 5 * 60_000;
const MEGABYTE = 1024n * 1024n;

export interface AppOptions {
  db: PrismaClient;
  licensePrivateKey: string;
  now?: () => Date;
  rateLimitMax?: number;
  /** Derrière un proxy HTTPS : sans cela, tous les clients partageraient une seule limite de requêtes. */
  trustProxy?: boolean;
  /** Dossier compilé de la plateforme d'administration, servi sur /console. */
  adminDist?: string;
}

export class ApiError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

const NOT_ACTIVATED = 'Ce poste n’est pas activé.';

export async function buildApp(options: AppOptions) {
  const { db } = options;
  const now = options.now ?? (() => new Date());
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: options.trustProxy ?? false });
  await app.register(rateLimit, { max: options.rateLimitMax ?? 600, timeWindow: '1 minute' });
  const vault = createKeyVault(options.licensePrivateKey);
  const challengeKey = createHash('sha256').update(`challenge:${options.licensePrivateKey}`).digest();

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

  function issueToken(license: License, activation: Pick<Activation, 'id' | 'deviceFingerprint'>, released = false): string {
    const payload: LicensePayload = {
      v: 2,
      licenseId: license.id,
      activationId: activation.id,
      deviceFingerprint: activation.deviceFingerprint,
      editionCode: license.editionCode,
      editionName: license.editionName,
      features: license.features as PlanFeature[],
      maxUsers: license.maxUsers,
      maxStores: license.maxStores,
      maxMajorVersion: license.maxMajorVersion,
      status: released ? 'RELEASED' : (license.status as LicenseServerStatus),
      isTrial: license.isTrial,
      trialEndsAt: license.trialEndsAt?.toISOString() ?? null,
      issuedAt: now().toISOString(),
    };
    return signLicense(payload, options.licensePrivateKey);
  }

  /** Crée ou réutilise la place du poste. Réactiver le même poste ne consomme aucune place supplémentaire. */
  async function attachDevice(input: { licenseKey: string; devicePublicKey: string; deviceName: string; appVersion: string; method: 'ONLINE' | 'OFFLINE'; actor: string }) {
    const license = await db.license.findUnique({ where: { keyHash: hashLicenseKey(input.licenseKey) } });
    if (!license) throw new ApiError(404, 'Clé de licence inconnue.');
    if (license.status === 'PENDING') throw new ApiError(403, 'Cette licence attend la confirmation du paiement.');
    if (license.status === 'REVOKED') throw new ApiError(403, 'Cette licence a été révoquée.');
    if (license.status === 'SUSPENDED') throw new ApiError(403, 'Cette licence est suspendue. Contactez votre vendeur.');
    let fingerprint: string;
    try {
      fingerprint = deviceFingerprint(input.devicePublicKey);
    } catch {
      throw new ApiError(400, 'Identité du poste illisible.');
    }
    return db.$transaction(async (tx) => {
      // Verrou sur la licence : deux activations simultanées ne dépassent pas la limite de postes.
      await tx.$queryRaw`SELECT "id" FROM "License" WHERE "id" = ${license.id} FOR UPDATE`;
      const existing = await tx.activation.findUnique({ where: { licenseId_deviceFingerprint: { licenseId: license.id, deviceFingerprint: fingerprint } } });
      if (!existing || existing.releasedAt) {
        const used = await tx.activation.count({ where: { licenseId: license.id, releasedAt: null } });
        if (used >= license.maxDevices) throw new ApiError(409, `Cette licence est déjà utilisée sur ${license.maxDevices} ordinateur${license.maxDevices > 1 ? 's' : ''}. Transférez-la depuis l'ancien poste ou contactez votre vendeur.`);
      }
      const data = { deviceName: input.deviceName, appVersion: input.appVersion, method: input.method, lastSeenAt: now(), releasedAt: null, releaseReason: null };
      const activation = await tx.activation.upsert({
        where: { licenseId_deviceFingerprint: { licenseId: license.id, deviceFingerprint: fingerprint } },
        create: { id: newId(), licenseId: license.id, deviceFingerprint: fingerprint, devicePublicKey: input.devicePublicKey, ...data },
        update: data,
      });
      if (!existing || existing.releasedAt) {
        await tx.licenseEvent.create({ data: { id: newId(), licenseId: license.id, type: 'activation.create', details: { activationId: activation.id, deviceName: input.deviceName, method: input.method }, actor: input.actor } });
      }
      return { license, activation };
    });
  }

  const shared = { db, now, vault, issueToken, attachDevice };

  function newChallenge() {
    const stamp = `${now().getTime()}.${randomUUID()}`;
    return `${stamp}.${createHmac('sha256', challengeKey).update(stamp).digest('base64url')}`;
  }

  /** Défi sans état, signé par le serveur et valable cinq minutes. L'heure du poste n'intervient jamais. */
  function checkChallenge(challenge: string) {
    const [time, nonce, mac] = challenge.split('.');
    if (!time || !nonce || !mac) throw new ApiError(401, 'Défi invalide.');
    const expected = createHmac('sha256', challengeKey).update(`${time}.${nonce}`).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected) || now().getTime() - Number(time) > CHALLENGE_MS) throw new ApiError(401, 'Défi expiré.');
  }

  /** Le poste prouve sa clé privée : le serveur ne garde aucun secret partagé. */
  async function requireActivation(request: FastifyRequest) {
    const { 'x-activation-id': id, 'x-challenge': challenge, 'x-signature': signature } = request.headers;
    if (typeof id !== 'string' || typeof challenge !== 'string' || typeof signature !== 'string') throw new ApiError(401, NOT_ACTIVATED);
    checkChallenge(challenge);
    const activation = await db.activation.findUnique({ where: { id }, include: { license: true } });
    if (!activation || !verifyMessage(`${challenge}\n${request.method}\n${request.url}`, signature, activation.devicePublicKey)) throw new ApiError(401, NOT_ACTIVATED);
    await db.activation.update({ where: { id }, data: { lastSeenAt: now() } });
    return activation;
  }

  /** La synchronisation exige une licence en règle et une édition qui l'inclut. */
  async function requireSync(request: FastifyRequest) {
    const activation = await requireActivation(request);
    if (activation.releasedAt) throw new ApiError(401, NOT_ACTIVATED);
    if (activation.license.status !== 'ACTIVE') throw new ApiError(403, 'La synchronisation est interrompue : la licence n’est pas active.');
    if (!activation.license.features.includes('sync')) throw new ApiError(403, 'La synchronisation n’est pas incluse dans votre édition.');
    return activation;
  }

  const authLimit = { config: { rateLimit: { max: options.rateLimitMax ?? 10, timeWindow: '1 minute' } } };

  app.get('/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return { ok: true };
  });

  app.post('/v1/challenge', async () => ({ challenge: newChallenge() }));

  app.post('/v1/activate', authLimit, async (request) => {
    const input = z
      .object({
        licenseKey: z.string().min(10).max(60),
        devicePublicKey: z.string().min(40).max(1000),
        deviceName: z.string().trim().min(1).max(120),
        appVersion: z.string().max(30),
        challenge: z.string().max(200),
        signature: z.string().max(200),
      })
      .parse(request.body);
    checkChallenge(input.challenge);
    if (!verifyMessage(`activate\n${input.challenge}\n${input.licenseKey}`, input.signature, input.devicePublicKey)) throw new ApiError(401, 'Signature du poste invalide.');
    const { license, activation } = await attachDevice({ ...input, method: 'ONLINE', actor: 'device' });
    return { token: issueToken(license, activation) };
  });

  /** Seule source de changement de statut sur le poste : la réponse est signée. */
  app.post('/v1/activation/status', async (request) => {
    const activation = await requireActivation(request);
    return { token: issueToken(activation.license, activation, activation.releasedAt !== null) };
  });

  app.post('/v1/activation/transfer', async (request) => {
    const activation = await requireActivation(request);
    if (activation.releasedAt) return { token: issueToken(activation.license, activation, true) };
    await db.$transaction([
      db.activation.update({ where: { id: activation.id }, data: { releasedAt: now(), releaseReason: 'Transfert depuis le poste' } }),
      db.licenseEvent.create({ data: { id: newId(), licenseId: activation.licenseId, type: 'activation.transfer', details: { activationId: activation.id, deviceName: activation.deviceName }, actor: 'device' } }),
    ]);
    return { token: issueToken(activation.license, activation, true) };
  });

  app.post('/v1/sync/push', { bodyLimit: 8 * 1024 * 1024 }, async (request) => {
    const activation = await requireSync(request);
    const { events } = z.object({ events: z.array(z.object({ id: z.uuid(), ciphertext: z.string().min(1).max(4_000_000) })).max(500) }).parse(request.body);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "License" WHERE "id" = ${activation.licenseId} FOR UPDATE`;
      // Un renvoi après coupure est sans effet : l'identifiant de l'événement est unique.
      const known = new Set((await tx.syncEnvelope.findMany({ where: { id: { in: events.map((event) => event.id) } }, select: { id: true } })).map((row) => row.id));
      const fresh = events.filter((event) => !known.has(event.id));
      const added = fresh.reduce((total, event) => total + BigInt(event.ciphertext.length), 0n);
      const license = await tx.license.findUniqueOrThrow({ where: { id: activation.licenseId } });
      if (license.syncBytes + added > BigInt(license.syncQuotaMb) * MEGABYTE) throw new ApiError(413, 'Le stockage de synchronisation de cette licence est plein. Contactez votre vendeur.');
      await tx.syncEnvelope.createMany({ data: fresh.map((event) => ({ id: event.id, licenseId: activation.licenseId, activationId: activation.id, ciphertext: event.ciphertext })), skipDuplicates: true });
      await tx.license.update({ where: { id: license.id }, data: { syncBytes: { increment: added } } });
    });
    return { accepted: events.length };
  });

  app.get('/v1/sync/pull', async (request) => {
    const activation = await requireSync(request);
    const { after, limit } = z.object({ after: z.coerce.bigint().min(0n), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(request.query);
    const rows = await db.syncEnvelope.findMany({ where: { licenseId: activation.licenseId, seq: { gt: after } }, orderBy: { seq: 'asc' }, take: limit });
    return {
      events: rows.filter((row) => row.activationId !== activation.id).map((row) => ({ id: row.id, ciphertext: row.ciphertext })),
      cursor: String(rows.at(-1)?.seq ?? after),
      hasMore: rows.length === limit,
    };
  });

  app.post('/v1/support', async (request) => {
    const activation = await requireActivation(request);
    if (activation.releasedAt) throw new ApiError(401, NOT_ACTIVATED);
    const input = z.object({ subject: z.string().trim().min(1).max(200), message: z.string().trim().min(1).max(5000) }).parse(request.body);
    const id = newId();
    await db.supportTicket.create({ data: { id, customerId: activation.license.customerId, ...input } });
    return { id };
  });

  app.get('/v1/releases/latest', async () => {
    return db.appRelease.findFirst({ orderBy: { publishedAt: 'desc' }, select: { version: true, url: true, sha512: true, notes: true } });
  });

  await registerAdminRoutes(app, shared, authLimit);
  return app;
}

export type Shared = {
  db: PrismaClient;
  now: () => Date;
  vault: ReturnType<typeof createKeyVault>;
  issueToken: (license: License, activation: Pick<Activation, 'id' | 'deviceFingerprint'>, released?: boolean) => string;
  attachDevice: (input: { licenseKey: string; devicePublicKey: string; deviceName: string; appVersion: string; method: 'ONLINE' | 'OFFLINE'; actor: string }) => Promise<{ license: License; activation: Activation }>;
};
