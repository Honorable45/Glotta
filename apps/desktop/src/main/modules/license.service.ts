import { channelFeatures, writeChannels, type Channel, type LicenseState, type PlanItem } from '@gestion/contracts';
import { canOperate, licenseStatus, verifyLicense, type LicensePayload, type PlanFeature } from '@gestion/license';
import { AppError } from '../core/errors';
import type { Context } from './commerce.shared';

const TOKEN_KEY = 'license.token';
const SECRET_KEY = 'license.deviceSecret';
const SEEN_KEY = 'license.lastSeen';
const TIMEOUT_MS = 15_000;

const NOT_CONFIGURED = 'Le serveur des abonnements n’est pas configuré dans cette version.';

export function createLicenseService(options: Context & { apiUrl: string | null; publicKey: string | null; deviceName: string; testToken?: string | null; now?: () => Date }) {
  const { db, deviceId, apiUrl, publicKey } = options;
  const now = options.now ?? (() => new Date());
  let token: string | null = options.testToken ?? null;
  let lastSeen: Date | null = null;
  let loaded = false;
  const configured = Boolean(apiUrl && publicKey);
  const writes = new Set<string>(writeChannels);

  const read = async (key: string) => (await db.setting.findUnique({ where: { key } }))?.value ?? null;
  const write = (key: string, value: string) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

  const payload = (): LicensePayload | null => {
    if (!token || !publicKey) return null;
    const verified = verifyLicense(token, publicKey);
    // Un jeton copié depuis un autre poste ne vaut rien ici.
    return verified && (options.testToken || verified.deviceId === deviceId) ? verified : null;
  };

  async function load() {
    if (loaded) return;
    token ??= await read(TOKEN_KEY);
    const seen = await read(SEEN_KEY);
    lastSeen = seen ? new Date(seen) : null;
    loaded = true;
  }

  const status = () => licenseStatus(payload(), now(), lastSeen);

  /** Mémorise l'heure la plus tardive vue : reculer l'horloge est alors détectable. */
  async function touch() {
    const current = now();
    if (!lastSeen || current > lastSeen) {
      lastSeen = current;
      await write(SEEN_KEY, current.toISOString());
    }
  }

  function view(): LicenseState {
    const license = payload();
    const current = status();
    return {
      configured,
      status: current,
      canOperate: canOperate(current),
      planCode: license?.planCode ?? null,
      isTrial: license?.isTrial ?? false,
      expiresAt: license?.expiresAt ?? null,
      graceUntil: license?.graceUntil ?? null,
      features: license?.features ?? [],
      maxUsers: license?.maxUsers ?? null,
    };
  }

  async function request<T>(path: string, init: { method?: string; body?: unknown; device?: boolean } = {}): Promise<T> {
    if (!apiUrl) throw new AppError('INTERNAL', NOT_CONFIGURED);
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    if (init.device) {
      const secret = await read(SECRET_KEY);
      if (!secret) throw new AppError('CONFLICT', "Ce poste n'est pas encore activé.");
      headers['x-device-id'] = deviceId;
      headers['x-device-secret'] = secret;
    }
    let response: Response;
    try {
      response = await fetch(`${apiUrl}${path}`, {
        method: init.method ?? 'POST',
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch {
      throw new AppError('INTERNAL', 'Connexion au serveur impossible. Vérifiez votre accès à Internet.');
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string } & T;
    if (!response.ok) throw new AppError(response.status === 401 ? 'FORBIDDEN' : 'CONFLICT', body.error ?? 'Le serveur a refusé la demande.');
    return body;
  }

  async function store(next: string, secret?: string) {
    if (!publicKey || !verifyLicense(next, publicKey)) throw new AppError('FORBIDDEN', 'La licence reçue est invalide.');
    token = next;
    await write(TOKEN_KEY, next);
    if (secret) await write(SECRET_KEY, secret);
    await touch();
  }

  return {
    /** À attendre avant d'accepter la moindre requête : sinon le contrôle verrait une licence absente. */
    load,

    async state(): Promise<LicenseState> {
      await load();
      await touch();
      return view();
    },

    /** Appelé avant chaque opération : le blocage ne dépend pas de l'interface. */
    guard(channel: Channel) {
      const current = status();
      const license = payload();
      const operating = canOperate(current);
      if (writes.has(channel) && !operating) {
        throw new AppError('FORBIDDEN', 'Votre abonnement ne permet plus cette opération. Vos données restent consultables et exportables.');
      }
      const feature = channelFeatures[channel];
      if (feature && operating && !license?.features.includes(feature)) {
        throw new AppError('FORBIDDEN', 'Cette fonction n’est pas incluse dans votre formule.');
      }
    },

    requireFeature(feature: PlanFeature) {
      if (!payload()?.features.includes(feature)) throw new AppError('FORBIDDEN', 'Cette fonction n’est pas incluse dans votre formule.');
    },

    hasFeature: (feature: PlanFeature) => payload()?.features.includes(feature) ?? false,

    limits: () => ({ maxUsers: payload()?.maxUsers ?? null, maxStores: payload()?.maxStores ?? null }),

    async plans(): Promise<PlanItem[]> {
      return request<PlanItem[]>('/v1/plans', { method: 'GET' });
    },

    async signup(email: string, password: string, companyName: string): Promise<LicenseState> {
      await load();
      const result = await request<{ token: string; deviceSecret: string }>('/v1/signup', {
        body: { email, password, companyName, phone: null, deviceId, deviceName: options.deviceName },
      });
      await store(result.token, result.deviceSecret);
      return view();
    },

    async activate(email: string, password: string): Promise<LicenseState> {
      await load();
      const result = await request<{ token: string; deviceSecret: string }>('/v1/activate', {
        body: { email, password, deviceId, deviceName: options.deviceName },
      });
      await store(result.token, result.deviceSecret);
      return view();
    },

    async refresh(): Promise<LicenseState> {
      await load();
      if (!options.testToken && configured && (await read(SECRET_KEY))) {
        const result = await request<{ token: string }>('/v1/license/refresh', { body: {}, device: true });
        await store(result.token);
      }
      await touch();
      return view();
    },

    /** Null tant que ce poste n'est pas activé : la synchronisation attend alors sans rien perdre. */
    syncTransport() {
      if (!configured) return null;
      return {
        push: async (events: { id: string; ciphertext: string }[]) => {
          await request('/v1/sync/push', { body: { events }, device: true });
        },
        pull: (after: string) =>
          request<{ events: { id: string; ciphertext: string }[]; cursor: string; hasMore: boolean }>(`/v1/sync/pull?after=${encodeURIComponent(after)}`, { method: 'GET', device: true }),
      };
    },

    latestRelease() {
      return request<{ version: string; url: string; notes: string } | null>('/v1/releases/latest', { method: 'GET' });
    },

    pay(planCode: string, months: number) {
      return request<{ intentId: string; payUrl: string }>('/v1/payments', { body: { planCode, months }, device: true });
    },

    async paymentStatus(intentId: string) {
      const result = await request<{ status: string; token: string }>(`/v1/payments/${encodeURIComponent(intentId)}`, { method: 'GET', device: true });
      await store(result.token);
      return { status: result.status };
    },
  };
}
