import { createHash } from 'node:crypto';
import type { SyncStatus } from '@gestion/contracts';
import type { PrismaClient } from '@gestion/db-local';
import { newId } from '@gestion/domain';
import Database from 'better-sqlite3';
import { AppError } from '../core/errors';
import { deriveSyncKey, open, seal } from './sync.crypto';

export type Transport = {
  push(events: { id: string; ciphertext: string }[]): Promise<void>;
  pull(after: string): Promise<{ events: { id: string; ciphertext: string }[]; cursor: string; hasMore: boolean }>;
};

/** En ajout seul : un même identifiant arrivé deux fois n'a aucun effet, et rien n'est jamais écrasé. */
const APPEND_ONLY = new Set(['SaleLine', 'SalePayment', 'SaleReturn', 'SaleReturnLine', 'CashMovement', 'StockMovement']);
const COMPOSITE: Record<string, [string, string]> = {
  CategoryAttribute: ['categoryId', 'attributeId'],
  ProductAttributeValue: ['productId', 'attributeId'],
};
/** Ordre des parents d'abord, pour le rattrapage initial d'un nouveau poste. */
const TABLES = [
  'Company', 'Store', 'Category', 'Unit', 'AttributeDefinition', 'CategoryAttribute', 'PaymentMethod', 'Product', 'ProductVariant', 'ProductAttributeValue',
  'Customer', 'User', 'Sale', 'SaleLine', 'SalePayment', 'SaleReturn', 'SaleReturnLine', 'Debt', 'ExpenseCategory', 'Expense', 'CashSession', 'CashMovement',
  'Reminder', 'StockMovement', 'SerialUnit', 'Setting',
];
const KNOWN = new Set(TABLES);
const BATCH = 200;

const ENABLED = 'sync.enabled';
const CURSOR = 'sync.cursor';
const SENT = 'sync.sentSeq';
const LAST = 'sync.lastAt';
export const RECOVERY_KEY = 'backup.recoveryCode';

interface Change {
  id: string;
  table: string;
  key: string;
  op: 'upsert' | 'delete';
  at: string;
  deviceId: string;
  row: Record<string, unknown> | null;
}

// Les entiers restent exacts : ils voyagent en texte, un montant ne passe jamais par un flottant.
const encode = (row: Record<string, unknown>) =>
  JSON.stringify(row, (_key, value: unknown) => (typeof value === 'bigint' ? { $i: value.toString() } : value));
const decodeValue = (value: unknown) => (value && typeof value === 'object' && '$i' in value ? BigInt((value as { $i: string }).$i) : value);

