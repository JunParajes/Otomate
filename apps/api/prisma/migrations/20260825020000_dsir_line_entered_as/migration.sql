-- Records how a figure was counted, where it was counted rather than typed:
-- {"endBal": "4*5+3*4"} means that 32 came from a 4x5 layer under a 3x4 one.
--
-- Nullable with no backfill on purpose. Figures already in the database were
-- entered before anything recorded this, and inventing an expression for them
-- would be fabricating a count breakdown that nobody actually performed.
ALTER TABLE "DsirLine" ADD COLUMN "enteredAs" JSONB;
