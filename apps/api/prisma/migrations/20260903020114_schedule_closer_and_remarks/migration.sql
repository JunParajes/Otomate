-- AlterEnum
ALTER TYPE "WorkDayStatus" ADD VALUE 'CLOSER';

-- AlterTable
ALTER TABLE "WorkScheduleEntry" ADD COLUMN     "remarks" TEXT;
