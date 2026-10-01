-- AlterTable
ALTER TABLE "CodingProblem" ADD COLUMN     "timeLimitSec" DOUBLE PRECISION NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "CodingAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'python',
    "code" TEXT NOT NULL DEFAULT '',
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "passed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION,
    "submittedLanguage" TEXT,
    "submittedCode" TEXT,
    "lastVerdict" TEXT,
    "submittedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodingAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CodingAnswer_attemptId_problemId_key" ON "CodingAnswer"("attemptId", "problemId");

-- AddForeignKey
ALTER TABLE "CodingAnswer" ADD CONSTRAINT "CodingAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingAnswer" ADD CONSTRAINT "CodingAnswer_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "CodingProblem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
