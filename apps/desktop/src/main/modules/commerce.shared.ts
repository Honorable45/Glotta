import { recordChange, type Prisma, type PrismaClient } from '@gestion/db-local';
import { newId } from '@gestion/domain';
import { AppError } from '../core/errors';
import { currentUserId } from '../core/session';

export type Context = { db: PrismaClient; deviceId: string };
export type Tx = Prisma.TransactionClient;

export async function requireStoreId(db: PrismaClient | Tx): Promise<string> {
  // La boutique de ce poste, sinon la première : un seul commerce n'a rien à choisir.
  const chosen = await db.setting.findUnique({ where: { key: 'device.storeId' } });
  if (chosen) return chosen.value;
  const store = await db.store.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!store) throw new AppError('NOT_FOUND', "L'entreprise n'est pas encore configurée.");
  return store.id;
}

/** Écrit un mouvement et met à jour le cache de stock dans la même transaction. */
export async function applyMovement(
  tx: Tx,
  movement: {
    variantId: string;
    storeId: string;
    type: string;
    quantity: bigint;
    unitCost?: bigint | null;
    reason?: string | null;
    refType?: string | null;
    refId?: string | null;
  },
): Promise<void> {
  await tx.stockMovement.create({
    data: {
      id: newId(),
      variantId: movement.variantId,
      storeId: movement.storeId,
      type: movement.type,
      quantity: movement.quantity,
      unitCost: movement.unitCost ?? null,
      reason: movement.reason ?? null,
      refType: movement.refType ?? null,
      refId: movement.refId ?? null,
      userId: currentUserId(),
      occurredAt: new Date().toISOString(),
    },
  });
  await tx.stockLevel.upsert({
    where: { variantId_storeId: { variantId: movement.variantId, storeId: movement.storeId } },
    create: { variantId: movement.variantId, storeId: movement.storeId, quantity: movement.quantity },
    update: { quantity: { increment: movement.quantity } },
  });
}

export function logger(deviceId: string) {
  return (tx: Tx, action: string, entityType: string, entityId: string, details: Record<string, unknown>) =>
    recordChange(tx, {
      deviceId,
      actorId: currentUserId(),
      action,
      entityType,
      entityId,
      // Le JSON ne sait pas écrire les bigint.
      details: JSON.parse(JSON.stringify(details, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))) as Record<string, unknown>,
      sync: true,
    });
}

export async function readStockSettings(db: PrismaClient | Tx) {
  const setting = await db.setting.findUnique({ where: { key: 'stock.settings' } });
  return setting
    ? (JSON.parse(setting.value) as { allowOutOfStockSales: boolean; lowStockThreshold: number })
    : { allowOutOfStockSales: false, lowStockThreshold: 5 };
}
