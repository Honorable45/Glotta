import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

export interface MigrateOptions {
  databasePath: string;
  encryptionKey: string;
  migrationsDir: string;
  backupDir: string;
}

export interface MigrateResult {
  applied: string[];
  total: number;
  backupPath: string | null;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Applique le SQL généré par Prisma au démarrage, car `prisma migrate` n'est pas livré avec
 * l'application. Une base existante est copiée avant tout changement ; la copie reste chiffrée.
 */
export function migrate(options: MigrateOptions): MigrateResult {
  const { databasePath, encryptionKey, migrationsDir, backupDir } = options;
  const isNew = !existsSync(databasePath);
  const db = new Database(databasePath, { encryptionKey });
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS "_app_migrations" (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, appliedAt TEXT NOT NULL
    )`);
    const files = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .map((name) => {
        const sql = readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
        return { name, sql, checksum: sha256(sql) };
      });
    const known = new Map(files.map((file) => [file.name, file.checksum]));
    const done = db.prepare('SELECT name, checksum FROM "_app_migrations"').all() as {
      name: string;
      checksum: string;
    }[];

    for (const row of done) {
      const checksum = known.get(row.name);
      if (checksum === undefined) {
        throw new Error(`La base a été créée par une version plus récente (${row.name}).`);
      }
      if (checksum !== row.checksum) throw new Error(`Migration modifiée : ${row.name}.`);
    }

    const doneNames = new Set(done.map((row) => row.name));
    const pending = files.filter((file) => !doneNames.has(file.name));
    let backupPath: string | null = null;

    if (pending.length > 0 && !isNew) {
      mkdirSync(backupDir, { recursive: true });
      db.pragma('wal_checkpoint(TRUNCATE)');
      backupPath = join(backupDir, `avant-${pending[0]!.name}-${Date.now()}.db`);
      copyFileSync(databasePath, backupPath);
    }

    const record = db.prepare('INSERT INTO "_app_migrations" VALUES (?, ?, ?)');
    for (const file of pending) {
      db.transaction(() => {
        db.exec(file.sql);
        record.run(file.name, file.checksum, new Date().toISOString());
      })();
    }

    return { applied: pending.map((file) => file.name), total: files.length, backupPath };
  } finally {
    db.close();
  }
}

export function checkIntegrity(databasePath: string, encryptionKey: string): boolean {
  const db = new Database(databasePath, { encryptionKey });
  try {
    return db.pragma('integrity_check', { simple: true }) === 'ok';
  } finally {
    db.close();
  }
}
