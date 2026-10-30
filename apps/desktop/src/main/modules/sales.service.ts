import type { SaleDetail, SaleInput, SaleReturnInput, SaleSummary } from '@gestion/contracts';
import { computeSale, newId, returnValue } from '@gestion/domain';
import { AppError } from '../core/errors';
import { currentUserId, requirePermission } from '../core/session';
import { applyMovement, logger, readStockSettings, requireStoreId, type Context, type Tx } from './commerce.shared';

const FACTOR = 1000n;

const sum = (values: bigint[]) => values.reduce((total, value) => total + value, 0n);

export function createSalesService({ db, deviceId }: Context) {
  const log = logger(deviceId);

  /** Numéro lisible et unique sans réseau : chaque poste a sa propre séquence. */
  async function nextNumber(tx: Tx): Promise<string> {
    const key = 'sale.sequence';
    const current = await tx.setting.findUnique({ where: { key } });
    const sequence = Number(current?.value ?? 0) + 1;
    await tx.setting.upsert({ where: { key }, create: { key, value: String(sequence) }, update: { value: String(sequence) } });
    return `V-${deviceId.slice(-4).toUpperCase()}-${String(sequence).padStart(6, '0')}`;
  }

  function summary(sale: { id: string; number: string; status: string; netTotal: bigint; netPaid: bigint; occurredAt: string; customer: { name: string } | null }): SaleSummary {
    return {
      id: sale.id,
      number: sale.number,
      status: sale.status,
      customerName: sale.customer?.name ?? null,
      netTotal: sale.netTotal,
      netPaid: sale.netPaid,
      occurredAt: sale.occurredAt,
    };
  }

  async function detail(id: string, client: Tx | typeof db = db): Promise<SaleDetail> {
    const sale = await client.sale.findUnique({
      where: { id },
      include: {
        customer: { select: { name: true } },
        lines: { include: { serials: { select: { id: true, serial: true } }, returnLines: { select: { quantity: true } } } },
        payments: { orderBy: { occurredAt: 'asc' } },
        returns: { orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!sale) throw new AppError('NOT_FOUND', 'Vente introuvable.');
    return {
      ...summary(sale),
      subtotal: sale.subtotal,
      discount: sale.discount,
      tax: sale.tax,
      total: sale.total,
      cancelReason: sale.cancelReason,
      lines: sale.lines.map((line) => ({
        id: line.id,
        productName: line.productName,
        variantLabel: line.variantLabel,
        quantity: line.quantity,
        returnedQuantity: sum(line.returnLines.map((item) => item.quantity)),
        unitPrice: line.unitPrice,
        lineDiscount: line.lineDiscount,
        cartDiscount: line.cartDiscount,
        lineTotal: line.lineTotal,
        taxRateBp: line.taxRateBp,
        tax: line.tax,
        serials: line.serials,
      })),
      payments: sale.payments.map(({ id: paymentId, methodName, amount, kind, occurredAt }) => ({ id: paymentId, methodName, amount, kind, occurredAt })),
      returns: sale.returns.map(({ id: returnId, reason, amount, refund, occurredAt }) => ({ id: returnId, reason, amount, refund, occurredAt })),
    };
  }

  async function applyReturn(tx: Tx, input: SaleReturnInput, cancelling: boolean) {
    const sale = await tx.sale.findUnique({
      where: { id: input.saleId },
      include: { lines: { include: { returnLines: true } } },
    });
    if (!sale) throw new AppError('NOT_FOUND', 'Vente introuvable.');
    if (sale.status === 'CANCELLED') throw new AppError('CONFLICT', 'Cette vente est déjà annulée.');

    const returnId = newId();
    const occurredAt = new Date().toISOString();
    let amount = 0n;
    const seen = new Set<string>();
    const lineRows: { id: string; returnId: string; saleLineId: string; quantity: bigint; amount: bigint; restock: boolean }[] = [];

    for (const item of input.lines) {
      if (seen.has(item.saleLineId)) throw new AppError('INVALID_INPUT', 'Article sélectionné deux fois.');
      seen.add(item.saleLineId);
      const line = sale.lines.find((candidate) => candidate.id === item.saleLineId);
      if (!line) throw new AppError('NOT_FOUND', 'Article introuvable sur cette vente.');
      const alreadyQuantity = sum(line.returnLines.map((row) => row.quantity));
      const alreadyAmount = sum(line.returnLines.map((row) => row.amount));
      let value: bigint;
      try {
        value = returnValue(line, alreadyQuantity, alreadyAmount, item.quantity);
      } catch {
        throw new AppError('CONFLICT', `Quantité retournée trop élevée pour ${line.productName}.`);
      }
      const soldSerials = await tx.serialUnit.findMany({ where: { saleLineId: line.id } });
      if (soldSerials.length > 0 || item.serialIds.length > 0) {
        if (BigInt(item.serialIds.length) * FACTOR !== item.quantity) throw new AppError('INVALID_INPUT', 'Indiquez un numéro de série par unité retournée.');
        for (const serialId of item.serialIds) {
          if (!soldSerials.some((serial) => serial.id === serialId)) throw new AppError('CONFLICT', 'Ce numéro de série ne fait pas partie de la vente.');
          await tx.serialUnit.update({ where: { id: serialId }, data: { status: item.restock ? 'IN_STOCK' : 'DEFECTIVE', saleLineId: null } });
        }
      }
      amount += value;
      lineRows.push({ id: newId(), returnId, saleLineId: line.id, quantity: item.quantity, amount: value, restock: item.restock });
      if (item.restock) {
        await applyMovement(tx, { variantId: line.variantId, storeId: sale.storeId, type: 'RETURN', quantity: item.quantity, unitCost: line.unitCost, reason: input.reason, refType: 'SaleReturn', refId: returnId });
      }
    }

    // Une vente à crédit retournée réduit d'abord la dette : seul l'excédent payé est remboursé.
    const netTotal = sale.netTotal - amount;
    const refund = sale.netPaid > netTotal ? sale.netPaid - netTotal : 0n;
    let refundMethod: { id: string; name: string } | null = null;
    if (refund > 0n) {
      if (!input.refundMethodId) throw new AppError('INVALID_INPUT', 'Choisissez le mode de remboursement.');
      refundMethod = await tx.paymentMethod.findUnique({ where: { id: input.refundMethodId }, select: { id: true, name: true } });
      if (!refundMethod) throw new AppError('NOT_FOUND', 'Mode de remboursement introuvable.');
    }

    await tx.saleReturn.create({ data: { id: returnId, saleId: sale.id, reason: input.reason, amount, refund, occurredAt, userId: currentUserId() } });
    for (const row of lineRows) await tx.saleReturnLine.create({ data: row });
    if (refundMethod) {
      await tx.salePayment.create({
        data: { id: newId(), saleId: sale.id, methodId: refundMethod.id, methodName: refundMethod.name, amount: -refund, kind: 'REFUND', returnId, occurredAt, userId: currentUserId() },
      });
    }
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        netTotal,
        netPaid: sale.netPaid - refund,
        ...(cancelling ? { status: 'CANCELLED', cancelReason: input.reason } : {}),
      },
    });
    await log(tx, cancelling ? 'sale.cancel' : 'sale.return', 'Sale', sale.id, { returnId, amount, refund, reason: input.reason, lines: lineRows });
  }

  return {
    detail,

    async create(input: SaleInput): Promise<SaleSummary> {
      return db.$transaction(async (tx) => {
        const existing = await tx.sale.findUnique({ where: { id: input.id }, include: { customer: { select: { name: true } } } });
        if (existing) return summary(existing);

        // Vérifié ici et non par canal : ces droits dépendent du contenu de la vente.
        if (input.cartDiscount > 0n || input.lines.some((line) => line.lineDiscount > 0n)) requirePermission('discount');
        if (input.lines.some((line) => line.unitPrice !== null)) requirePermission('edit_prices');

        const storeId = await requireStoreId(tx);
        const settings = await readStockSettings(tx);
        const variants = await tx.productVariant.findMany({
          where: { id: { in: input.lines.map((line) => line.variantId) } },
          include: { product: { include: { unit: true } } },
        });
        const byId = new Map(variants.map((variant) => [variant.id, variant]));

        const lines = input.lines.map((line) => {
          const variant = byId.get(line.variantId);
          if (!variant || variant.archivedAt || variant.product.archivedAt) throw new AppError('NOT_FOUND', 'Un article du panier n’est plus disponible.');
          const { product } = variant;
          if (!product.unit.allowsDecimal && line.quantity % FACTOR !== 0n) {
            throw new AppError('INVALID_INPUT', `${product.name} se vend par unité entière.`);
          }
          if (product.trackSerial && BigInt(line.serialIds.length) * FACTOR !== line.quantity) {
            throw new AppError('INVALID_INPUT', `Sélectionnez un numéro de série par unité pour ${product.name}.`);
          }
          return { input: line, variant, product, unitPrice: line.unitPrice ?? variant.salePrice };
        });

        let totals;
        try {
          totals = computeSale(
            lines.map((line) => ({ quantity: line.input.quantity, unitPrice: line.unitPrice, lineDiscount: line.input.lineDiscount, taxRateBp: line.product.taxRateBp })),
            input.cartDiscount,
          );
        } catch (error) {
          throw new AppError('INVALID_INPUT', (error as Error).message);
        }

        // Un même article peut figurer sur plusieurs lignes : le contrôle porte sur le cumul.
        const needed = new Map<string, bigint>();
        for (const line of lines) needed.set(line.variant.id, (needed.get(line.variant.id) ?? 0n) + line.input.quantity);
        for (const line of lines) {
          if (settings.allowOutOfStockSales && !line.product.trackSerial) continue;
          const level = await tx.stockLevel.findUnique({ where: { variantId_storeId: { variantId: line.variant.id, storeId } } });
          if ((level?.quantity ?? 0n) < needed.get(line.variant.id)!) {
            throw new AppError('CONFLICT', `Stock insuffisant pour ${line.product.name}.`);
          }
        }

        const paid = sum(input.payments.map((payment) => payment.amount));
        if (paid > totals.total) throw new AppError('INVALID_INPUT', 'Le montant encaissé dépasse le total : enregistrez le montant dû, sans la monnaie rendue.');
        if (paid < totals.total && !input.customerId) throw new AppError('INVALID_INPUT', 'Sélectionnez un client pour une vente à crédit.');
        if (input.customerId) {
          const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
          if (!customer || customer.archivedAt) throw new AppError('NOT_FOUND', 'Client introuvable.');
        }

        const methods = await tx.paymentMethod.findMany({ where: { id: { in: input.payments.map((payment) => payment.methodId) } } });
        const occurredAt = new Date().toISOString();
        const sale = await tx.sale.create({
          data: {
            id: input.id,
            number: await nextNumber(tx),
            storeId,
            deviceId,
            customerId: input.customerId,
            subtotal: totals.subtotal,
            discount: totals.discount,
            tax: totals.tax,
            total: totals.total,
            netTotal: totals.total,
            netPaid: paid,
            occurredAt,
            userId: currentUserId(),
          },
          include: { customer: { select: { name: true } } },
        });

        for (const [index, line] of lines.entries()) {
          const computed = totals.lines[index]!;
          const lineId = newId();
          await tx.saleLine.create({
            data: {
              id: lineId,
              saleId: sale.id,
              variantId: line.variant.id,
              productName: line.product.name,
              variantLabel: line.variant.label,
              quantity: line.input.quantity,
              unitPrice: line.unitPrice,
              unitCost: line.variant.purchasePrice,
              lineDiscount: line.input.lineDiscount,
              cartDiscount: computed.cartDiscount,
              taxRateBp: line.product.taxRateBp,
              tax: computed.tax,
              lineTotal: computed.lineTotal,
            },
          });
          for (const serialId of line.input.serialIds) {
            const serial = await tx.serialUnit.findUnique({ where: { id: serialId } });
            if (!serial || serial.variantId !== line.variant.id || serial.status !== 'IN_STOCK') {
              throw new AppError('CONFLICT', `Un numéro de série de ${line.product.name} n'est plus disponible.`);
            }
            await tx.serialUnit.update({ where: { id: serialId }, data: { status: 'SOLD', saleLineId: lineId } });
          }
          await applyMovement(tx, { variantId: line.variant.id, storeId, type: 'SALE', quantity: -line.input.quantity, unitCost: line.variant.purchasePrice, refType: 'Sale', refId: sale.id });
        }

        for (const payment of input.payments) {
          const method = methods.find((candidate) => candidate.id === payment.methodId);
          if (!method || !method.isActive) throw new AppError('NOT_FOUND', 'Mode de paiement indisponible.');
          await tx.salePayment.create({
            data: { id: newId(), saleId: sale.id, methodId: method.id, methodName: method.name, amount: payment.amount, kind: 'PAYMENT', occurredAt, userId: currentUserId() },
          });
        }
        if (paid < totals.total && input.customerId) {
          await tx.debt.create({ data: { id: newId(), saleId: sale.id, customerId: input.customerId, dueDate: input.dueDate } });
        }
        await log(tx, 'sale.create', 'Sale', sale.id, { number: sale.number, total: totals.total, paid, customerId: input.customerId, lines: input.lines });
        return summary(sale);
      });
    },

    async list(limit: number): Promise<SaleSummary[]> {
      const rows = await db.sale.findMany({ orderBy: { occurredAt: 'desc' }, take: limit, include: { customer: { select: { name: true } } } });
      return rows.map(summary);
    },

    async returnItems(input: SaleReturnInput): Promise<SaleDetail> {
      await db.$transaction((tx) => applyReturn(tx, input, false));
      return detail(input.saleId);
    },

    async cancel(input: { saleId: string; reason: string; refundMethodId: string | null }): Promise<SaleDetail> {
      await db.$transaction(async (tx) => {
        const sale = await tx.sale.findUnique({
          where: { id: input.saleId },
          include: { lines: { include: { returnLines: true, serials: true } } },
        });
        if (!sale) throw new AppError('NOT_FOUND', 'Vente introuvable.');
        const lines = sale.lines.flatMap((line) => {
          const remaining = line.quantity - sum(line.returnLines.map((row) => row.quantity));
          return remaining > 0n
            ? [{ saleLineId: line.id, quantity: remaining, restock: true, serialIds: line.serials.map((serial) => serial.id) }]
            : [];
        });
        await applyReturn(tx, { saleId: input.saleId, reason: input.reason, refundMethodId: input.refundMethodId, lines }, true);
      });
      return detail(input.saleId);
    },
  };
}
