-- HR: the 201 file, plus pay as effective-dated history.
--
-- Additive to Employee. Every new column is nullable or carries a default, so
-- existing staff records stay valid with the HR section simply empty.
--
-- EmployeeSalary is a TABLE rather than columns on Employee on purpose: a raise
-- must not rewrite history. Payroll for January has to keep January's rate after
-- a March increase, the same way `unitPriceCents` is snapshotted onto DsirLine.
-- Which rate applies is decided by date — the greatest `effectiveFrom` not after
-- the date in question — so there is no `isCurrent` flag to drift out of sync,
-- and a raise can be entered before it takes effect.
--
-- NOTE on the two unrelated DROP DEFAULT lines below: `Branch.updatedAt` and
-- `Role.updatedAt` were given DEFAULT CURRENT_TIMESTAMP by 20260821000000_admin_crud
-- purely so ADD COLUMN ... NOT NULL could backfill rows that already existed.
-- That migration's own note says the default is never relied on afterwards —
-- Prisma's @updatedAt sets the value on every write. Prisma now reconciles the
-- schema by dropping them. Harmless, and left in rather than stripped: removing
-- them would leave drift that regenerates itself into every future migration.

-- CreateEnum
CREATE TYPE "CivilStatus" AS ENUM ('SINGLE', 'MARRIED', 'WIDOWED', 'SEPARATED');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('PROBATIONARY', 'REGULAR', 'CONTRACTUAL', 'PART_TIME');

-- CreateEnum
CREATE TYPE "SalaryRateType" AS ENUM ('DAILY', 'MONTHLY', 'HOURLY');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('CASH', 'BANK', 'EWALLET');

-- AlterTable
ALTER TABLE "Branch" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "address" TEXT,
ADD COLUMN     "birthDate" DATE,
ADD COLUMN     "civilStatus" "CivilStatus",
ADD COLUMN     "contactNumber" TEXT,
ADD COLUMN     "dateHired" DATE,
ADD COLUMN     "emergencyContact" TEXT,
ADD COLUMN     "emergencyName" TEXT,
ADD COLUMN     "emergencyRelation" TEXT,
ADD COLUMN     "employmentType" "EmploymentType" NOT NULL DEFAULT 'PROBATIONARY',
ADD COLUMN     "pagibigNumber" TEXT,
ADD COLUMN     "payoutAccount" TEXT,
ADD COLUMN     "payoutMethod" "PayoutMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "philhealthNumber" TEXT,
ADD COLUMN     "probationEndDate" DATE,
ADD COLUMN     "regularizedAt" DATE,
ADD COLUMN     "separatedAt" DATE,
ADD COLUMN     "separationReason" TEXT,
ADD COLUMN     "sssNumber" TEXT,
ADD COLUMN     "tin" TEXT;

-- AlterTable
ALTER TABLE "Role" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "EmployeeSalary" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "basicCents" INTEGER NOT NULL,
    "allowanceCents" INTEGER NOT NULL DEFAULT 0,
    "rateType" "SalaryRateType" NOT NULL DEFAULT 'DAILY',
    "effectiveFrom" DATE NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeSalary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeSalary_employeeId_effectiveFrom_idx" ON "EmployeeSalary"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSalary_employeeId_effectiveFrom_key" ON "EmployeeSalary"("employeeId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "EmployeeSalary" ADD CONSTRAINT "EmployeeSalary_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeSalary" ADD CONSTRAINT "EmployeeSalary_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
