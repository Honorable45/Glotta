import type { PosItem, Product, ProductInput } from '@gestion/contracts';
import { newId, normalizeSearch, validateAttributeValue } from '@gestion/domain';
import { AppError } from '../core/errors';
import { hasPermission } from '../core/session';
import { applyMovement, logger, readStockSettings, requireStoreId, type Context } from './commerce.shared';

const FACTOR = 1000n;

const productInclude = {
  category: { select: { name: true } },
  unit: { select: { symbol: true, allowsDecimal: true } },
  attributes: { select: { attributeId: true, value: true } },
  variants: {
    where: { archivedAt: null },
    orderBy: { label: 'asc' as const },
    include: { stockLevels: { select: { quantity: true, storeId: true } } },
  },
};

export function createCatalogService({ db, deviceId }: Context) {
  const log = logger(deviceId);

  type Row = NonNullable<Awaited<ReturnType<typeof loadOne>>>;
  function loadOne(id: string) {
    return db.product.findUnique({ where: { id }, include: productInclude });
  }

  function toProduct(row: Row, defaultThreshold: number, storeId: string): Product {
    const threshold = row.lowStockThreshold ?? BigInt(defaultThreshold) * FACTOR;
    return {
      id: row.id,
      name: row.name,
      reference: row.reference,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? null,
      unitId: row.unitId,
      unitSymbol: row.unit.symbol,
      allowsDecimal: row.unit.allowsDecimal,
      taxRateBp: row.taxRateBp,
      trackSerial: row.trackSerial,
      lowStockThreshold: row.lowStockThreshold,
      archived: row.archivedAt !== null,
      attributes: Object.fromEntries(row.attributes.map((item) => [item.attributeId, item.value])),
      variants: row.variants.map((variant) => {
        const quantity = variant.stockLevels.filter((level) => level.storeId === storeId).reduce((sum, level) => sum + level.quantity, 0n);
        return {
          id: variant.id,
          label: variant.label,
          sku: variant.sku,
          barcode: variant.barcode,
          // Le prix d'achat révèle la marge : réservé à ceux qui gèrent les produits ou voient les marges.
          purchasePrice: hasPermission('manage_products') || hasPermission('view_profit') ? variant.purchasePrice : 0n,
          salePrice: variant.salePrice,
          quantity,
          isLow: quantity <= threshold,
        };
      }),
    };
  }

  async function validate(input: ProductInput) {
    const unit = await db.unit.findUnique({ where: { id: input.unitId } });
    if (!unit || unit.archivedAt) throw new AppError('NOT_FOUND', 'Unité introuvable.');
    if (input.categoryId) {
      const category = await db.category.findUnique({ where: { id: input.categoryId } });
      if (!category || category.archivedAt) throw new AppError('NOT_FOUND', 'Catégorie introuvable.');
    }
    const links = input.categoryId
      ? await db.categoryAttribute.findMany({ where: { categoryId: input.categoryId, attribute: { archivedAt: null } }, include: { attribute: true } })
      : [];
    for (const { attribute } of links) {
      const value = input.attributes[attribute.id]?.trim() ?? '';
      if (!value) {
        if (attribute.required) throw new AppError('INVALID_INPUT', `${attribute.name} est obligatoire.`);
        continue;
      }
      const options = JSON.parse(attribute.options) as string[];
      const problem = validateAttributeValue({ name: attribute.name, type: attribute.type, options }, value);
      if (problem) throw new AppError('INVALID_INPUT', problem);
    }
    const barcodes = input.variants.flatMap((variant) => (variant.barcode ? [variant.barcode] : []));
    if (new Set(barcodes).size !== barcodes.length) throw new AppError('CONFLICT', 'Le même code-barres est utilisé deux fois.');
    if (barcodes.length) {
      const taken = await db.productVariant.findFirst({
        where: { barcode: { in: barcodes }, id: { notIn: input.variants.flatMap((variant) => (variant.id ? [variant.id] : [])) } },
      });
      if (taken) throw new AppError('CONFLICT', `Le code-barres ${taken.barcode} est déjà utilisé.`);
    }
    for (const variant of input.variants) {
      if (input.trackSerial && variant.initialQuantity > 0n) {
        throw new AppError('INVALID_INPUT', 'Pour un produit suivi par numéro de série, ajoutez le stock par une entrée avec ses numéros.');
      }
      if (!unit.allowsDecimal && variant.initialQuantity % FACTOR !== 0n) {
        throw new AppError('INVALID_INPUT', `L'unité ${unit.name} n'accepte pas les fractions.`);
      }
    }
    return links.map((link) => link.attribute.id);
  }

  return {
    async list(input: { search: string; categoryId: string | null; archived: boolean; lowOnly: boolean }): Promise<Product[]> {
      const { lowStockThreshold } = await readStockSettings(db);
      const search = normalizeSearch(input.search);
      const rows = await db.product.findMany({
        where: {
          archivedAt: input.archived ? { not: null } : null,
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          ...(search ? { searchText: { contains: search } } : {}),
        },
        orderBy: { name: 'asc' },
        ...(input.lowOnly ? {} : { take: 200 }),
        include: productInclude,
      });
      const storeId = await requireStoreId(db);
      const products = rows.map((row) => toProduct(row, lowStockThreshold, storeId));
      return input.lowOnly ? products.filter((product) => product.variants.some((variant) => variant.isLow)) : products;
    },

    async get(id: string): Promise<Product> {
      const row = await loadOne(id);
      if (!row) throw new AppError('NOT_FOUND', 'Produit introuvable.');
      return toProduct(row, (await readStockSettings(db)).lowStockThreshold, await requireStoreId(db));
    },

    async save(input: ProductInput): Promise<Product> {
      const allowedAttributes = await validate(input);
      const storeId = await requireStoreId(db);
      const id = input.id ?? newId();
      const searchText = normalizeSearch(
        [input.name, input.reference, ...input.variants.flatMap((variant) => [variant.label, variant.sku, variant.barcode])].filter(Boolean).join(' '),
      );
      const data = {
        name: input.name,
        searchText,
        reference: input.reference,
        categoryId: input.categoryId,
        unitId: input.unitId,
        taxRateBp: input.taxRateBp,
        trackSerial: input.trackSerial,
        lowStockThreshold: input.lowStockThreshold,
      };
      await db.$transaction(async (tx) => {
        if (input.id) {
          const existing = await tx.product.findUnique({ where: { id }, select: { trackSerial: true } });
          if (!existing) throw new AppError('NOT_FOUND', 'Produit introuvable.');
          await tx.product.update({ where: { id }, data });
          await tx.productAttributeValue.deleteMany({ where: { productId: id } });
          // Une variante retirée du formulaire est archivée : les ventes passées la référencent.
          const kept = input.variants.flatMap((variant) => (variant.id ? [variant.id] : []));
          await tx.productVariant.updateMany({ where: { productId: id, id: { notIn: kept }, archivedAt: null }, data: { archivedAt: new Date() } });
        } else {
          await tx.product.create({ data: { id, ...data } });
        }
        for (const attributeId of allowedAttributes) {
          const value = input.attributes[attributeId]?.trim();
          if (value) await tx.productAttributeValue.create({ data: { productId: id, attributeId, value } });
        }
        for (const variant of input.variants) {
          const { initialQuantity, id: variantId, ...fields } = variant;
          if (variantId) {
            const owned = await tx.productVariant.findFirst({ where: { id: variantId, productId: id } });
            if (!owned) throw new AppError('NOT_FOUND', 'Variante introuvable.');
            await tx.productVariant.update({ where: { id: variantId }, data: fields });
          } else {
            const created = newId();
            await tx.productVariant.create({ data: { id: created, productId: id, ...fields } });
            if (initialQuantity > 0n) {
              await applyMovement(tx, { variantId: created, storeId, type: 'IN', quantity: initialQuantity, unitCost: fields.purchasePrice, reason: 'Stock initial' });
            }
          }
        }
        await log(tx, 'product.save', 'Product', id, { name: input.name, variants: input.variants });
      });
      return this.get(id);
    },

    async setArchived(id: string, archived: boolean) {
      await db.$transaction(async (tx) => {
        await tx.product.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
        await log(tx, archived ? 'product.archive' : 'product.restore', 'Product', id, {});
      });
    },

    async posSearch(rawQuery: string): Promise<PosItem[]> {
      const query = rawQuery.trim();
      const search = normalizeSearch(query);
      const storeId = await requireStoreId(db);
      const serial = query ? await db.serialUnit.findUnique({ where: { serial: query } }) : null;
      const variants = await db.productVariant.findMany({
        where: {
          archivedAt: null,
          product: { archivedAt: null },
          // Sans recherche, l'écran de vente montre directement les produits.
          ...(query
            ? {
                OR: [
                  { barcode: query },
                  ...(serial ? [{ id: serial.variantId }] : []),
                  { product: { searchText: { contains: search } } },
                ],
              }
            : {}),
        },
        take: query ? 30 : 60,
        orderBy: { product: { name: 'asc' } },
        include: { product: { include: { unit: true } }, stockLevels: { select: { quantity: true }, where: { storeId } } },
      });
      const items = variants.map((variant): PosItem => {
        const isSerial = serial?.variantId === variant.id && serial.status === 'IN_STOCK';
        return {
          variantId: variant.id,
          productName: variant.product.name,
          variantLabel: variant.label,
          barcode: variant.barcode,
          reference: variant.product.reference,
          unitSymbol: variant.product.unit.symbol,
          allowsDecimal: variant.product.unit.allowsDecimal,
          trackSerial: variant.product.trackSerial,
          salePrice: variant.salePrice,
          quantity: variant.stockLevels.reduce((sum, level) => sum + level.quantity, 0n),
          exactMatch: variant.barcode === query || isSerial,
          matchedSerialId: isSerial ? serial.id : null,
        };
      });
      return items.sort((a, b) => Number(b.exactMatch) - Number(a.exactMatch) || a.productName.localeCompare(b.productName, 'fr'));
    },
  };
}
