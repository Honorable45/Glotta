-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id" TEXT NOT NULL,
    "occurredAt" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "occurredAt" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "sentAt" DATETIME,
    "attempts" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_id_key" ON "AuditLog"("id");

-- CreateIndex
CREATE INDEX "OutboxEvent_sentAt_idx" ON "OutboxEvent"("sentAt");


-- Le journal d'activité ne peut être ni modifié ni supprimé.
CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog est en ajout seul'); END;

CREATE TRIGGER "AuditLog_no_delete" BEFORE DELETE ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'AuditLog est en ajout seul'); END;
