-- A short form for each branch, shown in the work-schedule grid when someone is
-- sent to a branch other than their own — "TRD", "Km11", "Pan".

-- Written by hand only because `migrate dev` insists on confirming the unique
-- index interactively. The warning it wants confirmed is about existing
-- duplicates, and the column is new and entirely NULL, so there are none.
ALTER TABLE "Branch" ADD COLUMN "abbreviation" TEXT;

-- Unique so the grid cannot show one short form meaning two branches. Many NULLs
-- are allowed by a Postgres unique index, so branches without one are unaffected.
CREATE UNIQUE INDEX "Branch_abbreviation_key" ON "Branch"("abbreviation");
