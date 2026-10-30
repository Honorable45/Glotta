import { createHash } from 'node:crypto';
import { newId } from '@gestion/domain';
import type { Prisma, PrismaClient } from './generated/client';

export interface ChangeRecord {
  deviceId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  /** Vrai si le changement doit partir vers les autres postes. */
  sync: boolean;
}

const GENESIS = '0'.repeat(64);

interface HashedFields {
  id: string;
  occurredAt: string;
  deviceId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  prevHash: string;
}

function hashEntry(entry: HashedFields): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        entry.id,
        entry.occurredAt,
        entry.deviceId,
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.details,
        entry.prevHash,
      ]),
    )
    .digest('hex');
}

/** À appeler dans la transaction du changement : donnée, journal et outbox réussissent ensemble. */
export async function recordChange(tx: Prisma.TransactionClient, change: ChangeRecord): Promise<void> {
  const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
  const occurredAt = new Date().toISOString();
  const details = JSON.stringify(change.details);
  const fields: HashedFields = {
    id: newId(),
    occurredAt,
    deviceId: change.deviceId,
    actorId: change.actorId,
    action: change.action,
    entityType: change.entityType,
    entityId: change.entityId,
    details,
    prevHash: last?.hash ?? GENESIS,
  };
  await tx.auditLog.create({ data: { ...fields, hash: hashEntry(fields) } });

  if (change.sync) {
    await tx.outboxEvent.create({
      data: {
        id: newId(),
        occurredAt,
        deviceId: change.deviceId,
        eventType: change.action,
        entityType: change.entityType,
        entityId: change.entityId,
        payload: details,
      },
    });
  }
}

export async function verifyAuditChain(db: PrismaClient): Promise<boolean> {
  let prevHash = GENESIS;
  const entries = await db.auditLog.findMany({ orderBy: { seq: 'asc' } });
  for (const { seq: _seq, hash, ...fields } of entries) {
    if (fields.prevHash !== prevHash || hashEntry(fields) !== hash) return false;
    prevHash = hash;
  }
  return true;
}
