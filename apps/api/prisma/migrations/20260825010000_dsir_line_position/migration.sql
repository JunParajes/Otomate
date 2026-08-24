-- Records the order the encoder arranged lines in.
--
-- Row order was previously whatever Postgres happened to return: undefined, and
-- liable to shift because saving rewrites every line. Sorting a report back to
-- "the order I entered them" was therefore impossible.
--
-- Existing rows are numbered by product sort order then name, which is the
-- catalogue order the form was seeded in and mirrors the printed sheet — the
-- closest thing to the original arrangement that can be reconstructed.
ALTER TABLE "DsirLine" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT l.id,
         row_number() OVER (
           PARTITION BY l."reportId"
           ORDER BY p."sortOrder", p.name
         ) - 1 AS seq
  FROM "DsirLine" l
  JOIN "Product" p ON p.id = l."productId"
)
UPDATE "DsirLine" l
SET "position" = ordered.seq
FROM ordered
WHERE l.id = ordered.id;

CREATE INDEX "DsirLine_reportId_position_idx" ON "DsirLine"("reportId", "position");
