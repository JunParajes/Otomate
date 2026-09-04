-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('MISSING', 'ON_FILE', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "authorityToDeduct" "DocumentStatus" NOT NULL DEFAULT 'MISSING',
ADD COLUMN     "birthCertificate" "DocumentStatus" NOT NULL DEFAULT 'MISSING',
ADD COLUMN     "confidentialityAgreement" "DocumentStatus" NOT NULL DEFAULT 'MISSING',
ADD COLUMN     "marriageContract" "DocumentStatus" NOT NULL DEFAULT 'MISSING';

-- Backfill. Until now a date WAS the record that a document is on file, so
-- anyone carrying one has it — defaulting them to MISSING would quietly claim
-- we had lost paperwork that is sitting in the folder.
--
-- The reverse does not hold: a null date meant "not on file", which is exactly
-- MISSING, so those rows are already correct by the default above. Nothing is
-- set to NOT_APPLICABLE here, because no existing column could express it and
-- guessing at it from civil status would be inventing a fact.
UPDATE "Employee" SET "confidentialityAgreement" = 'ON_FILE' WHERE "confidentialityAgreementOn" IS NOT NULL;
UPDATE "Employee" SET "authorityToDeduct"        = 'ON_FILE' WHERE "authorityToDeductOn"        IS NOT NULL;
UPDATE "Employee" SET "birthCertificate"         = 'ON_FILE' WHERE "birthCertificateOn"         IS NOT NULL;
UPDATE "Employee" SET "marriageContract"         = 'ON_FILE' WHERE "marriageContractOn"         IS NOT NULL;
