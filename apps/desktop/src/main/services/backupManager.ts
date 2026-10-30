import type { BackupStatus } from '@gestion/contracts';
import type { PrismaClient } from '@gestion/db-local';
import { join } from 'node:path';
import { backupFileName, ensureFolder, generateRecoveryCode, listBackups, normalizeCode, pruneBackups, writeBackup } from './backup';

const CODE_KEY = 'backup.recoveryCode';
const FOLDER_KEY = 'backup.folder';
const LAST_KEY = 'backup.lastAt';
const CONFIRMED_KEY = 'backup.codeConfirmed';
const KEEP = 14;
const DAY = 86_400_000;

export function createBackupManager(input: { db: PrismaClient; databasePath: string; encryptionKey: string; defaultFolder: string }) {
  const { db } = input;
  const read = async (key: string) => (await db.setting.findUnique({ where: { key } }))?.value ?? null;
  const write = (key: string, value: string) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

  async function recoveryCode(): Promise<string> {
    const existing = await read(CODE_KEY);
    if (existing) return existing;
    const code = generateRecoveryCode();
    await write(CODE_KEY, code);
    return code;
  }
  const folder = async () => (await read(FOLDER_KEY)) ?? input.defaultFolder;

  async function status(): Promise<BackupStatus> {
    const current = await folder();
    return { lastBackupAt: await read(LAST_KEY), folder: current, files: listBackups(current) };
  }

  async function create(): Promise<BackupStatus> {
    const target = await folder();
    ensureFolder(target);
    await writeBackup({ databasePath: input.databasePath, encryptionKey: input.encryptionKey, code: await recoveryCode(), target: join(target, backupFileName()) });
    pruneBackups(target, KEEP);
    await write(LAST_KEY, new Date().toISOString());
    return status();
  }

  return {
    status,
    create,
    recoveryCode,
    codeConfirmed: async () => (await read(CONFIRMED_KEY)) === '1',
    markCodeConfirmed: () => write(CONFIRMED_KEY, '1'),
    /** La recopie prouve que le code a bien été noté, seul moyen de restaurer sur un autre ordinateur. */
    async confirmCode(code: string) {
      const matches = normalizeCode(code) === normalizeCode(await recoveryCode());
      if (matches) await write(CONFIRMED_KEY, '1');
      return matches;
    },
    async setFolder(path: string) {
      await write(FOLDER_KEY, path);
      return status();
    },
    /** Sauvegarde quotidienne : appelée au démarrage et à intervalle régulier. */
    async runIfDue() {
      const last = await read(LAST_KEY);
      if (!last || Date.now() - Date.parse(last) >= DAY) await create();
    },
  };
}
