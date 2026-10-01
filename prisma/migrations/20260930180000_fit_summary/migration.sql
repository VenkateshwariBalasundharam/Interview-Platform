-- CreateTable
CREATE TABLE "FitSummary" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FitSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FitSummary_candidateId_key" ON "FitSummary"("candidateId");

-- AddForeignKey
ALTER TABLE "FitSummary" ADD CONSTRAINT "FitSummary_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
