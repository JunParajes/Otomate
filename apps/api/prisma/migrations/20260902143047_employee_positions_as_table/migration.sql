-- Employee positions become rows instead of a Prisma enum.
--
-- Written by hand rather than generated, for one reason that bites hard if
-- missed: in Postgres a table and a type share one namespace, and the enum is
-- already called "EmployeePosition". The enum must therefore be gone before the
-- table of the same name is created — so the existing values are first parked in
-- a text column, the enum dropped, and only then is the table built and the
-- column re-pointed at it.
--
-- Non-destructive in effect: every employee keeps the position they had.

-- 1. Park the current value as text.
ALTER TABLE "Employee" ADD COLUMN "positionName" TEXT;
UPDATE "Employee" SET "positionName" = initcap("position"::text);

-- 2. Retire the enum, freeing the name.
ALTER TABLE "Employee" DROP COLUMN "position";
DROP TYPE "EmployeePosition";

-- 3. The table.
CREATE TABLE "EmployeePosition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmployeePosition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmployeePosition_name_key" ON "EmployeePosition"("name");

-- 4. The seven values that existed, in the order they were declared.
INSERT INTO "EmployeePosition" ("id", "name", "sortOrder", "updatedAt") VALUES
    ('pos_seed_manager',    'Manager',    0, CURRENT_TIMESTAMP),
    ('pos_seed_baker',      'Baker',      1, CURRENT_TIMESTAMP),
    ('pos_seed_frontliner', 'Frontliner', 2, CURRENT_TIMESTAMP),
    ('pos_seed_cashier',    'Cashier',    3, CURRENT_TIMESTAMP),
    ('pos_seed_helper',     'Helper',     4, CURRENT_TIMESTAMP),
    ('pos_seed_driver',     'Driver',     5, CURRENT_TIMESTAMP),
    ('pos_seed_other',      'Other',      6, CURRENT_TIMESTAMP);

-- 5. Re-point the employees. Anything unrecognised falls back to Other rather
--    than failing the migration and leaving the deploy half-applied.
ALTER TABLE "Employee" ADD COLUMN "positionId" TEXT;
UPDATE "Employee" e
   SET "positionId" = COALESCE(
       (SELECT p."id" FROM "EmployeePosition" p WHERE p."name" = e."positionName"),
       'pos_seed_other'
   );
ALTER TABLE "Employee" ALTER COLUMN "positionId" SET NOT NULL;
ALTER TABLE "Employee" DROP COLUMN "positionName";

-- 6. RESTRICT, like Product.categoryId: a position somebody still holds cannot
--    be deleted out from under them.
ALTER TABLE "Employee"
    ADD CONSTRAINT "Employee_positionId_fkey"
    FOREIGN KEY ("positionId") REFERENCES "EmployeePosition"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
