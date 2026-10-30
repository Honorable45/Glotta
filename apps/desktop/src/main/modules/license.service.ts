import { channelFeatures, writeChannels, type Channel, type LicenseState } from '@gestion/contracts';
import { canOperate, coversVersion, encodeOfflineRequest, licenseStatus, signMessage, verifyLicense, type LicensePayload, type PlanFeature } from '@gestion/license';
import { AppError } from '../core/errors';
import type { DeviceIdentity } from '../services/deviceIdentity';

const TIMEOUT_MS = 15_000;
const NOT_CONFIGURED = 'Le serveur des licences n’est pas configuré dans cette version. Utilisez l’activation hors ligne.';

interface Stored {
  token: string | null;
  /** Heure la plus tardive vue, utile seulement pour la fin d'un essai. */
  lastSeen: string | null;
}

export function createLicenseService(options: {
  store: { read(): string | null; write(value: string): void };
  identity: DeviceIdentity;
  apiUrl: string | null;
  publicKey: string | null;
  deviceName: string;
  appVersion: string;
  testToken?: string | null;
  now?: () => Date;
}) {
  const { store, identity, apiUrl, publicKey, deviceName, appVersion } = options;
  const now = options.now ?? (() => new Date());
  let state: Stored = { token: null, lastSeen: null };
  const writes = new Set<string>(writeChannels);

  const decode = (token: string | null) => (token && publicKey ? verifyLicense(token, publicKey) : null);

  const payload = (): LicensePayload | null => {
    if (options.testToken) return decode(options.testToken);
    const verified = decode(state.token);
    // Un jeton copié depuis un autre poste ne vaut rien ici.
    return verified?.deviceFingerprint === identity.fingerprint ? verified : null;
  };

  function load() {
    try {
      state = { ...state, ...(JSON.parse(store.read() ?? '{}') as Partial<Stored>) };
    } catch {
      // Fichier illisible : la licence est absente, jamais valide, et les données restent intactes.
    }
  }

  const save = () => store.write(JSON.stringify(state));
  const status = () => licenseStatus(payload(), now(), state.lastSeen ? new Date(state.lastSeen) : null);

  function touchTrial() {
    if (!payload()?.isTrial) return;
    const current = now();
    if (!state.lastSeen || current > new Date(state.lastSeen)) {
      state.lastSeen = current.toISOString();
      save();
    }
  }

  function view(): LicenseState {
    const license = payload();
    const current = status();
    return {
      configured: Boolean(publicKey),
      online: Boolean(apiUrl),
      status: current,
      canOperate: canOperate(current),
      editionName: license?.editionName ?? null,
      isTrial: license?.isTrial ?? false,
      trialEndsAt: license?.trialEndsAt ?? null,
      features: license?.features ?? [],
      maxUsers: license?.maxUsers ?? null,
      maxMajorVersion: license?.maxMajorVersion ?? null,
    };
  }

  /** Seule porte d'entrée d'un nouveau statut : un jeton signé, destiné à ce poste, et pas plus ancien que l'actuel. */
  function accept(next: string): LicenseState {
    const verified = decode(next);
    if (!verified) throw new AppError('FORBIDDEN', 'La licence reçue est invalide.');
    if (verified.deviceFingerprint !== identity.fingerprint) throw new AppError('CONFLICT', 'Cette licence a été générée pour un autre ordinateur.');
    const current = decode(state.token);
    if (current && current.deviceFingerprint === identity.fingerprint && Date.parse(verified.issuedAt) < Date.parse(current.issuedAt)) {
      throw new AppError('CONFLICT', 'Cette licence est plus ancienne que celle déjà enregistrée sur ce poste.');
    }
    state.token = next.trim();
    save();
    return view();
  }

  async function request<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    if (!apiUrl) throw new AppError('INTERNAL', NOT_CONFIGURED);
    const headers: Record<string, string> = { ...init.headers };
    if (init.body !== undefined) headers['content-type'] = 'application/json';
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
    if (!response.ok) throw new AppError(response.status === 401 || response.status === 403 ? 'FORBIDDEN' : 'CONFLICT', body.error ?? 'Le serveur a refusé la demande.');
    return body;
  }

  const challenge = async () => (await request<{ challenge: string }>('/v1/challenge', { body: {} })).challenge;

  /** Chaque requête prouve la clé privée du poste, sans dépendre de son horloge. */
  async function signed<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const activationId = payload()?.activationId;
    if (!activationId || options.testToken) throw new AppError('CONFLICT', "Ce poste n'est pas encore activé.");
    const nonce = await challenge();
    return request<T>(path, {
      ...init,
      headers: { 'x-activation-id': activationId, 'x-challenge': nonce, 'x-signature': signMessage(`${nonce}\n${init.method ?? 'POST'}\n${path}`, identity.privateKeyPem) },
    });
  }

  return {
    load,

    async state(): Promise<LicenseState> {
      touchTrial();
      return view();
    },

    /** Appelé avant chaque opération : le blocage ne dépend pas de l'interface, ni jamais du réseau. */
    guard(channel: Channel) {
      const current = status();
      const license = payload();
      const operating = canOperate(current);
      if (writes.has(channel) && !operating) {
        throw new AppError('FORBIDDEN', 'Votre licence ne permet pas cette opération. Vos données restent consultables et exportables.');
      }
      const feature = channelFeatures[channel];
      if (feature && operating && !license?.features.includes(feature)) {
        throw new AppError('FORBIDDEN', 'Cette fonction n’est pas incluse dans votre édition.');
      }
    },

    requireFeature(feature: PlanFeature) {
      if (!payload()?.features.includes(feature)) throw new AppError('FORBIDDEN', 'Cette fonction n’est pas incluse dans votre édition.');
    },

    hasFeature: (feature: PlanFeature) => payload()?.features.includes(feature) ?? false,

    limits: () => ({ maxUsers: payload()?.maxUsers ?? null, maxStores: payload()?.maxStores ?? null }),

    /** Droit aux versions, distinct de la validité : une version non couverte ne change rien à la licence. */
    coversApp: () => coversVersion(payload(), appVersion),
    covers: (version: string) => coversVersion(payload(), version),
    maxMajorVersion: () => payload()?.maxMajorVersion ?? null,

    async activate(licenseKey: string): Promise<LicenseState> {
      const key = licenseKey.trim().toUpperCase();
      const nonce = await challenge();
      const result = await request<{ token: string }>('/v1/activate', {
        body: { licenseKey: key, devicePublicKey: identity.publicKeyPem, deviceName, appVersion, challenge: nonce, signature: signMessage(`activate\n${nonce}\n${key}`, identity.privateKeyPem) },
      });
      return accept(result.token);
    },

    /** Une panne réseau ou un refus laisse la licence telle quelle. */
    async refresh(): Promise<LicenseState> {
      if (apiUrl && payload() && !options.testToken) {
        const result = await signed<{ token: string }>('/v1/activation/status', { body: {} });
        accept(result.token);
      }
      touchTrial();
      return view();
    },

    async transfer(): Promise<LicenseState> {
      const result = await signed<{ token: string }>('/v1/activation/transfer', { body: {} });
      return accept(result.token);
    },

    offlineRequest(licenseKey: string): string {
      return encodeOfflineRequest({ licenseKey: licenseKey.trim().toUpperCase(), devicePublicKey: identity.publicKeyPem, deviceName, appVersion, createdAt: now().toISOString() }, identity.privateKeyPem);
    },

    importToken: (token: string) => accept(token),

    /** Null sans édition incluant la synchronisation : elle attend alors sans rien perdre. */
    syncTransport() {
      if (!apiUrl || !payload()?.features.includes('sync')) return null;
      return {
        push: async (events: { id: string; ciphertext: string }[]) => {
          await signed('/v1/sync/push', { body: { events } });
        },
        pull: (after: string) =>
          signed<{ events: { id: string; ciphertext: string }[]; cursor: string; hasMore: boolean }>(`/v1/sync/pull?after=${encodeURIComponent(after)}`, { method: 'GET' }),
      };
    },

    latestRelease() {
      return request<{ version: string; url: string; notes: string } | null>('/v1/releases/latest', { method: 'GET' });
    },
  };
}
