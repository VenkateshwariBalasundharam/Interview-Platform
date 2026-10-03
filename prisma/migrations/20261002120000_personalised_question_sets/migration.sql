-- CreateIndex
CREATE INDEX "QuestionSet_candidateId_roundType_idx" ON "QuestionSet"("candidateId", "roundType");

-- AddForeignKey (existing job-wide sets have a NULL candidateId, so nothing is affected)
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
