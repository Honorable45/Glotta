import { newId } from '@gestion/domain';
import { AppError } from '../core/errors';
import { applyMovement, logger, requireStoreId, type Context } from './commerce.shared';

const FACTOR = 1000n;

export function createStockService({ db, deviceId }: Context) {
  const log = logger(deviceId);

  async function loadCurrent() {
    const count = await db.inventoryCount.findFirst({ where: { closedAt: null }, include: { lines: true } });
    if (!count) return null;
    const variants = await db.productVariant.findMany({
      where: { id: { in: count.lines.map((line) => line.variantId) } },
      include: { product: { select: { name: true } } },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    return {
      id: count.id,
      startedAt: count.startedAt,
      lines: count.lines
        .map((line) => ({
          id: line.id,
          productName: byId.get(line.variantId)?.product.name ?? '',
          variantLabel: byId.get(line.variantId)?.label ?? '',
          expected: line.expected,
          counted: line.counted,
        }))
        .sort((a, b) => a.productName.localeCompare(b.productName, 'fr')),
    };
  }

  return {
    async move(input: {
      variantId: string;
      direction: 'IN' | 'OUT';
      quantity: bigint;
      unitCost: bigint | null;
      reason: string;
      serials: string[];
    }) {
      const variant = await db.productVariant.findUnique({
        where: { id: input.variantId },
        include: { product: { include: { unit: true } } },
      });
      if (!variant) throw new AppError('NOT_FOUND', 'Variante introuvable.');
      const { product } = variant;
      if (!product.unit.allowsDecimal && input.quantity % FACTOR !== 0n) {
        throw new AppError('INVALID_INPUT', `L'unité ${product.unit.name} n'accepte pas les fractions.`);
      }
      const serials = [...new Set(input.serials)];
      if (product.trackSerial && BigInt(serials.length) * FACTOR !== input.quantity) {
        throw new AppError('INVALID_INPUT', 'Saisissez un numéro de série par unité.');
      }
      if (!product.trackSerial && serials.length > 0) {
        throw new AppError('INVALID_INPUT', "Ce produit n'est pas suivi par numéro de série.");
      }
      const storeId = await requireStoreId(db);
      await db.$transaction(async (tx) => {
        if (input.direction === 'OUT') {
          const level = await tx.stockLevel.findUnique({ where: { variantId_storeId: { variantId: input.variantId, storeId } } });
          if ((level?.quantity ?? 0n) < input.quantity) throw new AppError('CONFLICT', 'Stock insuffisant pour cette sortie.');
        }
        for (const serial of serials) {
          const existing = await tx.serialUnit.findUnique({ where: { serial } });
          if (input.direction === 'IN') {
            if (existing && existing.status === 'IN_STOCK') throw new AppError('CONFLICT', `Le numéro ${serial} est déjà en stock.`);
            if (existing && existing.variantId !== input.variantId) throw new AppError('CONFLICT', `Le numéro ${serial} appartient à un autre produit.`);
            if (existing) await tx.serialUnit.update({ where: { id: existing.id }, data: { status: 'IN_STOCK', saleLineId: null } });
            else await tx.serialUnit.create({ data: { id: newId(), variantId: input.variantId, storeId, serial } });
          } else {
            if (!existing || existing.variantId !== input.variantId || existing.status !== 'IN_STOCK') {
              throw new AppError('CONFLICT', `Le numéro ${serial} n'est pas en stock pour ce produit.`);
            }
            await tx.serialUnit.update({ where: { id: existing.id }, data: { status: 'REMOVED' } });
          }
        }
        await applyMovement(tx, {
          variantId: input.variantId,
          storeId,
          type: input.direction,
          quantity: input.direction === 'IN' ? input.quantity : -input.quantity,
          unitCost: input.unitCost,
          reason: input.reason,
        });
        if (input.direction === 'IN' && input.unitCost !== null) {
          await tx.productVariant.update({ where: { id: input.variantId }, data: { purchasePrice: input.unitCost } });
        }
        await log(tx, `stock.${input.direction.toLowerCase()}`, 'ProductVariant', input.variantId, { quantity: input.quantity, reason: input.reason, serials });
      });
    },

    async movements(variantId: string | null) {
      const rows = await db.stockMovement.findMany({
        where: variantId ? { variantId } : {},
        orderBy: { occurredAt: 'desc' },
        take: 200,
        include: { variant: { include: { product: { select: { name: true } } } } },
      });
      return rows.map((row) => ({
        id: row.id,
        productName: row.variant.product.name,
        variantLabel: row.variant.label,
        type: row.type,
        quantity: row.quantity,
        reason: row.reason,
        occurredAt: row.occurredAt,
      }));
    },

    availableSerials(variantId: string) {
      return db.serialUnit.findMany({
        where: { variantId, status: 'IN_STOCK' },
        orderBy: { serial: 'asc' },
        select: { id: true, serial: true },
      });
    },

    currentInventory: loadCurrent,

    async startInventory() {
      const storeId = await requireStoreId(db);
      await db.$transaction(async (tx) => {
        if ((await tx.inventoryCount.count({ where: { closedAt: null } })) > 0) {
          throw new AppError('CONFLICT', 'Un inventaire est déjà en cours.');
        }
        // Les articles à numéro de série se contrôlent par leurs numéros, pas par une quantité.
        const variants = await tx.productVariant.findMany({
          where: { archivedAt: null, product: { archivedAt: null, trackSerial: false } },
          include: { stockLevels: { where: { storeId } } },
        });
        const id = newId();
        await tx.inventoryCount.create({ data: { id, storeId, startedAt: new Date().toISOString() } });
        for (const variant of variants) {
          await tx.inventoryCountLine.create({
            data: { id: newId(), countId: id, variantId: variant.id, expected: variant.stockLevels[0]?.quantity ?? 0n },
          });
        }
        await log(tx, 'inventory.start', 'InventoryCount', id, { lines: variants.length });
      });
      return loadCurrent();
    },

    async setCounted(lineId: string, counted: bigint | null) {
      await db.$transaction(async (tx) => {
        const line = await tx.inventoryCountLine.findUnique({ where: { id: lineId }, include: { count: true } });
        if (!line || line.count.closedAt) throw new AppError('NOT_FOUND', "Cette ligne d'inventaire n'est plus modifiable.");
        // Le stock de référence est celui du moment du comptage : une vente antérieure n'est pas un écart.
        const level = await tx.stockLevel.findUnique({ where: { variantId_storeId: { variantId: line.variantId, storeId: line.count.storeId } } });
        await tx.inventoryCountLine.update({ where: { id: lineId }, data: { counted, expected: level?.quantity ?? 0n } });
      });
    },

    async closeInventory() {
      return db.$transaction(async (tx) => {
        const count = await tx.inventoryCount.findFirst({ where: { closedAt: null }, include: { lines: true } });
        if (!count) throw new AppError('NOT_FOUND', 'Aucun inventaire en cours.');
        let adjusted = 0;
        for (const line of count.lines) {
          if (line.counted === null) continue;
          const difference = line.counted - line.expected;
          if (difference === 0n) continue;
          await applyMovement(tx, { variantId: line.variantId, storeId: count.storeId, type: 'INVENTORY', quantity: difference, reason: 'Inventaire', refType: 'InventoryCount', refId: count.id });
          adjusted += 1;
        }
        await tx.inventoryCount.update({ where: { id: count.id }, data: { closedAt: new Date().toISOString() } });
        await log(tx, 'inventory.close', 'InventoryCount', count.id, { adjusted });
        return { adjusted };
      });
    },
  };
}
