-- Freeze what a finalised report RECEIVED from other branches.
--
-- Inbound stock is entered once by the sender and read live by the receiver.
-- That is right for drafts — asking both branches to type the same movement is
-- how they come to disagree — but it means a FINALISED report is not actually
-- final: editing the sender moves the receiver's available stock, its derived
-- sales, and therefore its variance. Variance is deducted from a cashier's
-- wages (docs/DOMAIN.md).
--
-- Measured before this migration, on a report already closed:
--   Branch B finalised at 80 sold / PHP 240.00
--   Branch A's transfer to B edited from 20 units to 5
--   Branch B, still FINALIZED, then read 65 sold / PHP 195.00
--
-- CreateTable
CREATE TABLE "DsirInboundSnapshot" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DsirInboundSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DsirInboundSnapshot_reportId_idx" ON "DsirInboundSnapshot"("reportId");

-- AddForeignKey
ALTER TABLE "DsirInboundSnapshot" ADD CONSTRAINT "DsirInboundSnapshot_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DsirReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirInboundSnapshot" ADD CONSTRAINT "DsirInboundSnapshot_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsirInboundSnapshot" ADD CONSTRAINT "DsirInboundSnapshot_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill every report already finalised, freezing it at what it reads TODAY.
--
-- This does not recover a report that has already drifted — that history is
-- gone, and inventing a "correct" figure would be worse than keeping the one
-- the business has been working from. What it does is stop the drift here.
INSERT INTO "DsirInboundSnapshot" ("id", "reportId", "productId", "fromBranchId", "quantity", "createdAt")
SELECT
  'bf_' || md5(random()::text || clock_timestamp()::text || t."id"),
  receiver."id",
  t."productId",
  sender."branchId",
  t."quantity",
  CURRENT_TIMESTAMP
FROM "DsirReport" receiver
JOIN "DsirTransfer" t ON t."toBranchId" = receiver."branchId"
JOIN "DsirReport" sender ON sender."id" = t."reportId"
                        AND sender."reportDate" = receiver."reportDate"
WHERE receiver."status" = 'FINALIZED';
