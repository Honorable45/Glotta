-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "archivedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "comment" TEXT,
    "userId" TEXT,
    "voidedAt" TEXT,
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "openingFloat" BIGINT NOT NULL,
    "openedAt" TEXT NOT NULL,
    "closedAt" TEXT,
    "expected" BIGINT,
    "counted" BIGINT,
    "note" TEXT,
    "userId" TEXT
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "occurredAt" TEXT NOT NULL,
    CONSTRAINT "CashMovement_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CashSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "overrides" TEXT NOT NULL DEFAULT '{}',
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PaymentMethod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isCash" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_PaymentMethod" ("id", "isActive", "name", "position") SELECT "id", "isActive", "name", "position" FROM "PaymentMethod";
DROP TABLE "PaymentMethod";
ALTER TABLE "new_PaymentMethod" RENAME TO "PaymentMethod";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "CashSession_closedAt_idx" ON "CashSession"("closedAt");

-- CreateIndex
CREATE INDEX "CashMovement_sessionId_idx" ON "CashMovement"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");


CREATE TRIGGER "CashMovement_no_update" BEFORE UPDATE ON "CashMovement"
BEGIN SELECT RAISE(ABORT, 'CashMovement est en ajout seul'); END;
CREATE TRIGGER "CashMovement_no_delete" BEFORE DELETE ON "CashMovement"
BEGIN SELECT RAISE(ABORT, 'CashMovement est en ajout seul'); END;

UPDATE "PaymentMethod" SET "isCash" = 1 WHERE "name" = 'Espèces';

INSERT INTO "ExpenseCategory" ("id", "name") VALUES
  ('expense-rent', 'Loyer'),
  ('expense-power', 'Électricité'),
  ('expense-transport', 'Transport'),
  ('expense-salaries', 'Salaires'),
  ('expense-misc', 'Achats divers');
