import { z } from 'zod';
import { allPermissions, type Permission } from '@gestion/domain';
import type { Channel } from './channels';

export * from './channels';
export * from './licensing';

export const themeSchema = z.enum(['system', 'light', 'dark']);
export type Theme = z.infer<typeof themeSchema>;

export const systemStatusSchema = z.object({
  appVersion: z.string(),
  deviceId: z.string(),
  appliedMigrations: z.number().int(),
  databaseEncrypted: z.boolean(),
  integrityOk: z.boolean(),
  auditChainOk: z.boolean(),
  auditEntries: z.number().int(),
  pendingSyncEvents: z.number().int(),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

const name = z.string().trim().min(1, 'Champ obligatoire').max(120);
const idOrNull = z.string().min(1).nullable();
const optionalText = z.string().trim().max(500).nullable();

export const attributeTypeSchema = z.enum(['TEXT', 'NUMBER', 'SELECT', 'DATE', 'BOOLEAN', 'MONEY']);

// SVG exclu : il peut contenir des scripts. Limite d'environ 2 Mo une fois décodé.
const logoSchema = z.string().regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/).max(2_800_000).nullable();

export const companyInputSchema = z
  .object({
    name,
    logoData: logoSchema,
    address: z.string().trim().min(1, 'Champ obligatoire').max(300),
    phone: z.string().trim().regex(/^\+?[0-9 ().-]{6,20}$/, 'Numéro de téléphone invalide'),
    email: z.email('Adresse email invalide').nullable(),
    currency: z.enum(['XOF', 'XAF', 'GNF', 'EUR', 'USD']),
    taxInfo: optionalText,
  })
  .strict();
export type CompanyInput = z.infer<typeof companyInputSchema>;

export const unitInputSchema = z
  .object({ id: idOrNull, name, symbol: z.string().trim().min(1).max(10), allowsDecimal: z.boolean() })
  .strict();
export type UnitInput = z.infer<typeof unitInputSchema>;

export const stockSettingsSchema = z
  .object({ allowOutOfStockSales: z.boolean(), lowStockThreshold: z.number().int().min(0).max(1_000_000) })
  .strict();
export type StockSettings = z.infer<typeof stockSettingsSchema>;

export const attributeInputSchema = z
  .object({
    id: idOrNull,
    name,
    type: attributeTypeSchema,
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).max(200),
    categoryIds: z.array(z.string().min(1)),
  })
  .strict()
  .refine((value) => value.type !== 'SELECT' || value.options.length > 0, {
    message: 'Une liste déroulante a besoin d’au moins un choix.',
  });
export type AttributeInput = z.infer<typeof attributeInputSchema>;

const loginSchema = z.string().trim().min(3, 'L’identifiant doit contenir au moins 3 caractères.').max(40).regex(/^[\p{L}0-9._-]+$/u, 'Identifiant : lettres, chiffres, point, tiret uniquement.');
const passwordSchema = z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.').max(200);

export const setupInputSchema = z
  .object({
    company: companyInputSchema,
    sector: z.string().min(1).max(40),
    categories: z.array(name).max(200),
    units: z.array(unitInputSchema.omit({ id: true })).min(1, 'Ajoutez au moins une unité.').max(50),
    attributes: z
      .array(
        z
          .object({
            name,
            type: attributeTypeSchema,
            required: z.boolean(),
            options: z.array(z.string().trim().min(1).max(80)).max(200),
            /** Vide = toutes les catégories. */
            categoryNames: z.array(name),
          })
          .strict(),
      )
      .max(100),
    paymentMethods: z.array(name).min(1, 'Ajoutez au moins un mode de paiement.').max(30),
    stock: stockSettingsSchema,
    owner: z.object({ name, login: loginSchema, password: passwordSchema }).strict(),
  })
  .strict();
export type SetupInput = z.infer<typeof setupInputSchema>;

