-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "resumeParseError" TEXT,
ADD COLUMN     "resumeParsed" JSONB,
ADD COLUMN     "resumeParsedAt" TIMESTAMP(3),
ADD COLUMN     "resumeUploadedAt" TIMESTAMP(3);
