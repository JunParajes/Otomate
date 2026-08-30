-- CreateEnum
CREATE TYPE "UtilityType" AS ENUM ('ELECTRIC', 'WATER', 'INTERNET', 'OTHER');

-- CreateTable
CREATE TABLE "BranchUtilityAccount" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "UtilityType" NOT NULL,
    "label" TEXT,
    "provider" TEXT,
    "accountNumber" TEXT,
    "meterNumber" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchUtilityAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchUtilityBill" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dueDate" DATE,
    "paidOn" DATE,
    "consumption" INTEGER,
    "referenceNo" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchUtilityBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchUtilityAccount_branchId_idx" ON "BranchUtilityAccount"("branchId");

-- CreateIndex
CREATE INDEX "BranchUtilityBill_accountId_periodStart_idx" ON "BranchUtilityBill"("accountId", "periodStart");

-- CreateIndex
CREATE INDEX "BranchUtilityBill_dueDate_idx" ON "BranchUtilityBill"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "BranchUtilityBill_accountId_periodStart_key" ON "BranchUtilityBill"("accountId", "periodStart");

-- AddForeignKey
ALTER TABLE "BranchUtilityAccount" ADD CONSTRAINT "BranchUtilityAccount_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchUtilityBill" ADD CONSTRAINT "BranchUtilityBill_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BranchUtilityAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