const companySchema = companyInputSchema.extend({ id: z.string(), sector: z.string() });
const categorySchema = z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable() });
const unitSchema = z.object({ id: z.string(), name: z.string(), symbol: z.string(), allowsDecimal: z.boolean() });
const attributeSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: attributeTypeSchema,
  required: z.boolean(),
  options: z.array(z.string()),
  categoryIds: z.array(z.string()),
});
const paymentMethodSchema = z.object({ id: z.string(), name: z.string(), isActive: z.boolean(), isCash: z.boolean() });
const idInput = z.object({ id: z.string().min(1) }).strict();

export type Company = z.infer<typeof companySchema>;
export type Category = z.infer<typeof categorySchema>;
export type Unit = z.infer<typeof unitSchema>;
export type Attribute = z.infer<typeof attributeSchema>;
export type PaymentMethodItem = z.infer<typeof paymentMethodSchema>;

const money = z.bigint().min(0n);
const quantity = z.bigint().min(1n);
const shortText = z.string().trim().min(1).max(120).nullable();

export const productInputSchema = z
  .object({
    id: idOrNull,
    name,
    reference: shortText,
    categoryId: idOrNull,
    unitId: z.string().min(1),
    taxRateBp: z.number().int().min(0).max(10_000),
    trackSerial: z.boolean(),
    lowStockThreshold: z.bigint().min(0n).nullable(),
    attributes: z.record(z.string(), z.string().max(500)),
    variants: z
      .array(
        z
          .object({
            id: idOrNull,
            label: z.string().trim().max(120),
            sku: shortText,
            barcode: z.string().trim().min(1).max(64).nullable(),
            purchasePrice: money,
            salePrice: money,
            initialQuantity: z.bigint().min(0n),
          })
          .strict(),
      )
      .min(1, 'Ajoutez au moins une variante.'),
  })
  .strict();
export type ProductInput = z.infer<typeof productInputSchema>;

const variantSchema = z.object({
  id: z.string(),
  label: z.string(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  purchasePrice: z.bigint(),
  salePrice: z.bigint(),
  quantity: z.bigint(),
  isLow: z.boolean(),
});
const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  reference: z.string().nullable(),
  categoryId: z.string().nullable(),
  categoryName: z.string().nullable(),
  unitId: z.string(),
  unitSymbol: z.string(),
  allowsDecimal: z.boolean(),
  taxRateBp: z.number(),
  trackSerial: z.boolean(),
  lowStockThreshold: z.bigint().nullable(),
  archived: z.boolean(),
  attributes: z.record(z.string(), z.string()),
  variants: z.array(variantSchema),
});
export type Product = z.infer<typeof productSchema>;

const posItemSchema = z.object({
  variantId: z.string(),
  productName: z.string(),
  variantLabel: z.string(),
  barcode: z.string().nullable(),
  reference: z.string().nullable(),
  unitSymbol: z.string(),
  allowsDecimal: z.boolean(),
  trackSerial: z.boolean(),
  salePrice: z.bigint(),
  quantity: z.bigint(),
  /** Vrai si la recherche correspond exactement à un code-barres ou un numéro de série. */
  exactMatch: z.boolean(),
  matchedSerialId: z.string().nullable(),
});
export type PosItem = z.infer<typeof posItemSchema>;

const movementSchema = z.object({
  id: z.string(),
  productName: z.string(),
  variantLabel: z.string(),
  type: z.string(),
  quantity: z.bigint(),
  reason: z.string().nullable(),
  occurredAt: z.string(),
});
export type StockMovementItem = z.infer<typeof movementSchema>;

const inventorySchema = z
  .object({
    id: z.string(),
    startedAt: z.string(),
    lines: z.array(
      z.object({
        id: z.string(),
        productName: z.string(),
        variantLabel: z.string(),
        expected: z.bigint(),
        counted: z.bigint().nullable(),
      }),
    ),
  })
  .nullable();
export type InventoryCount = NonNullable<z.infer<typeof inventorySchema>>;

export const customerInputSchema = z
  .object({
    id: idOrNull,
    name,
    phone: z.string().trim().regex(/^\+?[0-9 ().-]{6,20}$/, 'Numéro de téléphone invalide').nullable(),
    whatsapp: z.string().trim().regex(/^\+?[0-9 ().-]{6,20}$/, 'Numéro WhatsApp invalide').nullable(),
    address: optionalText,
  })
  .strict();
export type CustomerInput = z.infer<typeof customerInputSchema>;

const customerSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  address: z.string().nullable(),
  balance: z.bigint(),
  archived: z.boolean(),
});
export type Customer = z.infer<typeof customerSchema>;

const saleSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  customerName: z.string().nullable(),
  netTotal: z.bigint(),
  netPaid: z.bigint(),
  occurredAt: z.string(),
});
export type SaleSummary = z.infer<typeof saleSummarySchema>;

const saleLineSchema = z.object({
  id: z.string(),
  productName: z.string(),
  variantLabel: z.string(),
  quantity: z.bigint(),
  returnedQuantity: z.bigint(),
  unitPrice: z.bigint(),
  lineDiscount: z.bigint(),
  cartDiscount: z.bigint(),
  lineTotal: z.bigint(),
  taxRateBp: z.number(),
  tax: z.bigint(),
  serials: z.array(z.object({ id: z.string(), serial: z.string() })),
});
const saleDetailSchema = saleSummarySchema.extend({
  subtotal: z.bigint(),
  discount: z.bigint(),
  tax: z.bigint(),
  total: z.bigint(),
  cancelReason: z.string().nullable(),
  lines: z.array(saleLineSchema),
  payments: z.array(z.object({ id: z.string(), methodName: z.string(), amount: z.bigint(), kind: z.string(), occurredAt: z.string() })),
  returns: z.array(z.object({ id: z.string(), reason: z.string(), amount: z.bigint(), refund: z.bigint(), occurredAt: z.string() })),
});
export type SaleDetail = z.infer<typeof saleDetailSchema>;

export const saleInputSchema = z
  .object({
    /** Généré par le poste : un double clic ou un renvoi ne crée pas deux ventes. */
    id: z.uuid(),
    customerId: idOrNull,
    cartDiscount: money,
    dueDate: z.iso.date().nullable(),
    lines: z
      .array(
        z
          .object({
            variantId: z.string().min(1),
            quantity,
            lineDiscount: money,
            unitPrice: money.nullable(),
            serialIds: z.array(z.string().min(1)),
          })
          .strict(),
      )
      .min(1, 'Le panier est vide.'),
    payments: z.array(z.object({ methodId: z.string().min(1), amount: z.bigint().min(1n) }).strict()),
  })
  .strict();
export type SaleInput = z.infer<typeof saleInputSchema>;

export const saleReturnInputSchema = z
  .object({
    saleId: z.string().min(1),
    reason: z.string().trim().min(1, 'Indiquez le motif.').max(300),
    refundMethodId: idOrNull,
    lines: z
      .array(z.object({ saleLineId: z.string().min(1), quantity, restock: z.boolean(), serialIds: z.array(z.string().min(1)) }).strict())
      .min(1, 'Sélectionnez au moins un article.'),
  })
  .strict();
export type SaleReturnInput = z.infer<typeof saleReturnInputSchema>;

const debtSchema = z.object({
  id: z.string(),
  saleId: z.string(),
  saleNumber: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  total: z.bigint(),
  paid: z.bigint(),
  remaining: z.bigint(),
  dueDate: z.string().nullable(),
  status: z.enum(['PENDING', 'PARTIAL', 'PAID', 'OVERDUE']),
});
export type DebtItem = z.infer<typeof debtSchema>;

const expenseSchema = z.object({
  id: z.string(),
  label: z.string(),
  categoryName: z.string(),
  amount: z.bigint(),
  date: z.string(),
  comment: z.string().nullable(),
  voidedAt: z.string().nullable(),
});
export type ExpenseItem = z.infer<typeof expenseSchema>;

