-- CreateTable
CREATE TABLE "WorkScheduleBranchPlan" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "plannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plannedById" TEXT,

    CONSTRAINT "WorkScheduleBranchPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkScheduleBranchPlan_scheduleId_branchId_key" ON "WorkScheduleBranchPlan"("scheduleId", "branchId");

-- AddForeignKey
ALTER TABLE "WorkScheduleBranchPlan" ADD CONSTRAINT "WorkScheduleBranchPlan_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleBranchPlan" ADD CONSTRAINT "WorkScheduleBranchPlan_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkScheduleBranchPlan" ADD CONSTRAINT "WorkScheduleBranchPlan_plannedById_fkey" FOREIGN KEY ("plannedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
