-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "reference" TEXT,
    "categoryId" TEXT,
    "unitId" TEXT NOT NULL,
    "taxRateBp" INTEGER NOT NULL DEFAULT 0,
    "trackSerial" BOOLEAN NOT NULL DEFAULT false,
    "lowStockThreshold" BIGINT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "sku" TEXT,
    "barcode" TEXT,
    "purchasePrice" BIGINT NOT NULL,
    "salePrice" BIGINT NOT NULL,
    "archivedAt" DATETIME,
    CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductAttributeValue" (
    "productId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    PRIMARY KEY ("productId", "attributeId"),
    CONSTRAINT "ProductAttributeValue_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "AttributeDefinition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "variantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY ("variantId", "storeId"),
    CONSTRAINT "StockLevel_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "unitCost" BIGINT,
    "reason" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "userId" TEXT,
    "occurredAt" TEXT NOT NULL,
    CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SerialUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "variantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_STOCK',
    "saleLineId" TEXT,
    CONSTRAINT "SerialUnit_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SerialUnit_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryCount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "startedAt" TEXT NOT NULL,
    "closedAt" TEXT
);

-- CreateTable
CREATE TABLE "InventoryCountLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "countId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "expected" BIGINT NOT NULL,
    "counted" BIGINT,
    CONSTRAINT "InventoryCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "InventoryCount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "phone" TEXT,
    "whatsapp" TEXT,
    "address" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "customerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "subtotal" BIGINT NOT NULL,
    "discount" BIGINT NOT NULL,
    "tax" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "netTotal" BIGINT NOT NULL,
    "netPaid" BIGINT NOT NULL,
    "userId" TEXT,
    "occurredAt" TEXT NOT NULL,
    "cancelReason" TEXT,
    CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaleLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantLabel" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "unitPrice" BIGINT NOT NULL,
    "unitCost" BIGINT NOT NULL,
    "lineDiscount" BIGINT NOT NULL,
    "cartDiscount" BIGINT NOT NULL,
    "taxRateBp" INTEGER NOT NULL,
    "tax" BIGINT NOT NULL,
    "lineTotal" BIGINT NOT NULL,
    CONSTRAINT "SaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "methodName" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "returnId" TEXT,
    "userId" TEXT,
    "occurredAt" TEXT NOT NULL,
    CONSTRAINT "SalePayment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaleReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "refund" BIGINT NOT NULL,
    "userId" TEXT,
    "occurredAt" TEXT NOT NULL,
    CONSTRAINT "SaleReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SaleReturnLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "returnId" TEXT NOT NULL,
    "saleLineId" TEXT NOT NULL,
    "quantity" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "restock" BOOLEAN NOT NULL,
    CONSTRAINT "SaleReturnLine_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "SaleReturn" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SaleReturnLine_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Debt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "saleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "dueDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Debt_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Debt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Product_searchText_idx" ON "Product"("searchText");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_barcode_key" ON "ProductVariant"("barcode");

-- CreateIndex
CREATE INDEX "StockMovement_variantId_occurredAt_idx" ON "StockMovement"("variantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SerialUnit_serial_key" ON "SerialUnit"("serial");

-- CreateIndex
CREATE INDEX "SerialUnit_variantId_status_idx" ON "SerialUnit"("variantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCountLine_countId_variantId_key" ON "InventoryCountLine"("countId", "variantId");

-- CreateIndex
CREATE INDEX "Customer_searchText_idx" ON "Customer"("searchText");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_number_key" ON "Sale"("number");

-- CreateIndex
CREATE INDEX "Sale_occurredAt_idx" ON "Sale"("occurredAt");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE INDEX "SaleLine_saleId_idx" ON "SaleLine"("saleId");

-- CreateIndex
CREATE INDEX "SalePayment_saleId_idx" ON "SalePayment"("saleId");

-- CreateIndex
CREATE INDEX "SalePayment_occurredAt_idx" ON "SalePayment"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Debt_saleId_key" ON "Debt"("saleId");


-- Historiques financiers et de stock : en ajout seul.
CREATE TRIGGER "StockMovement_no_update" BEFORE UPDATE ON "StockMovement"
BEGIN SELECT RAISE(ABORT, 'StockMovement est en ajout seul'); END;
CREATE TRIGGER "StockMovement_no_delete" BEFORE DELETE ON "StockMovement"
BEGIN SELECT RAISE(ABORT, 'StockMovement est en ajout seul'); END;
CREATE TRIGGER "SalePayment_no_update" BEFORE UPDATE ON "SalePayment"
BEGIN SELECT RAISE(ABORT, 'SalePayment est en ajout seul'); END;
CREATE TRIGGER "SalePayment_no_delete" BEFORE DELETE ON "SalePayment"
BEGIN SELECT RAISE(ABORT, 'SalePayment est en ajout seul'); END;
CREATE TRIGGER "Sale_no_delete" BEFORE DELETE ON "Sale"
BEGIN SELECT RAISE(ABORT, 'Une vente ne peut pas être supprimée'); END;
CREATE TRIGGER "SaleLine_no_delete" BEFORE DELETE ON "SaleLine"
BEGIN SELECT RAISE(ABORT, 'Une ligne de vente ne peut pas être supprimée'); END;
