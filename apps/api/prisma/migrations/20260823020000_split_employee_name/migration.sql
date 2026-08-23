-- Split Employee.name into firstName / middleName / lastName / suffix.
--
-- Written by hand rather than generated: the generated version drops `name`
-- and adds NOT NULL columns, which throws the existing records away.
--
-- The backfill is a best effort and is only asked to be sensible, not perfect.
-- A stored full name genuinely does not contain enough information to recover
-- the parts — "Juan Miguel Dela Cruz" could be a two-word given name or a
-- two-word surname, and nothing in the string says which. That ambiguity is
-- the reason the parts are captured separately from here on.
--
-- What it does handle, because getting it wrong is worse than useless:
--   * a trailing generational suffix. "Ethelredo Parajes Jr" must not end up
--     with a surname of "Jr" — that is the one real record in production.
--   * runs of whitespace, so "Maria  Santos" does not produce an empty token.
--   * a single-token name, which becomes the surname with an empty given name,
--     so the gap is visible and the form makes someone fill it in.
--
-- Middle names are deliberately left NULL. Guessing that the middle token of a
-- three-part name is a middle name rather than part of a compound surname would
-- be wrong more often than right here.

ALTER TABLE "Employee" ADD COLUMN "firstName"  TEXT;
ALTER TABLE "Employee" ADD COLUMN "middleName" TEXT;
ALTER TABLE "Employee" ADD COLUMN "lastName"   TEXT;
ALTER TABLE "Employee" ADD COLUMN "suffix"     TEXT;

WITH normalised AS (
  SELECT
    id,
    regexp_replace(btrim("name"), '\s+', ' ', 'g') AS whole
  FROM "Employee"
),
split_suffix AS (
  SELECT
    id,
    CASE
      WHEN whole ~* '\s(jr|sr|ii|iii|iv|v)\.?$'
        THEN btrim(regexp_replace(whole, '\s(jr|sr|ii|iii|iv|v)\.?$', '', 'i'))
      ELSE whole
    END AS base,
    CASE
      WHEN whole ~* '\s(jr|sr|ii|iii|iv|v)\.?$'
        THEN (regexp_match(whole, '\s((?:jr|sr|ii|iii|iv|v)\.?)$', 'i'))[1]
      ELSE NULL
    END AS suffix
  FROM normalised
),
parts AS (
  SELECT
    id,
    suffix,
    string_to_array(base, ' ') AS tokens
  FROM split_suffix
)
UPDATE "Employee" e
SET
  "suffix"    = p.suffix,
  "lastName"  = p.tokens[array_length(p.tokens, 1)],
  "firstName" = CASE
                  WHEN array_length(p.tokens, 1) > 1
                    THEN array_to_string(p.tokens[1:array_length(p.tokens, 1) - 1], ' ')
                  ELSE ''
                END
FROM parts p
WHERE e.id = p.id;

-- Any row the backfill could not read at all (an empty name) still has to
-- satisfy NOT NULL. Left blank rather than invented, so it shows up as
-- incomplete instead of quietly wrong.
UPDATE "Employee" SET "firstName" = '' WHERE "firstName" IS NULL;
UPDATE "Employee" SET "lastName"  = '' WHERE "lastName"  IS NULL;

ALTER TABLE "Employee" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "Employee" ALTER COLUMN "lastName"  SET NOT NULL;

ALTER TABLE "Employee" DROP COLUMN "name";

CREATE INDEX "Employee_lastName_firstName_idx" ON "Employee"("lastName", "firstName");
