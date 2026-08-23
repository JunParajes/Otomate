-- Marks an opening balance as the opener's own recount rather than the figure
-- carried forward from the previous finalised report.
--
-- New lines default to false, meaning "carried": their opening tracks the
-- previous finalised report while the day is still a draft.
--
-- Existing rows are set to TRUE instead. Every opening already in the database
-- was typed or prefilled under the old free-form rules, and marking them as
-- carried would let the new live carry overwrite figures a person entered —
-- silently changing counts on reports that may already be finalised and acted
-- on. Treating history as hand-entered leaves it exactly as it is.
ALTER TABLE "DsirLine" ADD COLUMN "begBalRecounted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "DsirLine" SET "begBalRecounted" = true;
