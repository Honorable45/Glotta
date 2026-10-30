-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "debtId" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "note" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PLANNED',
    "openedAt" TEXT,
    "doneAt" TEXT,
    "createdAt" TEXT NOT NULL,
    CONSTRAINT "Reminder_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "Debt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Reminder_state_dueDate_idx" ON "Reminder"("state", "dueDate");

