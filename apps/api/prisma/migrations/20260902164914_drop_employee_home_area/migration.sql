-- Drops Employee.homeArea.

-- It was added one day earlier for the "Home" column on the work schedule grid,
-- and that column is gone: the manager now opens the employee's details from the
-- grid instead, which shows the real address from the 201 file rather than a
-- second, shorter, separately-maintained one.
--
-- Safe to drop outright: the column was never deployed to production and never
-- populated anywhere. Two places holding a person's home address is a worse
-- problem than a missing column.
ALTER TABLE "Employee" DROP COLUMN "homeArea";
