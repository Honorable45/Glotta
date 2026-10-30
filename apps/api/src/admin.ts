import { createHash, randomBytes } from 'node:crypto';
import { decodeOfflineRequest, hashPassword, planFeatures, verifyPassword } from '@gestion/license';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { v7 as newId } from 'uuid';
import { z } from 'zod';
import { ApiError, type Shared } from './app';
import type { Prisma } from './generated/client';
import { generateLicenseKey, hashLicenseKey } from './licenseKeys';
import { buildReceipt, receiptNumber } from './receipt';
import { newTotpSecret, verifyTotp } from './totp';

const DAY = 86_400_000;
const ADMIN_SESSION_MS = 8 * 3_600_000;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const reasonSchema = z.string().trim().min(3).max(500);
const optionalText = (max: number) => z.string().trim().max(max).nullable().transform((value) => value || null);
const VENDOR_KEYS = ['vendorName', 'vendorAddress', 'vendorPhone', 'vendorEmail'] as const;

const customerInput = z.object({
  name: z.string().trim().min(1).max(160),
  contactName: optionalText(160),
  email: optionalText(160),
  phone: optionalText(40),
  address: optionalText(300),
  notes: optionalText(2000),
});

const editionInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500),
  price: z.number().int().min(0),
  maxUsers: z.number().int().min(1),
  maxStores: z.number().int().min(1),
  maxDevices: z.number().int().min(1).max(100),
  features: z.array(z.enum(planFeatures)),
  majorVersion: z.number().int().min(0),
  syncQuotaMb: z.number().int().min(0),
  isActive: z.boolean(),
});

