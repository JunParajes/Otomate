-- Employee contact numbers become a table.
--
-- Dual-SIM is normal, and which network a number is on decides who can reach
-- someone when one has no signal. A second column would need a third the first
-- time an employee carries three, and neither could say which network.
--
-- ORDER MATTERS HERE. Prisma generated this migration with the DROP COLUMN
-- first, which would have thrown away every number already recorded. Create the
-- table, copy the values across, and only then drop the old column.

-- CreateTable
CREATE TABLE "EmployeeContact" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "label" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeContact_employeeId_sortOrder_idx" ON "EmployeeContact"("employeeId", "sortOrder");

-- AddForeignKey
ALTER TABLE "EmployeeContact" ADD CONSTRAINT "EmployeeContact_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry every existing number over. The id is generated here rather than by the
-- application because this runs before any application code sees the table;
-- md5-of-random is not a cuid, but nothing parses these ids, and the alternative
-- is losing the data.
INSERT INTO "EmployeeContact" ("id", "employeeId", "number", "label", "sortOrder", "createdAt", "updatedAt")
SELECT
  'mig_' || md5(random()::text || clock_timestamp()::text),
  "id",
  trim("contactNumber"),
  NULL,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Employee"
WHERE "contactNumber" IS NOT NULL AND trim("contactNumber") <> '';

-- AlterTable — only now that the values are safely copied.
ALTER TABLE "Employee" DROP COLUMN "contactNumber";
