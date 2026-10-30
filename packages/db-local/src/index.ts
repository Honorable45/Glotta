import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/client';

export { checkIntegrity, migrate } from './migrator';
export type { MigrateOptions, MigrateResult } from './migrator';
export { recordChange, verifyAuditChain } from './journal';
export type { ChangeRecord } from './journal';
export { PrismaClient };
export type { Prisma } from './generated/client';

export function createClient(databasePath: string, encryptionKey: string): PrismaClient {
  // encryptionKey est transmise par l'adaptateur à packages/sqlite-driver.
  const config = { url: `file:${databasePath}`, encryptionKey };
  return new PrismaClient({ adapter: new PrismaBetterSqlite3(config) });
}
