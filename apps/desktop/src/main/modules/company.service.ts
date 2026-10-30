import type { Attribute, AttributeInput, Company, CompanyInput, SetupInput, StockSettings, UnitInput } from '@gestion/contracts';
import { attributeTypeSchema, stockSettingsSchema } from '@gestion/contracts';
import { recordChange, type Prisma, type PrismaClient } from '@gestion/db-local';
import { newId, sectorTemplates } from '@gestion/domain';
import { AppError } from '../core/errors';
import { currentUserId } from '../core/session';
import { hashPassword } from '../core/password';

const STOCK_KEY = 'stock.settings';
const DEFAULT_STOCK: StockSettings = { allowOutOfStockSales: false, lowStockThreshold: 5 };

type Context = { db: PrismaClient; deviceId: string };

const sameName = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0;

function assertUnique(names: string[], label: string) {
  for (const [index, value] of names.entries()) {
    if (names.findIndex((other) => sameName(other, value)) !== index) {
      throw new AppError('CONFLICT', `${label} en double : ${value}.`);
    }
  }
}

function toAttribute(row: {
  id: string;
  name: string;
  type: string;
  required: boolean;
  options: string;
  categories: { categoryId: string }[];
}): Attribute {
  return {
    id: row.id,
    name: row.name,
    type: attributeTypeSchema.parse(row.type),
    required: row.required,
    options: JSON.parse(row.options) as string[],
    categoryIds: row.categories.map((link) => link.categoryId),
  };
}