export async function registerAdminRoutes(app: FastifyInstance, shared: Shared, authLimit: object) {
  const { db, now, vault, issueToken, attachDevice } = shared;

  async function currentAdmin(request: FastifyRequest) {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new ApiError(401, 'Non authentifié.');
    const session = await db.adminSession.findUnique({ where: { tokenHash: sha256(token) } });
    if (!session || session.expiresAt < now()) throw new ApiError(401, 'Session expirée.');
    const admin = await db.platformAdmin.findUnique({ where: { id: session.adminId } });
    if (!admin || admin.disabledAt) throw new ApiError(401, 'Session expirée.');
    return admin;
  }
  const requireAdmin = async (request: FastifyRequest) => (await currentAdmin(request)).id;
  async function requireOwner(request: FastifyRequest) {
    const admin = await currentAdmin(request);
    if (admin.role !== 'OWNER') throw new ApiError(403, 'Réservé au propriétaire de la plateforme.');
    return admin.id;
  }
  const audit = (adminId: string, action: string, details: object) => db.adminAuditLog.create({ data: { id: newId(), adminId, action, details: details as never } });
  const event = (tx: Prisma.TransactionClient, licenseId: string, type: string, details: object, actor: string) =>
    tx.licenseEvent.create({ data: { id: newId(), licenseId, type, details: details as never, actor } });

  const params = (request: FastifyRequest) => z.object({ id: z.string().min(1) }).parse(request.params).id;

  app.post('/admin/login', authLimit, async (request) => {
    const input = z.object({ email: z.email(), password: z.string().max(200), totp: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const admin = await db.platformAdmin.findUnique({ where: { email: input.email.toLowerCase() } });
    const valid = admin && !admin.disabledAt && (await verifyPassword(input.password, admin.passwordHash)) && verifyTotp(admin.totpSecret, input.totp, now().getTime());
    if (!valid) throw new ApiError(401, 'Identifiants incorrects.');
    const token = randomBytes(32).toString('base64url');
    await db.adminSession.create({ data: { tokenHash: sha256(token), adminId: admin.id, expiresAt: new Date(now().getTime() + ADMIN_SESSION_MS) } });
    await audit(admin.id, 'admin.login', {});
    return { token, role: admin.role };
  });

  app.post('/admin/logout', async (request) => {
    await requireAdmin(request);
    await db.adminSession.delete({ where: { tokenHash: sha256(request.headers.authorization!.slice(7)) } });
    return { ok: true };
  });

  // Tableau de bord

  app.get('/admin/dashboard', async (request) => {
    await requireAdmin(request);
    const monthStart = new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), 1));
    const [customers, byStatus, trials, activations, pendingSales, revenue, monthRevenue] = await Promise.all([
      db.customer.count(),
      db.license.groupBy({ by: ['status'], where: { isTrial: false }, _count: true }),
      db.license.count({ where: { isTrial: true, status: 'ACTIVE' } }),
      db.activation.count({ where: { releasedAt: null } }),
      db.sale.count({ where: { status: 'PENDING' } }),
      db.sale.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
      db.sale.aggregate({ where: { status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amount: true } }),
    ]);
    const count = (status: string) => byStatus.find((row) => row.status === status)?._count ?? 0;
    return {
      customers,
      activeLicenses: count('ACTIVE'),
      pendingLicenses: count('PENDING'),
      suspendedLicenses: count('SUSPENDED'),
      revokedLicenses: count('REVOKED'),
      trials,
      activations,
      pendingSales,
      revenue: revenue._sum.amount ?? 0,
      monthRevenue: monthRevenue._sum.amount ?? 0,
    };
  });

  // Clients

  app.get('/admin/customers', async (request) => {
    await requireAdmin(request);
    const { search } = z.object({ search: z.string().trim().max(160).default('') }).parse(request.query);
    return db.customer.findMany({
      ...(search ? { where: { OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { email: { contains: search, mode: 'insensitive' as const } }, { phone: { contains: search } }] } } : {}),
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { _count: { select: { licenses: true, sales: true } } },
    });
  });

  app.get('/admin/customers/:id', async (request) => {
    await requireAdmin(request);
    const customer = await db.customer.findUnique({
      where: { id: params(request) },
      include: {
        licenses: { orderBy: { createdAt: 'desc' }, select: { id: true, keyHint: true, editionName: true, status: true, isTrial: true, createdAt: true } },
        sales: { orderBy: { number: 'desc' }, select: { id: true, number: true, status: true, amount: true, kind: true, createdAt: true, editionCode: true } },
      },
    });
    if (!customer) throw new ApiError(404, 'Client introuvable.');
    return customer;
  });

  app.post('/admin/customers', async (request) => {
    const adminId = await requireAdmin(request);
    const input = customerInput.parse(request.body);
    const customer = await db.customer.create({ data: { id: newId(), ...input } });
    await audit(adminId, 'customer.create', { id: customer.id, name: customer.name });
    return customer;
  });

  app.put('/admin/customers/:id', async (request) => {
    const adminId = await requireAdmin(request);
    const id = params(request);
    const input = customerInput.parse(request.body);
    if (!(await db.customer.findUnique({ where: { id } }))) throw new ApiError(404, 'Client introuvable.');
    const customer = await db.customer.update({ where: { id }, data: input });
    await audit(adminId, 'customer.update', { id });
    return customer;
  });

  // Éditions et tarifs

  app.get('/admin/editions', async (request) => {
    await requireAdmin(request);
    return { editions: await db.edition.findMany({ orderBy: { price: 'asc' } }), features: planFeatures };
  });

  app.post('/admin/editions', async (request) => {
    const adminId = await requireOwner(request);
    const input = editionInput.extend({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,30}$/) }).parse(request.body);
    if (await db.edition.findUnique({ where: { code: input.code } })) throw new ApiError(409, 'Ce code existe déjà.');
    const edition = await db.edition.create({ data: input });
    await audit(adminId, 'edition.create', input);
    return edition;
  });

  app.put('/admin/editions/:id', async (request) => {
    const adminId = await requireOwner(request);
    const code = params(request);
    const input = editionInput.parse(request.body);
    if (!(await db.edition.findUnique({ where: { code } }))) throw new ApiError(404, 'Édition introuvable.');
    const edition = await db.edition.update({ where: { code }, data: input });
    await audit(adminId, 'edition.update', { code, ...input });
    return edition;
  });

  // Ventes : le paiement n'est jamais présumé.

  const licenseFromEdition = (edition: { code: string; name: string; features: string[]; maxUsers: number; maxStores: number; maxDevices: number; syncQuotaMb: number; majorVersion: number }, customerId: string) => {
    const key = generateLicenseKey();
    return {
      id: newId(),
      keyHash: hashLicenseKey(key),
      keyEncrypted: vault.seal(key),
      keyHint: key.slice(-5),
      customerId,
      editionCode: edition.code,
      editionName: edition.name,
      features: edition.features,
      maxUsers: edition.maxUsers,
      maxStores: edition.maxStores,
      maxDevices: edition.maxDevices,
      syncQuotaMb: edition.syncQuotaMb,
      maxMajorVersion: edition.majorVersion,
    };
  };

  app.get('/admin/sales', async (request) => {
    await requireAdmin(request);
    const { status } = z.object({ status: z.enum(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED']).optional() }).parse(request.query);
    return db.sale.findMany({
      ...(status ? { where: { status } } : {}),
      orderBy: { number: 'desc' },
      take: 500,
      include: { customer: { select: { name: true } }, edition: { select: { name: true } }, license: { select: { keyHint: true } } },
    });
  });

  app.post('/admin/sales', async (request) => {
    const adminId = await requireAdmin(request);
    const input = z
      .object({
        customerId: z.string().min(1),
        editionCode: z.string().min(1),
        /** Absent : le prix de l'édition s'applique. */
        amount: z.number().int().min(0).optional(),
        /** Présent : vente d'une grande version pour une licence existante. */
        upgradeLicenseId: z.string().min(1).optional(),
      })
      .parse(request.body);
    const edition = await db.edition.findUnique({ where: { code: input.editionCode } });
    if (!edition || !edition.isActive) throw new ApiError(404, 'Édition introuvable ou retirée de la vente.');
    if (!(await db.customer.findUnique({ where: { id: input.customerId } }))) throw new ApiError(404, 'Client introuvable.');
    const amount = input.amount ?? edition.price;
    const sale = await db.$transaction(async (tx) => {
      let licenseId: string;
      if (input.upgradeLicenseId) {
        const license = await tx.license.findUnique({ where: { id: input.upgradeLicenseId } });
        if (!license || license.customerId !== input.customerId) throw new ApiError(404, 'Licence introuvable pour ce client.');
        if (license.isTrial) throw new ApiError(409, 'Un essai ne se met pas à niveau : créez une nouvelle vente.');
        if (edition.majorVersion <= license.maxMajorVersion) throw new ApiError(409, 'Cette licence couvre déjà cette version.');
        licenseId = license.id;
      } else {
        const license = await tx.license.create({ data: licenseFromEdition(edition, input.customerId) });
        licenseId = license.id;
        await event(tx, licenseId, 'license.create', { status: 'PENDING' }, adminId);
      }
      return tx.sale.create({
        data: { id: newId(), customerId: input.customerId, editionCode: edition.code, licenseId, kind: input.upgradeLicenseId ? 'UPGRADE' : 'NEW', targetMajor: edition.majorVersion, amount, createdBy: adminId },
      });
    });
    await audit(adminId, 'sale.create', { id: sale.id, amount, editionCode: edition.code });
    return sale;
  });

  /** Passage unique : deux confirmations simultanées ne délivrent qu'une fois. */
  async function changeSale(tx: Prisma.TransactionClient, id: string, from: string[], data: Prisma.SaleUpdateManyMutationInput) {
    const claimed = await tx.sale.updateMany({ where: { id, status: { in: from } }, data });
    if (claimed.count === 0) throw new ApiError(409, 'Cette vente n’est plus dans un état compatible.');
    return tx.sale.findUniqueOrThrow({ where: { id } });
  }

  app.post('/admin/sales/:id/confirm', async (request) => {
    const adminId = await requireAdmin(request);
    const id = params(request);
    const input = z
      .object({
        paymentMethod: z.string().trim().min(2).max(60),
        paymentReference: optionalText(120),
        paidAt: z.iso.date().optional(),
      })
      .parse(request.body);
    const paidAt = input.paidAt ? new Date(`${input.paidAt}T12:00:00Z`) : now();
    if (paidAt.getTime() > now().getTime() + DAY) throw new ApiError(400, 'La date de paiement est dans le futur.');
    const sale = await db.$transaction(async (tx) => {
      const sale = await changeSale(tx, id, ['PENDING'], { status: 'PAID', paymentMethod: input.paymentMethod, paymentReference: input.paymentReference, paidAt, confirmedBy: adminId });
      if (sale.kind === 'UPGRADE') {
        const license = await tx.license.findUniqueOrThrow({ where: { id: sale.licenseId } });
        await tx.license.update({ where: { id: license.id }, data: { maxMajorVersion: Math.max(license.maxMajorVersion, sale.targetMajor) } });
        await event(tx, license.id, 'license.upgrade', { saleId: id, maxMajorVersion: sale.targetMajor }, adminId);
      } else {
        await tx.license.updateMany({ where: { id: sale.licenseId, status: 'PENDING' }, data: { status: 'ACTIVE' } });
        await event(tx, sale.licenseId, 'license.issue', { saleId: id }, adminId);
      }
      return sale;
    });
    await audit(adminId, 'sale.confirm', { id, paymentMethod: input.paymentMethod });
    return sale;
  });

  app.post('/admin/sales/:id/cancel', async (request) => {
    const adminId = await requireAdmin(request);
    const id = params(request);
    const { reason } = z.object({ reason: reasonSchema }).parse(request.body);
    const sale = await db.$transaction(async (tx) => {
      const sale = await changeSale(tx, id, ['PENDING'], { status: 'CANCELLED', statusReason: reason });
      if (sale.kind === 'NEW') {
        await tx.license.update({ where: { id: sale.licenseId }, data: { status: 'REVOKED', statusReason: 'Vente annulée' } });
        await event(tx, sale.licenseId, 'license.revoke', { reason: 'Vente annulée', saleId: id }, adminId);
      }
      return sale;
    });
    await audit(adminId, 'sale.cancel', { id, reason });
    return sale;
  });

  /** Rembourser retire le droit vendu : la licence est révoquée, ou la mise à niveau retirée. */
  app.post('/admin/sales/:id/refund', async (request) => {
    const adminId = await requireOwner(request);
    const id = params(request);
    const { reason } = z.object({ reason: reasonSchema }).parse(request.body);
    const sale = await db.$transaction(async (tx) => {
      const sale = await changeSale(tx, id, ['PAID'], { status: 'REFUNDED', statusReason: reason });
      if (sale.kind === 'NEW') {
        await tx.license.update({ where: { id: sale.licenseId }, data: { status: 'REVOKED', statusReason: `Remboursement : ${reason}` } });
        await event(tx, sale.licenseId, 'license.revoke', { reason, saleId: id }, adminId);
      } else {
        const others = await tx.sale.findMany({ where: { licenseId: sale.licenseId, status: 'PAID', id: { not: id } }, select: { targetMajor: true } });
        const maxMajorVersion = Math.max(...others.map((other) => other.targetMajor));
        await tx.license.update({ where: { id: sale.licenseId }, data: { maxMajorVersion } });
        await event(tx, sale.licenseId, 'license.upgrade.refund', { reason, saleId: id, maxMajorVersion }, adminId);
      }
      return sale;
    });
    await audit(adminId, 'sale.refund', { id, reason });
    return sale;
  });

  app.get('/admin/sales/:id/receipt', async (request, reply) => {
    await requireAdmin(request);
    const sale = await db.sale.findUnique({ where: { id: params(request) }, include: { customer: true, edition: true, license: true } });
    if (!sale) throw new ApiError(404, 'Vente introuvable.');
    if (sale.status !== 'PAID' && sale.status !== 'REFUNDED') throw new ApiError(409, 'Un reçu n’existe qu’après confirmation du paiement.');
    const rows = await db.platformSetting.findMany({ where: { key: { in: [...VENDOR_KEYS] } } });
    const vendor = (key: string) => rows.find((row) => row.key === key)?.value ?? '';
    const pdf = await buildReceipt({
      number: sale.number,
      status: sale.status,
      paidAt: sale.paidAt,
      statusReason: sale.statusReason,
      vendor: { name: vendor('vendorName'), address: vendor('vendorAddress'), phone: vendor('vendorPhone'), email: vendor('vendorEmail') },
      customer: sale.customer,
      description: `${sale.kind === 'UPGRADE' ? 'Mise à niveau' : 'Licence à vie'} ${sale.edition.name}`,
      licenseHint: sale.license.keyHint,
      majorVersion: sale.targetMajor,
      amount: sale.amount,
      paymentMethod: sale.paymentMethod,
      paymentReference: sale.paymentReference,
    });
    return reply.header('content-type', 'application/pdf').header('content-disposition', `attachment; filename="${receiptNumber(sale.number)}.pdf"`).send(pdf);
  });

  // Licences

  const licensePublic = { id: true, keyHint: true, editionName: true, status: true, statusReason: true, isTrial: true, trialEndsAt: true, maxDevices: true, maxMajorVersion: true, createdAt: true, customer: { select: { id: true, name: true } } } as const;

  app.get('/admin/licenses', async (request) => {
    await requireAdmin(request);
    const { status, search } = z.object({ status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']).optional(), search: z.string().trim().max(160).default('') }).parse(request.query);
    const licenses = await db.license.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(search ? { OR: [{ keyHint: { contains: search.toUpperCase() } }, { customer: { name: { contains: search, mode: 'insensitive' as const } } }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { ...licensePublic, _count: { select: { activations: { where: { releasedAt: null } } } } },
    });
    return licenses;
  });

  app.get('/admin/licenses/:id', async (request) => {
    await requireAdmin(request);
    const license = await db.license.findUnique({
      where: { id: params(request) },
      select: {
        ...licensePublic,
        features: true,
        maxUsers: true,
        maxStores: true,
        syncQuotaMb: true,
        syncBytes: true,
        activations: { orderBy: { createdAt: 'desc' }, select: { id: true, deviceName: true, appVersion: true, method: true, lastSeenAt: true, releasedAt: true, releaseReason: true, createdAt: true } },
        events: { orderBy: { createdAt: 'desc' }, take: 100 },
        sales: { orderBy: { number: 'desc' }, select: { id: true, number: true, status: true, amount: true, kind: true } },
      },
    });
    if (!license) throw new ApiError(404, 'Licence introuvable.');
    return { ...license, syncBytes: Number(license.syncBytes) };
  });

  /** Une clé n'est lisible qu'après paiement, et chaque lecture est journalisée. */
  app.post('/admin/licenses/:id/reveal-key', async (request) => {
    const adminId = await requireAdmin(request);
    const id = params(request);
    const license = await db.license.findUnique({ where: { id } });
    if (!license) throw new ApiError(404, 'Licence introuvable.');
    if (license.status === 'PENDING') throw new ApiError(409, 'La clé sera disponible après confirmation du paiement.');
    await audit(adminId, 'license.key.reveal', { id });
    return { key: vault.open(license.keyEncrypted) };
  });

  app.post('/admin/licenses/:id/status', async (request) => {
    const adminId = await requireAdmin(request);
    const id = params(request);
    const input = z.object({ action: z.enum(['suspend', 'resume', 'revoke']), reason: reasonSchema }).parse(request.body);
    const allowed = { suspend: ['ACTIVE'], resume: ['SUSPENDED'], revoke: ['ACTIVE', 'SUSPENDED'] }[input.action];
    const target = { suspend: 'SUSPENDED', resume: 'ACTIVE', revoke: 'REVOKED' }[input.action];
    const claimed = await db.license.updateMany({ where: { id, status: { in: allowed } }, data: { status: target, statusReason: input.action === 'resume' ? null : input.reason } });
    if (claimed.count === 0) throw new ApiError(409, 'Cette licence n’est pas dans un état compatible.');
    await db.$transaction((tx) => event(tx, id, `license.${input.action}`, { reason: input.reason }, adminId));
    await audit(adminId, `license.${input.action}`, { id, reason: input.reason });
    return db.license.findUniqueOrThrow({ where: { id }, select: licensePublic });
  });

  /** Essai : licence distincte, sans vente, dont la date de fin est signée. */
  app.post('/admin/licenses/trial', async (request) => {
    const adminId = await requireAdmin(request);
    const input = z.object({ customerId: z.string().min(1), editionCode: z.string().min(1), days: z.number().int().min(1).max(90).optional() }).parse(request.body);
    const edition = await db.edition.findUnique({ where: { code: input.editionCode } });
    if (!edition) throw new ApiError(404, 'Édition introuvable.');
    if (!(await db.customer.findUnique({ where: { id: input.customerId } }))) throw new ApiError(404, 'Client introuvable.');
    const days = input.days ?? Number((await db.platformSetting.findUnique({ where: { key: 'trialDays' } }))?.value ?? 14);
    const license = await db.$transaction(async (tx) => {
      const created = await tx.license.create({
        data: { ...licenseFromEdition(edition, input.customerId), status: 'ACTIVE', isTrial: true, trialEndsAt: new Date(now().getTime() + days * DAY), maxDevices: 1, syncQuotaMb: 0, features: edition.features.filter((feature) => feature !== 'sync') },
        select: licensePublic,
      });
      await event(tx, created.id, 'license.trial', { days }, adminId);
      return created;
    });
    await audit(adminId, 'license.trial', { id: license.id, days });
    return license;
  });

  // Activations

  app.get('/admin/activations', async (request) => {
    await requireAdmin(request);
    return db.activation.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { id: true, deviceName: true, appVersion: true, method: true, lastSeenAt: true, releasedAt: true, createdAt: true, license: { select: { id: true, keyHint: true, editionName: true, customer: { select: { name: true } } } } },
    });
  });

  /** Ancien poste perdu ou réinstallé : libère la place. Le poste libéré l'apprendra à sa prochaine connexion. */
  app.post('/admin/activations/:id/release', async (request) => {
    const adminId = await requireAdmin(request);
    const id = params(request);
    const { reason } = z.object({ reason: reasonSchema }).parse(request.body);
    const claimed = await db.activation.updateMany({ where: { id, releasedAt: null }, data: { releasedAt: now(), releaseReason: reason } });
    if (claimed.count === 0) throw new ApiError(409, 'Ce poste est déjà libéré.');
    const activation = await db.activation.findUniqueOrThrow({ where: { id } });
    await db.$transaction((tx) => event(tx, activation.licenseId, 'activation.release', { activationId: id, reason }, adminId));
    await audit(adminId, 'activation.release', { id, reason });
    return { ok: true };
  });

  /** Activation hors ligne : la demande signée par le poste donne un jeton signé par le serveur. */
  app.post('/admin/activations/offline', async (request) => {
    const adminId = await requireAdmin(request);
    const { request: encoded } = z.object({ request: z.string().min(10).max(8000) }).parse(request.body);
    const decoded = decodeOfflineRequest(encoded);
    if (!decoded) throw new ApiError(400, 'Demande illisible ou signature invalide.');
    const { license, activation } = await attachDevice({ ...decoded, deviceName: String(decoded.deviceName).slice(0, 120), appVersion: String(decoded.appVersion).slice(0, 30), method: 'OFFLINE', actor: adminId });
    await audit(adminId, 'activation.offline', { id: activation.id, licenseId: license.id });
    return { token: issueToken(license, activation), fileName: `licence-${license.keyHint}.gclicence`, deviceName: activation.deviceName };
  });

  // Paramètres

  app.get('/admin/settings', async (request) => {
    await requireAdmin(request);
    const rows = await db.platformSetting.findMany();
    const read = (key: string, fallback = '') => rows.find((row) => row.key === key)?.value ?? fallback;
    return { trialDays: Number(read('trialDays', '14')), ...Object.fromEntries(VENDOR_KEYS.map((key) => [key, read(key)])) };
  });

  app.put('/admin/settings', async (request) => {
    const adminId = await requireOwner(request);
    const input = z.object({ trialDays: z.number().int().min(1).max(90), vendorName: z.string().trim().max(160), vendorAddress: z.string().trim().max(300), vendorPhone: z.string().trim().max(40), vendorEmail: z.string().trim().max(160) }).parse(request.body);
    for (const [key, raw] of Object.entries(input)) {
      const value = String(raw);
      await db.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    }
    await audit(adminId, 'settings.update', input);
    return input;
  });

  // Administrateurs

  app.get('/admin/admins', async (request) => {
    await requireOwner(request);
    return db.platformAdmin.findMany({ orderBy: { email: 'asc' }, select: { id: true, email: true, name: true, role: true, disabledAt: true } });
  });

  app.post('/admin/admins', async (request) => {
    const adminId = await requireOwner(request);
    const input = z.object({ email: z.email().transform((value) => value.toLowerCase()), name: z.string().trim().min(1).max(120), role: z.enum(['OWNER', 'ADMIN']), password: z.string().min(12).max(200) }).parse(request.body);
    if (await db.platformAdmin.findUnique({ where: { email: input.email } })) throw new ApiError(409, 'Cette adresse est déjà utilisée.');
    const totpSecret = newTotpSecret();
    const id = newId();
    await db.platformAdmin.create({ data: { id, email: input.email, name: input.name, role: input.role, passwordHash: await hashPassword(input.password), totpSecret } });
    await audit(adminId, 'admin.create', { id, email: input.email, role: input.role });
    return { id, totpSecret };
  });

  app.post('/admin/admins/:id/disabled', async (request) => {
    const adminId = await requireOwner(request);
    const id = params(request);
    const { disabled } = z.object({ disabled: z.boolean() }).parse(request.body);
    if (id === adminId) throw new ApiError(409, 'Vous ne pouvez pas désactiver votre propre compte.');
    await db.platformAdmin.update({ where: { id }, data: { disabledAt: disabled ? now() : null } });
    if (disabled) await db.adminSession.deleteMany({ where: { adminId: id } });
    await audit(adminId, disabled ? 'admin.disable' : 'admin.enable', { id });
    return { ok: true };
  });

  // Journal, assistance, publications, journaux techniques

  app.get('/admin/audit', async (request) => {
    await requireAdmin(request);
    const [rows, admins] = await Promise.all([db.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }), db.platformAdmin.findMany({ select: { id: true, email: true } })]);
    return rows.map((row) => ({ ...row, adminEmail: admins.find((admin) => admin.id === row.adminId)?.email ?? row.adminId }));
  });

  app.get('/admin/tickets', async (request) => {
    await requireAdmin(request);
    return db.supportTicket.findMany({ orderBy: { createdAt: 'desc' }, take: 500, include: { customer: { select: { name: true, email: true } } } });
  });

  app.post('/admin/tickets/:id/reply', async (request) => {
    const adminId = await requireAdmin(request);
    const id = params(request);
    const input = z.object({ reply: z.string().trim().min(1).max(5000) }).parse(request.body);
    const ticket = await db.supportTicket.update({ where: { id }, data: { reply: input.reply, status: 'ANSWERED' } });
    await audit(adminId, 'ticket.reply', { id });
    return ticket;
  });

  app.post('/admin/releases', async (request) => {
    const adminId = await requireOwner(request);
    const input = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), url: z.url().startsWith('https://'), sha512: z.string().min(40).max(200), notes: z.string().max(5000) }).parse(request.body);
    const release = await db.appRelease.create({ data: { id: newId(), ...input } });
    await audit(adminId, 'release.publish', { version: input.version });
    return release;
  });

  app.get('/admin/logs', async (request) => {
    await requireAdmin(request);
    return db.technicalLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  });
}
