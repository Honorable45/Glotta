-- CreateTable
CREATE TABLE "ChangeLog" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tableName" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "SyncRowVersion" (
    "tableName" TEXT NOT NULL,
    "rowKey" TEXT NOT NULL,
    "at" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,

    PRIMARY KEY ("tableName", "rowKey")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "occurredAt" TEXT NOT NULL,
    "resolvedAt" TEXT
);

-- CreateTable
CREATE TABLE "SyncFlag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "applying" INTEGER NOT NULL DEFAULT 0
);


-- Capture des changements à synchroniser.
INSERT INTO "SyncFlag" ("id", "applying") VALUES (1, 0);
CREATE TRIGGER "Company_sync_ins" AFTER INSERT ON "Company" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Company', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Company_sync_upd" AFTER UPDATE ON "Company" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Company', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Store_sync_ins" AFTER INSERT ON "Store" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Store', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Store_sync_upd" AFTER UPDATE ON "Store" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Store', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Category_sync_ins" AFTER INSERT ON "Category" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Category', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Category_sync_upd" AFTER UPDATE ON "Category" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Category', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Unit_sync_ins" AFTER INSERT ON "Unit" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Unit', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Unit_sync_upd" AFTER UPDATE ON "Unit" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Unit', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "AttributeDefinition_sync_ins" AFTER INSERT ON "AttributeDefinition" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('AttributeDefinition', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "AttributeDefinition_sync_upd" AFTER UPDATE ON "AttributeDefinition" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('AttributeDefinition', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "PaymentMethod_sync_ins" AFTER INSERT ON "PaymentMethod" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('PaymentMethod', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "PaymentMethod_sync_upd" AFTER UPDATE ON "PaymentMethod" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('PaymentMethod', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Product_sync_ins" AFTER INSERT ON "Product" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Product', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Product_sync_upd" AFTER UPDATE ON "Product" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Product', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "ProductVariant_sync_ins" AFTER INSERT ON "ProductVariant" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('ProductVariant', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "ProductVariant_sync_upd" AFTER UPDATE ON "ProductVariant" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('ProductVariant', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Customer_sync_ins" AFTER INSERT ON "Customer" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Customer', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Customer_sync_upd" AFTER UPDATE ON "Customer" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Customer', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "User_sync_ins" AFTER INSERT ON "User" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('User', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "User_sync_upd" AFTER UPDATE ON "User" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('User', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Sale_sync_ins" AFTER INSERT ON "Sale" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Sale', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Sale_sync_upd" AFTER UPDATE ON "Sale" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Sale', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SaleLine_sync_ins" AFTER INSERT ON "SaleLine" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SaleLine', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SaleLine_sync_upd" AFTER UPDATE ON "SaleLine" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SaleLine', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SalePayment_sync_ins" AFTER INSERT ON "SalePayment" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SalePayment', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SalePayment_sync_upd" AFTER UPDATE ON "SalePayment" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SalePayment', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SaleReturn_sync_ins" AFTER INSERT ON "SaleReturn" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SaleReturn', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SaleReturn_sync_upd" AFTER UPDATE ON "SaleReturn" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SaleReturn', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SaleReturnLine_sync_ins" AFTER INSERT ON "SaleReturnLine" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SaleReturnLine', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SaleReturnLine_sync_upd" AFTER UPDATE ON "SaleReturnLine" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SaleReturnLine', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Debt_sync_ins" AFTER INSERT ON "Debt" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Debt', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Debt_sync_upd" AFTER UPDATE ON "Debt" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Debt', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "ExpenseCategory_sync_ins" AFTER INSERT ON "ExpenseCategory" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('ExpenseCategory', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "ExpenseCategory_sync_upd" AFTER UPDATE ON "ExpenseCategory" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('ExpenseCategory', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Expense_sync_ins" AFTER INSERT ON "Expense" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Expense', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Expense_sync_upd" AFTER UPDATE ON "Expense" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Expense', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "CashSession_sync_ins" AFTER INSERT ON "CashSession" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('CashSession', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "CashSession_sync_upd" AFTER UPDATE ON "CashSession" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('CashSession', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "CashMovement_sync_ins" AFTER INSERT ON "CashMovement" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('CashMovement', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "CashMovement_sync_upd" AFTER UPDATE ON "CashMovement" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('CashMovement', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Reminder_sync_ins" AFTER INSERT ON "Reminder" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Reminder', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Reminder_sync_upd" AFTER UPDATE ON "Reminder" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Reminder', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "StockMovement_sync_ins" AFTER INSERT ON "StockMovement" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('StockMovement', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "StockMovement_sync_upd" AFTER UPDATE ON "StockMovement" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('StockMovement', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SerialUnit_sync_ins" AFTER INSERT ON "SerialUnit" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SerialUnit', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "SerialUnit_sync_upd" AFTER UPDATE ON "SerialUnit" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('SerialUnit', NEW."id", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "CategoryAttribute_sync_ins" AFTER INSERT ON "CategoryAttribute" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('CategoryAttribute', NEW."categoryId" || '|' || NEW."attributeId", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "CategoryAttribute_sync_del" AFTER DELETE ON "CategoryAttribute" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('CategoryAttribute', OLD."categoryId" || '|' || OLD."attributeId", 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "ProductAttributeValue_sync_ins" AFTER INSERT ON "ProductAttributeValue" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('ProductAttributeValue', NEW."productId" || '|' || NEW."attributeId", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "ProductAttributeValue_sync_del" AFTER DELETE ON "ProductAttributeValue" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('ProductAttributeValue', OLD."productId" || '|' || OLD."attributeId", 'delete', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Setting_sync_ins" AFTER INSERT ON "Setting" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0 AND NEW."key" = 'stock.settings'
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Setting', NEW."key", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
CREATE TRIGGER "Setting_sync_upd" AFTER UPDATE ON "Setting" WHEN (SELECT "applying" FROM "SyncFlag" WHERE "id" = 1) = 0 AND NEW."key" = 'stock.settings'
BEGIN INSERT INTO "ChangeLog" ("tableName","rowKey","op","at") VALUES ('Setting', NEW."key", 'upsert', strftime('%Y-%m-%dT%H:%M:%fZ','now')); END;
