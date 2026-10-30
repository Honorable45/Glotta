-- CreateTable
CREATE TABLE "SyncEnvelope" (
    "seq" BIGSERIAL NOT NULL,
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncEnvelope_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncEnvelope_id_key" ON "SyncEnvelope"("id");

-- CreateIndex
CREATE INDEX "SyncEnvelope_tenantId_seq_idx" ON "SyncEnvelope"("tenantId", "seq");

