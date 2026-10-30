-- Passage à la licence à vie : aucune donnée de production n'existait avec le modèle abonnement.
TRUNCATE "SupportTicket", "SyncEnvelope", "PlatformSetting";

-- DropForeignKey
ALTER TABLE "TenantDevice" DROP CONSTRAINT "TenantDevice_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "SubscriptionEvent" DROP CONSTRAINT "SubscriptionEvent_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentIntent" DROP CONSTRAINT "PaymentIntent_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "SupportTicket" DROP CONSTRAINT "SupportTicket_tenantId_fkey";

-- DropIndex
DROP INDEX "SyncEnvelope_tenantId_seq_idx";

-- AlterTable
ALTER TABLE "PlatformSetting" ALTER COLUMN "value" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "SupportTicket" DROP COLUMN "tenantId",
ADD COLUMN     "customerId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'ADMIN';

-- AlterTable
ALTER TABLE "SyncEnvelope" DROP COLUMN "deviceId",
DROP COLUMN "tenantId",
ADD COLUMN     "activationId" TEXT NOT NULL,
ADD COLUMN     "licenseId" TEXT NOT NULL;

-- DropTable
DROP TABLE "Plan";

-- DropTable
DROP TABLE "Tenant";

-- DropTable
DROP TABLE "TenantDevice";

-- DropTable
DROP TABLE "Subscription";

-- DropTable
DROP TABLE "SubscriptionEvent";

-- DropTable
DROP TABLE "PaymentIntent";

-- CreateTable
CREATE TABLE "Edition" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL,
    "maxUsers" INTEGER NOT NULL,
    "maxStores" INTEGER NOT NULL,
    "maxDevices" INTEGER NOT NULL DEFAULT 1,
    "features" TEXT[],
    "majorVersion" INTEGER NOT NULL DEFAULT 1,
    "syncQuotaMb" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Edition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyEncrypted" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "editionCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "statusReason" TEXT,
    "isTrial" BOOLEAN NOT NULL DEFAULT false,
    "trialEndsAt" TIMESTAMP(3),
    "editionName" TEXT NOT NULL,
    "features" TEXT[],
    "maxUsers" INTEGER NOT NULL,
    "maxStores" INTEGER NOT NULL,
    "maxDevices" INTEGER NOT NULL,
    "syncQuotaMb" INTEGER NOT NULL,
    "maxMajorVersion" INTEGER NOT NULL,
    "syncBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseEvent" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "actor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activation" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "deviceFingerprint" TEXT NOT NULL,
    "devicePublicKey" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "editionCode" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NEW',
    "targetMajor" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "paidAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_name_idx" ON "Customer"("name");

-- CreateIndex
CREATE UNIQUE INDEX "License_keyHash_key" ON "License"("keyHash");

-- CreateIndex
CREATE INDEX "License_customerId_idx" ON "License"("customerId");

-- CreateIndex
CREATE INDEX "License_status_idx" ON "License"("status");

-- CreateIndex
CREATE INDEX "LicenseEvent_licenseId_idx" ON "LicenseEvent"("licenseId");

-- CreateIndex
CREATE INDEX "Activation_licenseId_idx" ON "Activation"("licenseId");

-- CreateIndex
CREATE UNIQUE INDEX "Activation_licenseId_deviceFingerprint_key" ON "Activation"("licenseId", "deviceFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_number_key" ON "Sale"("number");

-- CreateIndex
CREATE INDEX "Sale_status_idx" ON "Sale"("status");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "SyncEnvelope_licenseId_seq_idx" ON "SyncEnvelope"("licenseId", "seq");

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_editionCode_fkey" FOREIGN KEY ("editionCode") REFERENCES "Edition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseEvent" ADD CONSTRAINT "LicenseEvent_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activation" ADD CONSTRAINT "Activation_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_editionCode_fkey" FOREIGN KEY ("editionCode") REFERENCES "Edition"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "License"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Historiques en ajout seul : ni modification ni suppression, même depuis l'application.
CREATE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Historique en ajout seul';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LicenseEvent_append_only" BEFORE UPDATE OR DELETE ON "LicenseEvent" FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER "AdminAuditLog_append_only" BEFORE UPDATE OR DELETE ON "AdminAuditLog" FOR EACH ROW EXECUTE FUNCTION forbid_change();

INSERT INTO "PlatformSetting" ("key", "value") VALUES ('trialDays', '14');
-- Les administrateurs créés avant les rôles restent propriétaires de la plateforme.
UPDATE "PlatformAdmin" SET "role" = 'OWNER';