export function createCompanyService({ db, deviceId }: Context) {
  const log = (tx: Prisma.TransactionClient, action: string, entityType: string, entityId: string, details: Record<string, unknown>) =>
    recordChange(tx, { deviceId, actorId: currentUserId(), action, entityType, entityId, details, sync: true });

  async function requireCompany() {
    const company = await db.company.findFirst();
    if (!company) throw new AppError('NOT_FOUND', "L'entreprise n'est pas encore configurée.");
    return company;
  }

  async function assertNameFree(
    existing: { id: string; name: string }[],
    id: string | null,
    value: string,
    label: string,
  ) {
    if (existing.some((row) => row.id !== id && sameName(row.name, value))) {
      throw new AppError('CONFLICT', `${label} « ${value} » existe déjà.`);
    }
  }

  return {
    async listStores() {
      const [stores, chosen] = await Promise.all([db.store.findMany({ orderBy: { createdAt: 'asc' } }), db.setting.findUnique({ where: { key: 'device.storeId' } })]);
      const current = chosen?.value ?? stores[0]?.id;
      return stores.map((store) => ({ id: store.id, name: store.name, isCurrent: store.id === current }));
    },

    async saveStore(input: { id: string | null; name: string }, maxStores: number | null) {
      const stores = await db.store.findMany();
      await assertNameFree(stores, input.id, input.name, 'La boutique');
      if (!input.id && maxStores !== null && stores.length >= maxStores) {
        throw new AppError('CONFLICT', `Votre formule est limitée à ${maxStores} boutique(s).`);
      }
      const { id: companyId } = await requireCompany();
      const id = input.id ?? newId();
      await db.$transaction(async (tx) => {
        if (input.id) await tx.store.update({ where: { id }, data: { name: input.name } });
        else await tx.store.create({ data: { id, companyId, name: input.name } });
        await log(tx, 'store.save', 'Store', id, { name: input.name });
      });
      return { id, name: input.name, isCurrent: false };
    },

    /** Propre à ce poste : jamais synchronisé. */
    async setCurrentStore(id: string) {
      if (!(await db.store.findUnique({ where: { id } }))) throw new AppError('NOT_FOUND', 'Boutique introuvable.');
      await db.setting.upsert({ where: { key: 'device.storeId' }, create: { key: 'device.storeId', value: id }, update: { value: id } });
    },

    async getSetupState() {
      return { completed: (await db.company.count()) > 0 };
    },

    async completeSetup(input: SetupInput) {
      if (!sectorTemplates.some((sector) => sector.key === input.sector)) {
        throw new AppError('INVALID_INPUT', 'Secteur inconnu.');
      }
      assertUnique(input.categories, 'Catégorie');
      assertUnique(input.units.map((unit) => unit.name), 'Unité');
      assertUnique(input.attributes.map((attribute) => attribute.name), 'Caractéristique');
      assertUnique(input.paymentMethods, 'Mode de paiement');
      for (const attribute of input.attributes) {
        if (attribute.type === 'SELECT' && attribute.options.length === 0) {
          throw new AppError('INVALID_INPUT', `La liste « ${attribute.name} » a besoin d’au moins un choix.`);
        }
      }

      const passwordHash = await hashPassword(input.owner.password);
      const ownerId = newId();
      await db.$transaction(async (tx) => {
        // Vérifié dans la transaction : un double clic ne crée pas deux entreprises.
        if ((await tx.company.count()) > 0) throw new AppError('CONFLICT', "L'entreprise est déjà configurée.");
        const companyId = newId();
        await tx.company.create({ data: { id: companyId, sector: input.sector, ...input.company } });
        await tx.store.create({ data: { id: newId(), companyId, name: input.company.name } });
        await tx.user.create({ data: { id: ownerId, name: input.owner.name, login: input.owner.login, passwordHash, role: 'OWNER' } });

        const categoryIds = new Map<string, string>();
        for (const categoryName of input.categories) {
          const id = newId();
          categoryIds.set(categoryName, id);
          await tx.category.create({ data: { id, name: categoryName } });
        }
        for (const unit of input.units) await tx.unit.create({ data: { id: newId(), ...unit } });
        for (const attribute of input.attributes) {
          const linked = attribute.categoryNames.length ? attribute.categoryNames : input.categories;
          const links = linked.flatMap((categoryName) => {
            const categoryId = categoryIds.get(categoryName);
            return categoryId ? [{ categoryId }] : [];
          });
          await tx.attributeDefinition.create({
            data: {
              id: newId(),
              name: attribute.name,
              type: attribute.type,
              required: attribute.required,
              options: JSON.stringify(attribute.options),
              categories: { create: links },
            },
          });
        }
        for (const [position, methodName] of input.paymentMethods.entries()) {
          await tx.paymentMethod.create({ data: { id: newId(), name: methodName, position, isCash: methodName.toLowerCase() === 'espèces' } });
        }
        await tx.setting.create({ data: { key: STOCK_KEY, value: JSON.stringify(input.stock) } });
        await log(tx, 'setup.complete', 'Company', companyId, { sector: input.sector, name: input.company.name });
      });
      return { completed: true, ownerId };
    },

    async getCompany(): Promise<Company> {
      const { id, name, logoData, address, phone, email, currency, taxInfo, sector } = await requireCompany();
      return { id, name, logoData, address, phone, email, currency: currency as Company['currency'], taxInfo, sector };
    },

    async updateCompany(input: CompanyInput): Promise<Company> {
      const { id, sector } = await requireCompany();
      await db.$transaction(async (tx) => {
        await tx.company.update({ where: { id }, data: input });
        await log(tx, 'company.update', 'Company', id, { name: input.name, currency: input.currency });
      });
      return { id, sector, ...input };
    },

    listCategories() {
      return db.category.findMany({
        where: { archivedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, parentId: true },
      });
    },

    async saveCategory(input: { id: string | null; name: string; parentId: string | null }) {
      const active = await db.category.findMany({ where: { archivedAt: null } });
      await assertNameFree(active, input.id, input.name, 'La catégorie');
      if (input.parentId) {
        if (!active.some((row) => row.id === input.parentId)) throw new AppError('NOT_FOUND', 'Catégorie parente introuvable.');
        // Remonte la branche pour empêcher qu'une catégorie devienne sa propre ancêtre.
        const parents = new Map(active.map((row) => [row.id, row.parentId]));
        for (let current: string | null | undefined = input.parentId; current; current = parents.get(current)) {
          if (current === input.id) throw new AppError('CONFLICT', 'Une catégorie ne peut pas être rangée dans elle-même.');
        }
      }
      const id = input.id ?? newId();
      const data = { name: input.name, parentId: input.parentId };
      await db.$transaction(async (tx) => {
        if (input.id) await tx.category.update({ where: { id }, data });
        else await tx.category.create({ data: { id, ...data } });
        await log(tx, 'category.save', 'Category', id, data);
      });
      return { id, ...data };
    },

    async archiveCategory(id: string) {
      await db.$transaction(async (tx) => {
        if ((await tx.product.count({ where: { categoryId: id, archivedAt: null } })) > 0) {
          throw new AppError('CONFLICT', 'Des produits utilisent encore cette catégorie.');
        }
        if ((await tx.category.count({ where: { parentId: id, archivedAt: null } })) > 0) {
          throw new AppError('CONFLICT', "Cette catégorie contient des sous-catégories : archivez-les d'abord.");
        }
        await tx.category.update({ where: { id }, data: { archivedAt: new Date() } });
        await log(tx, 'category.archive', 'Category', id, {});
      });
    },

    async listAttributes(): Promise<Attribute[]> {
      const rows = await db.attributeDefinition.findMany({
        where: { archivedAt: null },
        orderBy: { name: 'asc' },
        include: { categories: { select: { categoryId: true } } },
      });
      return rows.map(toAttribute);
    },

    async saveAttribute(input: AttributeInput): Promise<Attribute> {
      const active = await db.attributeDefinition.findMany({ where: { archivedAt: null } });
      await assertNameFree(active, input.id, input.name, 'La caractéristique');
      const previous = active.find((row) => row.id === input.id);
      if (previous && previous.type !== input.type && (await db.productAttributeValue.count({ where: { attributeId: previous.id } })) > 0) {
        throw new AppError('CONFLICT', 'Des produits utilisent déjà cette caractéristique : son type ne peut plus changer.');
      }
      const id = input.id ?? newId();
      const options = input.type === 'SELECT' ? input.options : [];
      const data = { name: input.name, type: input.type, required: input.required, options: JSON.stringify(options) };
      await db.$transaction(async (tx) => {
        if (input.id) {
          await tx.attributeDefinition.update({ where: { id }, data });
          await tx.categoryAttribute.deleteMany({ where: { attributeId: id } });
        } else {
          await tx.attributeDefinition.create({ data: { id, ...data } });
        }
        for (const categoryId of input.categoryIds) {
          await tx.categoryAttribute.create({ data: { attributeId: id, categoryId } });
        }
        await log(tx, 'attribute.save', 'AttributeDefinition', id, { ...data, categoryIds: input.categoryIds });
      });
      return { ...input, id, options };
    },

    async archiveAttribute(id: string) {
      await db.$transaction(async (tx) => {
        await tx.attributeDefinition.update({ where: { id }, data: { archivedAt: new Date() } });
        await log(tx, 'attribute.archive', 'AttributeDefinition', id, {});
      });
    },

    listUnits() {
      return db.unit.findMany({
        where: { archivedAt: null },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, symbol: true, allowsDecimal: true },
      });
    },

    async saveUnit(input: UnitInput) {
      const active = await db.unit.findMany({ where: { archivedAt: null } });
      await assertNameFree(active, input.id, input.name, "L'unité");
      const id = input.id ?? newId();
      const { id: _id, ...data } = input;
      await db.$transaction(async (tx) => {
        if (input.id) await tx.unit.update({ where: { id }, data });
        else await tx.unit.create({ data: { id, ...data } });
        await log(tx, 'unit.save', 'Unit', id, data);
      });
      return { id, ...data };
    },

    async archiveUnit(id: string) {
      await db.$transaction(async (tx) => {
        if ((await tx.product.count({ where: { unitId: id, archivedAt: null } })) > 0) {
          throw new AppError('CONFLICT', 'Des produits utilisent encore cette unité.');
        }
        if ((await tx.unit.count({ where: { archivedAt: null } })) <= 1) {
          throw new AppError('CONFLICT', 'Conservez au moins une unité.');
        }
        await tx.unit.update({ where: { id }, data: { archivedAt: new Date() } });
        await log(tx, 'unit.archive', 'Unit', id, {});
      });
    },

    listPaymentMethods() {
      return db.paymentMethod.findMany({
        orderBy: { position: 'asc' },
        select: { id: true, name: true, isActive: true, isCash: true },
      });
    },

    async savePaymentMethod(input: { id: string | null; name: string; isActive: boolean; isCash?: boolean }) {
      const all = await db.paymentMethod.findMany();
      await assertNameFree(all, input.id, input.name, 'Le mode de paiement');
      if (!input.isActive && !all.some((row) => row.isActive && row.id !== input.id)) {
        throw new AppError('CONFLICT', 'Gardez au moins un mode de paiement actif.');
      }
      const id = input.id ?? newId();
      const previous = all.find((row) => row.id === input.id);
      const data = { name: input.name, isActive: input.isActive, isCash: input.isCash ?? previous?.isCash ?? false };
      await db.$transaction(async (tx) => {
        if (input.id) await tx.paymentMethod.update({ where: { id }, data });
        else await tx.paymentMethod.create({ data: { id, ...data, position: all.length } });
        await log(tx, 'paymentMethod.save', 'PaymentMethod', id, data);
      });
      return { id, ...data };
    },

    async getStockSettings(): Promise<StockSettings> {
      const setting = await db.setting.findUnique({ where: { key: STOCK_KEY } });
      return setting ? stockSettingsSchema.parse(JSON.parse(setting.value)) : DEFAULT_STOCK;
    },

    async saveStockSettings(input: StockSettings): Promise<StockSettings> {
      const value = JSON.stringify(input);
      await db.$transaction(async (tx) => {
        await tx.setting.upsert({ where: { key: STOCK_KEY }, create: { key: STOCK_KEY, value }, update: { value } });
        await log(tx, 'stockSettings.save', 'Setting', STOCK_KEY, { ...input });
      });
      return input;
    },
  };
}