const cashMovementSchema = z.object({ id: z.string(), type: z.string(), amount: z.bigint(), reason: z.string(), occurredAt: z.string() });
const cashSessionSchema = z.object({
  id: z.string(),
  openingFloat: z.bigint(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  cashSales: z.bigint(),
  cashIn: z.bigint(),
  cashOut: z.bigint(),
  expected: z.bigint(),
  counted: z.bigint().nullable(),
  difference: z.bigint().nullable(),
  note: z.string().nullable(),
  movements: z.array(cashMovementSchema),
});
export type CashSessionItem = z.infer<typeof cashSessionSchema>;

const periodSchema = z.object({ from: z.iso.datetime(), to: z.iso.datetime() }).strict();
export type Period = z.infer<typeof periodSchema>;

const dashboardSchema = z.object({
  revenue: z.bigint(),
  revenueToday: z.bigint(),
  revenueMonth: z.bigint(),
  collections: z.bigint(),
  salesCount: z.number().int(),
  /** Null si l'utilisateur n'a pas le droit de voir les marges. */
  margin: z.bigint().nullable(),
  expenses: z.bigint(),
  profit: z.bigint().nullable(),
  receivables: z.bigint(),
  lowStock: z.array(z.object({ id: z.string(), name: z.string(), quantity: z.bigint(), unitSymbol: z.string() })),
  recentSales: z.array(saleSummarySchema),
  trend: z.array(z.object({ label: z.string(), revenue: z.bigint() })),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const roleSchema = z.enum(['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'SELLER', 'STOCK']);
const permissionSchema = z.enum(allPermissions as [Permission, ...Permission[]]);

const sessionSchema = z
  .object({ id: z.string(), name: z.string(), login: z.string(), role: roleSchema, permissions: z.array(permissionSchema) })
  .nullable();
export type Session = NonNullable<z.infer<typeof sessionSchema>>;

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  login: z.string(),
  role: roleSchema,
  overrides: z.partialRecord(permissionSchema, z.boolean()),
  disabled: z.boolean(),
});
export type UserItem = z.infer<typeof userSchema>;

export const userInputSchema = z
  .object({
    id: idOrNull,
    name,
    login: loginSchema,
    role: roleSchema,
    overrides: z.partialRecord(permissionSchema, z.boolean()),
    /** Obligatoire à la création seulement. */
    password: passwordSchema.nullable(),
  })
  .strict();
export type UserInput = z.infer<typeof userInputSchema>;

const auditEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  details: z.string(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

const licenseStateSchema = z.object({
  /** Faux si cette version n'a ni adresse de serveur ni clé publique. */
  configured: z.boolean(),
  status: z.enum(['NONE', 'ACTIVE', 'EXPIRING', 'GRACE', 'EXPIRED', 'SUSPENDED', 'OFFLINE_EXPIRED', 'CLOCK_TAMPERED']),
  canOperate: z.boolean(),
  planCode: z.string().nullable(),
  isTrial: z.boolean(),
  expiresAt: z.string().nullable(),
  graceUntil: z.string().nullable(),
  features: z.array(z.string()),
  maxUsers: z.number().int().nullable(),
});
export type LicenseState = z.infer<typeof licenseStateSchema>;

const planSchema = z.object({ code: z.string(), name: z.string(), price: z.number().int(), maxUsers: z.number().int(), maxStores: z.number().int(), features: z.array(z.string()) });
export type PlanItem = z.infer<typeof planSchema>;

const emailSchema = z.email('Adresse email invalide');
const accountPassword = z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.').max(200);

const reminderSchema = z.object({
  id: z.string(),
  debtId: z.string(),
  customerName: z.string(),
  remaining: z.bigint(),
  dueDate: z.string(),
  note: z.string().nullable(),
  state: z.enum(['PLANNED', 'OPENED', 'DONE']),
  overdue: z.boolean(),
  hasWhatsapp: z.boolean(),
});
export type ReminderItem = z.infer<typeof reminderSchema>;

const backupStatusSchema = z.object({
  lastBackupAt: z.string().nullable(),
  folder: z.string().nullable(),
  files: z.array(z.object({ name: z.string(), createdAt: z.string(), size: z.number() })),
});
export type BackupStatus = z.infer<typeof backupStatusSchema>;

const syncStatusSchema = z.object({
  enabled: z.boolean(),
  pending: z.number().int(),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  conflicts: z.array(z.object({ id: z.string(), kind: z.string(), message: z.string(), occurredAt: z.string() })),
});
export type SyncStatus = z.infer<typeof syncStatusSchema>;

const storeSchema = z.object({ id: z.string(), name: z.string(), isCurrent: z.boolean() });
export type StoreItem = z.infer<typeof storeSchema>;

export const reportKinds = ['dailySales', 'monthlySales', 'salesByEmployee', 'salesByProduct', 'topProducts', 'expenses', 'receivables', 'stock', 'margins', 'cash', 'salesByStore'] as const;
export type ReportKind = (typeof reportKinds)[number];

const reportCell = z.union([z.string(), z.bigint()]);
const reportSchema = z.object({
  title: z.string(),
  columns: z.array(z.object({ key: z.string(), label: z.string(), kind: z.enum(['text', 'money', 'quantity']) })),
  rows: z.array(z.record(z.string(), reportCell)),
  totals: z.record(z.string(), reportCell).nullable(),
});
export type Report = z.infer<typeof reportSchema>;

export const contract = {
  'system.getStatus': { input: z.undefined(), output: systemStatusSchema },
  'settings.getTheme': { input: z.undefined(), output: themeSchema },
  'settings.setTheme': { input: z.object({ theme: themeSchema }).strict(), output: themeSchema },
  'setup.getState': { input: z.undefined(), output: z.object({ completed: z.boolean() }) },
  'setup.complete': { input: setupInputSchema, output: z.object({ completed: z.boolean() }) },
  'company.get': { input: z.undefined(), output: companySchema },
  'company.update': { input: companyInputSchema, output: companySchema },
  'company.pickLogo': { input: z.undefined(), output: logoSchema },
  'categories.list': { input: z.undefined(), output: z.array(categorySchema) },
  'categories.save': {
    input: z.object({ id: idOrNull, name, parentId: idOrNull }).strict(),
    output: categorySchema,
  },
  'categories.archive': { input: idInput, output: z.void() },
  'attributes.list': { input: z.undefined(), output: z.array(attributeSchema) },
  'attributes.save': { input: attributeInputSchema, output: attributeSchema },
  'attributes.archive': { input: idInput, output: z.void() },
  'units.list': { input: z.undefined(), output: z.array(unitSchema) },
  'units.save': { input: unitInputSchema, output: unitSchema },
  'units.archive': { input: idInput, output: z.void() },
  'paymentMethods.list': { input: z.undefined(), output: z.array(paymentMethodSchema) },
  'paymentMethods.save': {
    input: z.object({ id: idOrNull, name, isActive: z.boolean(), isCash: z.boolean() }).strict(),
    output: paymentMethodSchema,
  },
  'stockSettings.get': { input: z.undefined(), output: stockSettingsSchema },
  'stockSettings.save': { input: stockSettingsSchema, output: stockSettingsSchema },
  'products.list': {
    input: z.object({ search: z.string().max(120), categoryId: idOrNull, archived: z.boolean(), lowOnly: z.boolean() }).strict(),
    output: z.array(productSchema),
  },
  'products.get': { input: idInput, output: productSchema },
  'products.save': { input: productInputSchema, output: productSchema },
  'products.setArchived': { input: z.object({ id: z.string().min(1), archived: z.boolean() }).strict(), output: z.void() },
  'pos.search': { input: z.object({ query: z.string().max(120) }).strict(), output: z.array(posItemSchema) },
  'stock.move': {
    input: z
      .object({
        variantId: z.string().min(1),
        direction: z.enum(['IN', 'OUT']),
        quantity,
        unitCost: money.nullable(),
        reason: z.string().trim().min(1, 'Indiquez le motif.').max(300),
        serials: z.array(z.string().trim().min(1).max(64)),
      })
      .strict(),
    output: z.void(),
  },
  'stock.movements': { input: z.object({ variantId: idOrNull }).strict(), output: z.array(movementSchema) },
  'stock.availableSerials': {
    input: z.object({ variantId: z.string().min(1) }).strict(),
    output: z.array(z.object({ id: z.string(), serial: z.string() })),
  },
  'inventory.current': { input: z.undefined(), output: inventorySchema },
  'inventory.start': { input: z.undefined(), output: inventorySchema },
  'inventory.setCounted': { input: z.object({ lineId: z.string().min(1), counted: z.bigint().min(0n).nullable() }).strict(), output: z.void() },
  'inventory.close': { input: z.undefined(), output: z.object({ adjusted: z.number().int() }) },
  'customers.list': { input: z.object({ search: z.string().max(120) }).strict(), output: z.array(customerSchema) },
  'customers.get': {
    input: idInput,
    output: customerSchema.extend({ sales: z.array(saleSummarySchema) }),
  },
  'customers.save': { input: customerInputSchema, output: customerSchema },
  'customers.setArchived': { input: z.object({ id: z.string().min(1), archived: z.boolean() }).strict(), output: z.void() },
  'sales.create': { input: saleInputSchema, output: saleSummarySchema },
  'sales.list': { input: z.object({ limit: z.number().int().min(1).max(500) }).strict(), output: z.array(saleSummarySchema) },
  'sales.get': { input: idInput, output: saleDetailSchema },
  'sales.return': { input: saleReturnInputSchema, output: saleDetailSchema },
  'sales.cancel': {
    input: z.object({ saleId: z.string().min(1), reason: z.string().trim().min(1, 'Indiquez le motif.').max(300), refundMethodId: idOrNull }).strict(),
    output: saleDetailSchema,
  },
  'sales.print': {
    input: z.object({ saleId: z.string().min(1), format: z.enum(['thermal', 'a4']) }).strict(),
    output: z.void(),
  },
  'debts.list': { input: z.object({ openOnly: z.boolean(), customerId: idOrNull }).strict(), output: z.array(debtSchema) },
  'debts.pay': {
    input: z.object({ id: z.uuid(), debtId: z.string().min(1), amount: z.bigint().min(1n), methodId: z.string().min(1) }).strict(),
    output: debtSchema,
  },
  'debts.setDueDate': { input: z.object({ debtId: z.string().min(1), dueDate: z.iso.date().nullable() }).strict(), output: z.void() },
  'expenseCategories.list': { input: z.undefined(), output: z.array(z.object({ id: z.string(), name: z.string() })) },
  'expenseCategories.save': { input: z.object({ id: idOrNull, name }).strict(), output: z.object({ id: z.string(), name: z.string() }) },
  'expenses.list': { input: periodSchema, output: z.array(expenseSchema) },
  'expenses.create': {
    input: z
      .object({
        label: name,
        categoryId: z.string().min(1),
        amount: z.bigint().min(1n),
        date: z.iso.date(),
        comment: optionalText,
        paidFromCash: z.boolean(),
      })
      .strict(),
    output: expenseSchema,
  },
  'expenses.void': { input: z.object({ id: z.string().min(1), reason: z.string().trim().min(1, 'Indiquez le motif.').max(300) }).strict(), output: z.void() },
  'cash.current': { input: z.undefined(), output: cashSessionSchema.nullable() },
  'cash.open': { input: z.object({ openingFloat: money }).strict(), output: cashSessionSchema },
  'cash.move': {
    input: z.object({ type: z.enum(['IN', 'OUT', 'WITHDRAWAL']), amount: z.bigint().min(1n), reason: z.string().trim().min(1, 'Indiquez le motif.').max(300) }).strict(),
    output: cashSessionSchema,
  },
  'cash.close': { input: z.object({ counted: money, note: optionalText }).strict(), output: cashSessionSchema },
  'cash.history': { input: z.object({ limit: z.number().int().min(1).max(200) }).strict(), output: z.array(cashSessionSchema) },
  'dashboard.get': { input: periodSchema, output: dashboardSchema },
  'dashboard.getHidden': { input: z.undefined(), output: z.array(z.string()) },
  'dashboard.setHidden': { input: z.object({ hidden: z.array(z.string().max(40)).max(30) }).strict(), output: z.array(z.string()) },
  'reports.run': { input: z.object({ kind: z.enum(reportKinds), period: periodSchema }).strict(), output: reportSchema },
  'reports.export': {
    input: z.object({ kind: z.enum(reportKinds), period: periodSchema, format: z.enum(['csv', 'xlsx', 'pdf']) }).strict(),
    output: z.object({ path: z.string().nullable() }),
  },
  'auth.session': { input: z.undefined(), output: sessionSchema },
  'auth.login': { input: z.object({ login: z.string().max(40), password: z.string().max(200) }).strict(), output: sessionSchema },
  'auth.logout': { input: z.undefined(), output: z.void() },
  'auth.changePassword': { input: z.object({ current: z.string().max(200), next: passwordSchema }).strict(), output: z.void() },
  'users.list': { input: z.undefined(), output: z.array(userSchema) },
  'users.save': { input: userInputSchema, output: userSchema },
  'users.setDisabled': { input: z.object({ id: z.string().min(1), disabled: z.boolean() }).strict(), output: z.void() },
  'users.resetPassword': { input: z.object({ id: z.string().min(1), password: passwordSchema }).strict(), output: z.void() },
  'audit.list': { input: z.object({ limit: z.number().int().min(1).max(500) }).strict(), output: z.array(auditEntrySchema) },
  'reminders.list': { input: z.object({ includeDone: z.boolean() }).strict(), output: z.array(reminderSchema) },
  'reminders.create': { input: z.object({ debtId: z.string().min(1), dueDate: z.iso.date(), note: optionalText }).strict(), output: reminderSchema },
  'reminders.whatsapp': { input: idInput, output: reminderSchema },
  'reminders.markDone': { input: idInput, output: reminderSchema },
  'debts.whatsapp': { input: z.object({ debtId: z.string().min(1) }).strict(), output: z.void() },
  'backup.status': { input: z.undefined(), output: backupStatusSchema },
  'backup.create': { input: z.undefined(), output: backupStatusSchema },
  'backup.revealCode': { input: z.undefined(), output: z.object({ code: z.string() }) },
  'backup.chooseFolder': { input: z.undefined(), output: backupStatusSchema },
  'backup.restore': { input: z.object({ code: z.string().trim().min(10).max(100) }).strict(), output: z.object({ restored: z.boolean() }) },
  'sync.status': { input: z.undefined(), output: syncStatusSchema },
  'sync.enable': { input: z.undefined(), output: syncStatusSchema },
  'sync.run': { input: z.undefined(), output: syncStatusSchema },
  'sync.join': {
    input: z.object({ email: z.email('Adresse email invalide'), password: z.string().min(8).max(200), code: z.string().trim().min(10).max(100) }).strict(),
    output: z.object({ joined: z.boolean() }),
  },
  'sync.resolveConflict': { input: idInput, output: syncStatusSchema },
  'stores.list': { input: z.undefined(), output: z.array(storeSchema) },
  'stores.save': { input: z.object({ id: idOrNull, name }).strict(), output: storeSchema },
  'stores.setCurrent': { input: idInput, output: z.array(storeSchema) },
  'system.checkUpdate': { input: z.undefined(), output: z.object({ available: z.boolean(), version: z.string().nullable(), notes: z.string().nullable() }) },
  'license.state': { input: z.undefined(), output: licenseStateSchema },
  'license.plans': { input: z.undefined(), output: z.array(planSchema) },
  'license.signup': { input: z.object({ email: emailSchema, password: accountPassword }).strict(), output: licenseStateSchema },
  'license.activate': { input: z.object({ email: emailSchema, password: accountPassword }).strict(), output: licenseStateSchema },
  'license.refresh': { input: z.undefined(), output: licenseStateSchema },
  'license.pay': { input: z.object({ planCode: z.string().min(1).max(40), months: z.number().int().min(1).max(12) }).strict(), output: z.object({ intentId: z.string() }) },
  'license.paymentStatus': { input: z.object({ intentId: z.string().min(1) }).strict(), output: z.object({ status: z.string() }) },
} satisfies Record<Channel, { input: z.ZodType; output: z.ZodType }>;

export type Input<C extends Channel> = z.infer<(typeof contract)[C]['input']>;
export type Output<C extends Channel> = z.infer<(typeof contract)[C]['output']>;

/**
 * Niveau d'accès de chaque canal, vérifié avant tout traitement. L'exhaustivité est imposée
 * à la compilation : un nouveau canal ne peut pas oublier de déclarer le sien.
 */
export const channelAccess: Record<Channel, 'public' | 'authenticated' | Permission> = {
  'system.getStatus': 'authenticated',
  'settings.getTheme': 'public',
  'settings.setTheme': 'authenticated',
  'setup.getState': 'public',
  'setup.complete': 'public',
  'company.get': 'authenticated',
  'company.update': 'manage_settings',
  'company.pickLogo': 'public',
  'categories.list': 'authenticated',
  'categories.save': 'manage_settings',
  'categories.archive': 'manage_settings',
  'attributes.list': 'authenticated',
  'attributes.save': 'manage_settings',
  'attributes.archive': 'manage_settings',
  'units.list': 'authenticated',
  'units.save': 'manage_settings',
  'units.archive': 'manage_settings',
  'paymentMethods.list': 'authenticated',
  'paymentMethods.save': 'manage_settings',
  'stockSettings.get': 'authenticated',
  'stockSettings.save': 'manage_settings',
  'products.list': 'authenticated',
  'products.get': 'authenticated',
  'products.save': 'manage_products',
  'products.setArchived': 'manage_products',
  'pos.search': 'sell',
  'stock.move': 'manage_stock',
  'stock.movements': 'manage_stock',
  'stock.availableSerials': 'authenticated',
  'inventory.current': 'manage_stock',
  'inventory.start': 'manage_stock',
  'inventory.setCounted': 'manage_stock',
  'inventory.close': 'manage_stock',
  'customers.list': 'authenticated',
  'customers.get': 'authenticated',
  'customers.save': 'manage_customers',
  'customers.setArchived': 'manage_customers',
  'sales.create': 'sell',
  'sales.list': 'sell',
  'sales.get': 'sell',
  'sales.return': 'cancel_sale',
  'sales.cancel': 'cancel_sale',
  'sales.print': 'sell',
  'debts.list': 'view_debts',
  'debts.pay': 'collect_debts',
  'debts.setDueDate': 'collect_debts',
  'expenseCategories.list': 'manage_expenses',
  'expenseCategories.save': 'manage_expenses',
  'expenses.list': 'manage_expenses',
  'expenses.create': 'manage_expenses',
  'expenses.void': 'manage_expenses',
  'cash.current': 'manage_cash',
  'cash.open': 'manage_cash',
  'cash.move': 'manage_cash',
  'cash.close': 'manage_cash',
  'cash.history': 'manage_cash',
  'dashboard.get': 'view_dashboard',
  'dashboard.getHidden': 'view_dashboard',
  'dashboard.setHidden': 'view_dashboard',
  'reports.run': 'view_reports',
  'reports.export': 'export_reports',
  'auth.session': 'public',
  'auth.login': 'public',
  'auth.logout': 'public',
  'auth.changePassword': 'authenticated',
  'users.list': 'manage_users',
  'users.save': 'manage_users',
  'users.setDisabled': 'manage_users',
  'users.resetPassword': 'manage_users',
  'audit.list': 'view_audit',
  'reminders.list': 'view_debts',
  'reminders.create': 'collect_debts',
  'reminders.whatsapp': 'collect_debts',
  'reminders.markDone': 'collect_debts',
  'debts.whatsapp': 'collect_debts',
  'backup.status': 'manage_settings',
  'backup.create': 'manage_settings',
  'backup.revealCode': 'manage_settings',
  'backup.chooseFolder': 'manage_settings',
  'backup.restore': 'manage_settings',
  'sync.status': 'manage_settings',
  'sync.enable': 'manage_settings',
  'sync.run': 'authenticated',
  'sync.join': 'public',
  'sync.resolveConflict': 'manage_settings',
  'stores.list': 'authenticated',
  'stores.save': 'manage_settings',
  'stores.setCurrent': 'manage_settings',
  'system.checkUpdate': 'authenticated',
  'license.state': 'authenticated',
  'license.plans': 'authenticated',
  'license.signup': 'manage_settings',
  'license.activate': 'manage_settings',
  'license.refresh': 'authenticated',
  'license.pay': 'manage_settings',
  'license.paymentStatus': 'manage_settings',
};

export type ErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'UNKNOWN_CHANNEL' | 'NOT_FOUND' | 'CONFLICT' | 'INTERNAL';

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string } };

export interface DesktopApi {
  invoke<C extends Channel>(channel: C, input: Input<C>): Promise<IpcResult<Output<C>>>;
}
