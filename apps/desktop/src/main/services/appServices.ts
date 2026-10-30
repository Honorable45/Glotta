import type { SystemStatus, Theme } from '@gestion/contracts';
import { themeSchema } from '@gestion/contracts';
import { checkIntegrity, recordChange, verifyAuditChain, type PrismaClient } from '@gestion/db-local';
import { newId } from '@gestion/domain';

const THEME_KEY = 'ui.theme';

async function pendingChanges(db: PrismaClient): Promise<number> {
  const settings = await db.setting.findMany({ where: { key: { in: ['sync.enabled', 'sync.sentSeq'] } } });
  if (settings.find((row) => row.key === 'sync.enabled')?.value !== '1') return 0;
  const sent = Number(settings.find((row) => row.key === 'sync.sentSeq')?.value ?? '0');
  return db.changeLog.count({ where: { seq: { gt: sent } } });
}

export async function ensureLocalDevice(db: PrismaClient): Promise<string> {
  const existing = await db.device.findFirst({ where: { isLocal: true } });
  if (existing) return existing.id;
  const device = await db.device.create({ data: { id: newId(), isLocal: true } });
  return device.id;
}

export function createAppServices(context: {
  db: PrismaClient;
  deviceId: string;
  appVersion: string;
  appliedMigrations: number;
  databasePath: string;
  encryptionKey: string;
}) {
  const { db, deviceId } = context;
  return {
    async getStatus(): Promise<SystemStatus> {
      const [auditChainOk, auditEntries, pendingSyncEvents] = await Promise.all([
        verifyAuditChain(db),
        db.auditLog.count(),
        pendingChanges(db),
      ]);
      return {
        appVersion: context.appVersion,
        deviceId,
        appliedMigrations: context.appliedMigrations,
        // Le pilote refuse d'ouvrir une base sans clé : ce n'est donc pas une valeur décorative.
        databaseEncrypted: true,
        integrityOk: checkIntegrity(context.databasePath, context.encryptionKey),
        auditChainOk,
        auditEntries,
        pendingSyncEvents,
      };
    },
    async getTheme(): Promise<Theme> {
      const setting = await db.setting.findUnique({ where: { key: THEME_KEY } });
      return themeSchema.catch('system').parse(setting?.value);
    },
    async setTheme(theme: Theme): Promise<Theme> {
      await db.$transaction(async (tx) => {
        await tx.setting.upsert({
          where: { key: THEME_KEY },
          create: { key: THEME_KEY, value: theme },
          update: { value: theme },
        });
        // Préférence propre à ce poste : journalisée, mais pas synchronisée.
        await recordChange(tx, {
          deviceId,
          actorId: null,
          action: 'settings.theme.update',
          entityType: 'Setting',
          entityId: THEME_KEY,
          details: { theme },
          sync: false,
        });
      });
      return theme;
    },
  };
}
