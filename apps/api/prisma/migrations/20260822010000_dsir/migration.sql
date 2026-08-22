-- CreateEnum
CREATE TYPE "DsirStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateTable
CREATE TABLE "DsirReport" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "status" "DsirStatus" NOT NULL DEFAULT 'DRAFT',
    "usesCharges" BOOLEAN NOT NULL DEFAULT false,
    "usesPullOuts" BOOLEAN NOT NULL DEFAULT false,
    "usesTransfers" BOOLEAN NOT NULL DEFAULT false,
    "usesOverEnd" BOOLEAN NOT NULL DEFAULT false,
    "openedById" TEXT,
    "closedById" TEXT,
    "encodedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DsirReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsirLine" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "begBal" INTEGER NOT NULL DEFAULT 0,
    "produced" INTEGER NOT NULL DEFAULT 0,
    "overEnd" INTEGER NOT NULL DEFAULT 0,
    "pulledOut" INTEGER NOT NULL DEFAULT 0,
    "endBal" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DsirLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsirCharge" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "DsirCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsirTransfer" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "toBranchId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "DsirTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsirCollection" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "employeeId" TEXT,
    "label" TEXT,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "DsirCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DsirReport_reportDate_idx" ON "DsirReport"("reportDate");

-- CreateIndex
CREATE INDEX "DsirReport_status_idx" ON "DsirReport"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DsirReport_branchId_reportDate_key" ON "DsirReport"("branchId", "reportDate");

-- CreateIndex
CREATE INDEX "DsirLine_productId_idx" ON "DsirLine"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "DsirLine_reportId_productId_key" ON "DsirLine"("reportId", "productId");

-- CreateIndex
CREATE INDEX "DsirCharge_reportId_idx" ON "DsirCharge"("reportId");

-- CreateIndex
CREATE INDEX "DsirCharge_employeeId_idx" ON "DsirCharge"("employeeId");

-- CreateIndex
CREATE INDEX "DsirTransfer_reportId_idx" ON "DsirTransfer"("reportId");

-- CreateIndex
CREATE INDEX "DsirCollection_reportId_idx" ON "DsirCollection"("reportId");

-- AddForeignKey
ALTER TABLE "DsirReport" ADD CONSTRAINT "DsirReport_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirReport" ADD CONSTRAINT "DsirReport_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirReport" ADD CONSTRAINT "DsirReport_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirReport" ADD CONSTRAINT "DsirReport_encodedById_fkey" FOREIGN KEY ("encodedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirLine" ADD CONSTRAINT "DsirLine_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DsirReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirLine" ADD CONSTRAINT "DsirLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirCharge" ADD CONSTRAINT "DsirCharge_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DsirReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirCharge" ADD CONSTRAINT "DsirCharge_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirCharge" ADD CONSTRAINT "DsirCharge_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirTransfer" ADD CONSTRAINT "DsirTransfer_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DsirReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirTransfer" ADD CONSTRAINT "DsirTransfer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirTransfer" ADD CONSTRAINT "DsirTransfer_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirCollection" ADD CONSTRAINT "DsirCollection_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DsirReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirCollection" ADD CONSTRAINT "DsirCollection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

