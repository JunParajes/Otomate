-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "EducationLevel" AS ENUM ('ELEMENTARY', 'HIGH_SCHOOL', 'SENIOR_HIGH', 'VOCATIONAL', 'COLLEGE', 'POST_GRADUATE');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "authorityToDeductOn" DATE,
ADD COLUMN     "birthCertificateOn" DATE,
ADD COLUMN     "birthPlace" TEXT,
ADD COLUMN     "confidentialityAgreementOn" DATE,
ADD COLUMN     "educationDetail" TEXT,
ADD COLUMN     "educationLevel" "EducationLevel",
ADD COLUMN     "email" TEXT,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "heightCm" INTEGER,
ADD COLUMN     "marriageContractOn" DATE,
ADD COLUMN     "probationExtendedTo" DATE,
ADD COLUMN     "probationExtensionReason" TEXT,
ADD COLUMN     "religion" TEXT,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "weightGrams" INTEGER;
