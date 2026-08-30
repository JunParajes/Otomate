-- CreateEnum
CREATE TYPE "PermitType" AS ENUM ('MAYORS_PERMIT', 'BARANGAY_CLEARANCE', 'BIR_REGISTRATION', 'SANITARY_PERMIT', 'FIRE_SAFETY', 'OCCUPANCY_PERMIT', 'ZONING_CLEARANCE', 'ENVIRONMENTAL', 'OTHER');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "address" TEXT,
ADD COLUMN     "advanceCents" INTEGER,
ADD COLUMN     "contractEnd" DATE,
ADD COLUMN     "contractFile" TEXT,
ADD COLUMN     "contractStart" DATE,
ADD COLUMN     "depositCents" INTEGER,
ADD COLUMN     "lessorAddress" TEXT,
ADD COLUMN     "lessorContact" TEXT,
ADD COLUMN     "lessorName" TEXT,
ADD COLUMN     "renewalNoticeDays" INTEGER;

-- CreateTable
CREATE TABLE "BranchPermit" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" "PermitType" NOT NULL,
    "label" TEXT,
    "number" TEXT,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "authority" TEXT,
    "note" TEXT,
    "documentFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchPermit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchRent" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchRent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchPermit_branchId_idx" ON "BranchPermit"("branchId");

-- CreateIndex
CREATE INDEX "BranchPermit_expiresOn_idx" ON "BranchPermit"("expiresOn");

-- CreateIndex
CREATE INDEX "BranchRent_branchId_effectiveFrom_idx" ON "BranchRent"("branchId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BranchRent_branchId_effectiveFrom_key" ON "BranchRent"("branchId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "BranchPermit" ADD CONSTRAINT "BranchPermit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchRent" ADD CONSTRAINT "BranchRent_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchRent" ADD CONSTRAINT "BranchRent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
