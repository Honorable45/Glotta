-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "comment" TEXT,
    "userId" TEXT,
    "voidedAt" TEXT,
    "voidReason" TEXT,
    "paidFromCash" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Expense" ("amount", "categoryId", "comment", "createdAt", "date", "id", "label", "userId", "voidReason", "voidedAt") SELECT "amount", "categoryId", "comment", "createdAt", "date", "id", "label", "userId", "voidReason", "voidedAt" FROM "Expense";
DROP TABLE "Expense";
ALTER TABLE "new_Expense" RENAME TO "Expense";
CREATE INDEX "Expense_date_idx" ON "Expense"("date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

