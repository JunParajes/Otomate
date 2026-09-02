-- CreateEnum
CREATE TYPE "WorkDayStatus" AS ENUM ('SCHEDULED', 'NOT_SCHEDULED', 'OFF', 'FRONTLINE', 'OPENER');

-- CreateEnum
CREATE TYPE "WorkScheduleStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "homeArea" TEXT;

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "WorkScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkScheduleEntry" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "status" "WorkDayStatus" NOT NULL DEFAULT 'SCHEDULED',
    "assignedBranchId" TEXT,
    "coveredById" TEXT,
    "pairedWithId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkScheduleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkSchedule_weekStart_key" ON "WorkSchedule"("weekStart");

-- CreateIndex
CREATE INDEX "WorkScheduleEntry_scheduleId_day_idx" ON "WorkScheduleEntry"("scheduleId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "WorkScheduleEntry_scheduleId_employeeId_day_key" ON "WorkScheduleEntry"("scheduleId", "employeeId", "day");

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSchedule" ADD CONSTRAINT "WorkSchedule_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleEntry" ADD CONSTRAINT "WorkScheduleEntry_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleEntry" ADD CONSTRAINT "WorkScheduleEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleEntry" ADD CONSTRAINT "WorkScheduleEntry_assignedBranchId_fkey" FOREIGN KEY ("assignedBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleEntry" ADD CONSTRAINT "WorkScheduleEntry_coveredById_fkey" FOREIGN KEY ("coveredById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleEntry" ADD CONSTRAINT "WorkScheduleEntry_pairedWithId_fkey" FOREIGN KEY ("pairedWithId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