export function createSyncService(input: { db: PrismaClient; deviceId: string; databasePath: string; encryptionKey: string; transport: () => Transport | null; now?: () => Date }) {
  const { db, deviceId } = input;
  let lastError: string | null = null;
  let running: Promise<SyncStatus> | null = null;
  const getSetting = async (key: string) => (await db.setting.findUnique({ where: { key } }))?.value ?? null;
  const setSetting = (key: string, value: string) => db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

  /** Connexion directe : les lignes sont copiées telles quelles, sans passer par les types du client. */
  function connect() {
    const raw = new Database(input.databasePath, { encryptionKey: input.encryptionKey }) as unknown as Database.Connection & { defaultSafeIntegers(on: boolean): void };
    raw.defaultSafeIntegers(true);
    return raw;
  }

  const rowOf = (raw: Database.Connection, table: string, key: string) => {
    const composite = COMPOSITE[table];
    if (composite) {
      const [a, b] = key.split('|');
      return raw.prepare(`SELECT * FROM "${table}" WHERE "${composite[0]}" = ? AND "${composite[1]}" = ?`).get(a, b) as Record<string, unknown> | undefined;
    }
    const column = table === 'Setting' ? 'key' : 'id';
    return raw.prepare(`SELECT * FROM "${table}" WHERE "${column}" = ?`).get(key) as Record<string, unknown> | undefined;
  };

  function addConflict(raw: Database.Connection, kind: string, message: string) {
    raw.prepare('INSERT INTO "SyncConflict" ("id","kind","message","occurredAt") VALUES (?,?,?,?)').run(newId(), kind, message, new Date().toISOString());
  }

  /** Après une modification, chaque valeur dérivée est recalculée : aucune addition n'est perdue entre postes. */
  function recomputeSale(raw: Database.Connection, saleId: string) {
    const sale = raw.prepare('SELECT "total" FROM "Sale" WHERE "id" = ?').get(saleId) as { total: bigint } | undefined;
    if (!sale) return;
    const returned = raw.prepare('SELECT COALESCE(SUM("amount"),0) AS v FROM "SaleReturn" WHERE "saleId" = ?').get(saleId) as { v: bigint };
    const paid = raw.prepare('SELECT COALESCE(SUM("amount"),0) AS v FROM "SalePayment" WHERE "saleId" = ?').get(saleId) as { v: bigint };
    raw.prepare('UPDATE "Sale" SET "netTotal" = ?, "netPaid" = ? WHERE "id" = ?').run(sale.total - returned.v, paid.v, saleId);
  }

  function applyMovement(raw: Database.Connection, row: Record<string, unknown>) {
    raw.prepare(`INSERT INTO "StockLevel" ("variantId","storeId","quantity") VALUES (?,?,?)
      ON CONFLICT ("variantId","storeId") DO UPDATE SET "quantity" = "quantity" + excluded."quantity"`).run(row['variantId'], row['storeId'], row['quantity']);
    const level = raw.prepare('SELECT "quantity" FROM "StockLevel" WHERE "variantId" = ? AND "storeId" = ?').get(row['variantId'], row['storeId']) as { quantity: bigint };
    if (level.quantity < 0n) {
      const variant = raw.prepare('SELECT p."name" AS name FROM "ProductVariant" v JOIN "Product" p ON p."id" = v."productId" WHERE v."id" = ?').get(row['variantId']) as { name: string } | undefined;
      addConflict(raw, 'NEGATIVE_STOCK', `Stock négatif pour ${variant?.name ?? 'un produit'} après des ventes faites hors ligne sur plusieurs postes : à régulariser.`);
    }
  }

  function write(raw: Database.Connection, table: string, row: Record<string, unknown>, ignore: boolean) {
    const allowed = new Set((raw.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((column) => column.name));
    const columns = Object.keys(row).filter((column) => allowed.has(column));
    const list = columns.map((column) => `"${column}"`).join(',');
    const marks = columns.map(() => '?').join(',');
    const values = columns.map((column) => row[column]);
    if (ignore) return raw.prepare(`INSERT OR IGNORE INTO "${table}" (${list}) VALUES (${marks})`).run(...values) as { changes: number | bigint };
    // Pas de INSERT OR REPLACE : il supprimerait en silence une autre ligne portant le même code-barres.
    const keys = COMPOSITE[table] ?? [table === 'Setting' ? 'key' : 'id'];
    const updates = columns.filter((column) => !keys.includes(column)).map((column) => `"${column}" = excluded."${column}"`).join(',');
    const target = keys.map((column) => `"${column}"`).join(',');
    const action = updates ? `DO UPDATE SET ${updates}` : 'DO NOTHING';
    return raw.prepare(`INSERT INTO "${table}" (${list}) VALUES (${marks}) ON CONFLICT (${target}) ${action}`).run(...values) as { changes: number | bigint };
  }

  function applyChange(raw: Database.Connection, change: Change) {
    if (!KNOWN.has(change.table)) throw new Error(`Table inconnue : ${change.table}`);
    const { table, key } = change;
    if (change.op === 'delete') {
      const composite = COMPOSITE[table];
      if (!composite) return;
      const [a, b] = key.split('|');
      raw.prepare(`DELETE FROM "${table}" WHERE "${composite[0]}" = ? AND "${composite[1]}" = ?`).run(a, b);
      return;
    }
    const row = change.row;
    if (!row) return;

    if (APPEND_ONLY.has(table)) {
      const result = write(raw, table, row, true);
      if (Number(result.changes) === 0) return;
      if (table === 'StockMovement') applyMovement(raw, row);
      if (table === 'SalePayment' || table === 'SaleReturn') recomputeSale(raw, String(row['saleId']));
      return;
    }

    if (table === 'SerialUnit') {
      // Contrôlé avant de départager : le conflit doit être vu même si la version reçue est la plus ancienne.
      const local = rowOf(raw, table, key);
      if (local && local['status'] === 'SOLD' && row['status'] === 'SOLD' && local['saleLineId'] !== row['saleLineId']) {
        addConflict(raw, 'SERIAL_SOLD_TWICE', `Le numéro de série ${String(row['serial'])} a été vendu sur deux postes hors ligne : à vérifier.`);
      }
    }

    const known = raw.prepare('SELECT "at","deviceId" FROM "SyncRowVersion" WHERE "tableName" = ? AND "rowKey" = ?').get(table, key) as { at: string; deviceId: string } | undefined;
    const localEdit = raw.prepare('SELECT MAX("at") AS at FROM "ChangeLog" WHERE "tableName" = ? AND "rowKey" = ?').get(table, key) as { at: string | null };
    // Le plus récent gagne ; à égalité, l'identifiant du poste départage pour que tous convergent.
    const older = (at: string, device: string) => at > change.at || (at === change.at && device > change.deviceId);
    if ((known && older(known.at, known.deviceId)) || (localEdit.at && older(localEdit.at, deviceId))) return;

    if (table === 'Sale') {
      // Les totaux nets se déduisent des opérations reçues, jamais de la copie d'un autre poste.
      const existing = rowOf(raw, table, key);
      const merged = { ...row, ...(existing ? { netTotal: existing['netTotal'], netPaid: existing['netPaid'], number: existing['number'] } : {}) };
      // Une vente n'est jamais écartée : si deux postes ont produit le même numéro, celui-ci reçoit un suffixe.
      if (!existing && raw.prepare('SELECT 1 FROM "Sale" WHERE "number" = ?').get(row['number'])) {
        merged['number'] = `${String(row['number'])}-${key.slice(-4).toUpperCase()}`;
      }
      write(raw, table, merged, false);
      recomputeSale(raw, key);
    } else if (table === 'ProductVariant' && row['barcode'] && raw.prepare('SELECT 1 FROM "ProductVariant" WHERE "barcode" = ? AND "id" <> ?').get(row['barcode'], key)) {
      // La variante doit exister, car des ventes s'y rattachent : seul le code-barres en double est retiré.
      addConflict(raw, 'DUPLICATE_BARCODE', `Le code-barres ${String(row['barcode'])} a été donné à deux produits : à corriger sur l'un d'eux.`);
      write(raw, table, { ...row, barcode: null }, false);
    } else {
      write(raw, table, row, false);
    }
    raw.prepare(`INSERT INTO "SyncRowVersion" ("tableName","rowKey","at","deviceId") VALUES (?,?,?,?)
      ON CONFLICT ("tableName","rowKey") DO UPDATE SET "at" = excluded."at", "deviceId" = excluded."deviceId"`).run(table, key, change.at, change.deviceId);
  }

  async function syncKey(): Promise<Buffer> {
    const code = await getSetting(RECOVERY_KEY);
    if (!code) throw new AppError('CONFLICT', 'Code de récupération absent.');
    return deriveSyncKey(code);
  }

  async function pushAll(transport: Transport, key: Buffer) {
    const raw = connect();
    try {
      for (;;) {
        const sent = BigInt((await getSetting(SENT)) ?? '0');
        const entries = raw.prepare('SELECT "seq","tableName","rowKey","op","at" FROM "ChangeLog" WHERE "seq" > ? ORDER BY "seq" LIMIT ?').all(sent, BATCH) as { seq: bigint; tableName: string; rowKey: string; op: string; at: string }[];
        if (entries.length === 0) return;
        const events = entries.flatMap((entry) => {
          const row = entry.op === 'delete' ? null : (rowOf(raw, entry.tableName, entry.rowKey) ?? null);
          if (entry.op !== 'delete' && !row) return [];
          // Identifiant déterministe : renvoyer après une coupure ne crée pas de doublon sur le serveur.
          const id = createHash('sha256').update(`${deviceId}:${entry.seq}`).digest('hex');
          const uuid = `${id.slice(0, 8)}-${id.slice(8, 12)}-5${id.slice(13, 16)}-8${id.slice(17, 20)}-${id.slice(20, 32)}`;
          const change: Change = { id: uuid, table: entry.tableName, key: entry.rowKey, op: entry.op as Change['op'], at: entry.at, deviceId, row };
          return [{ id: uuid, ciphertext: seal(encode(change as unknown as Record<string, unknown>), key) }];
        });
        if (events.length) await transport.push(events);
        await setSetting(SENT, entries.at(-1)!.seq.toString());
      }
    } finally {
      raw.close();
    }
  }

  async function pullAll(transport: Transport, key: Buffer) {
    const raw = connect();
    try {
      for (;;) {
        const page = await transport.pull((await getSetting(CURSOR)) ?? '0');
        const changes = page.events.map((event) => {
          let parsed: Change;
          try {
            parsed = JSON.parse(open(event.ciphertext, key)) as Change;
          } catch {
            throw new AppError('FORBIDDEN', 'Données de synchronisation illisibles : vérifiez le code de récupération.');
          }
          if (parsed.row) parsed.row = Object.fromEntries(Object.entries(parsed.row).map(([column, value]) => [column, decodeValue(value)]));
          return parsed;
        });
        // Une seule transaction par page : une coupure laisse la base et le curseur cohérents.
        raw.transaction(() => {
          raw.prepare('UPDATE "SyncFlag" SET "applying" = 1 WHERE "id" = 1').run();
          raw.pragma('defer_foreign_keys = ON');
          for (const change of changes) {
            try {
              applyChange(raw, change);
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              // Aucune ligne financière ne passe ici : leurs identifiants sont uniques et les numéros traités plus haut.
              if (!/UNIQUE/.test(message)) throw error;
              addConflict(raw, 'DUPLICATE', `Doublon reçu sur ${change.table} : la donnée déjà présente a été conservée.`);
            }
          }
          raw.prepare('UPDATE "SyncFlag" SET "applying" = 0 WHERE "id" = 1').run();
        })();
        await setSetting(CURSOR, page.cursor);
        if (!page.hasMore) return;
      }
    } finally {
      raw.close();
    }
  }

  async function status(): Promise<SyncStatus> {
    const sent = Number((await getSetting(SENT)) ?? '0');
    const [enabled, pending, lastSyncAt, conflicts] = await Promise.all([
      getSetting(ENABLED),
      db.changeLog.count({ where: { seq: { gt: sent } } }),
      getSetting(LAST),
      db.syncConflict.findMany({ where: { resolvedAt: null }, orderBy: { occurredAt: 'desc' } }),
    ]);
    return {
      enabled: enabled === '1',
      pending,
      lastSyncAt,
      lastError,
      conflicts: conflicts.map(({ id, kind, message, occurredAt }) => ({ id, kind, message, occurredAt })),
    };
  }

  async function runOnce(): Promise<SyncStatus> {
    if ((await getSetting(ENABLED)) !== '1') return status();
    const transport = input.transport();
    if (!transport) {
      lastError = 'Serveur non configuré.';
      return status();
    }
    try {
      const key = await syncKey();
      await pushAll(transport, key);
      await pullAll(transport, key);
      lastError = null;
      await setSetting(LAST, (input.now?.() ?? new Date()).toISOString());
    } catch (error) {
      // Une panne réseau n'efface rien : le journal des changements attend le prochain essai.
      lastError = error instanceof Error ? error.message : 'Synchronisation impossible.';
    }
    return status();
  }

  return {
    status,

    /** Un seul passage à la fois : deux envois simultanés se marcheraient dessus. */
    run(): Promise<SyncStatus> {
      running ??= runOnce().finally(() => { running = null; });
      return running;
    },

    /** Première activation : tout l'existant part dans le journal, parents d'abord. */
    async enable(): Promise<SyncStatus> {
      if ((await getSetting(ENABLED)) === '1') return status();
      const raw = connect();
      try {
        raw.transaction(() => {
          raw.prepare('DELETE FROM "ChangeLog"').run();
          const at = new Date().toISOString();
          const insert = raw.prepare('INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES (?,?,?,?)');
          for (const table of TABLES) {
            const composite = COMPOSITE[table];
            const column = table === 'Setting' ? '"key"' : composite ? `"${composite[0]}" || '|' || "${composite[1]}"` : '"id"';
            const where = table === 'Setting' ? ` WHERE "key" = 'stock.settings'` : '';
            for (const row of raw.prepare(`SELECT ${column} AS k FROM "${table}"${where}`).all() as { k: string }[]) insert.run(table, row.k, 'upsert', at);
          }
        })();
      } finally {
        raw.close();
      }
      await setSetting(SENT, '0');
      await setSetting(ENABLED, '1');
      return this.run();
    },

    /** Nouveau poste : base vide, il reçoit tout et ne renvoie rien de ce qu'il a reçu. */
    async join(code: string): Promise<void> {
      if ((await db.company.count()) > 0) throw new AppError('CONFLICT', 'Ce poste contient déjà une entreprise.');
      const transport = input.transport();
      if (!transport) throw new AppError('INTERNAL', 'Serveur non configuré.');
      await setSetting(RECOVERY_KEY, code);
      try {
        await pullAll(transport, deriveSyncKey(code));
      } catch (error) {
        await db.setting.delete({ where: { key: RECOVERY_KEY } });
        throw error;
      }
      if ((await db.company.count()) === 0) {
        await db.setting.delete({ where: { key: RECOVERY_KEY } });
        throw new AppError('NOT_FOUND', "Aucune donnée reçue. Activez d'abord la synchronisation sur le poste principal.");
      }
      await setSetting(ENABLED, '1');
    },

    async resolveConflict(id: string): Promise<SyncStatus> {
      await db.syncConflict.update({ where: { id }, data: { resolvedAt: new Date().toISOString() } });
      return status();
    },
  };
}
