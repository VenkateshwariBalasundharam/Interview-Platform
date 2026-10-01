-- CreateEnum
CREATE TYPE "RoundType" AS ENUM ('ASSESSMENT', 'TECHNICAL', 'CODING', 'SYSTEM_DESIGN', 'SCENARIO', 'HR', 'MANAGER');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "CutoffMode" AS ENUM ('DISQUALIFY', 'FLAG_FOR_REVIEW');

-- CreateEnum
CREATE TYPE "ProctoringLevel" AS ENUM ('OFF', 'PRESENCE', 'IDENTITY');

-- CreateEnum
CREATE TYPE "ResultMode" AS ENUM ('AUTO_SUGGEST', 'ALWAYS_HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "RetakePolicy" AS ENUM ('NONE', 'ADMIN_GRANTED');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('FRESHER', 'MID', 'SENIOR');

-- CreateEnum
CREATE TYPE "CandidateStatus" AS ENUM ('ACTIVE', 'DISQUALIFIED', 'PENDING_REVIEW', 'COMPLETED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED', 'GRADED');

-- CreateEnum
CREATE TYPE "QuestionKind" AS ENUM ('MCQ', 'SHORT_ANSWER', 'WRITTEN');

-- CreateEnum
CREATE TYPE "QuestionSetStatus" AS ENUM ('DRAFT', 'APPROVED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ProctorEventType" AS ENUM ('TAB_SWITCH', 'PASTE', 'FULLSCREEN_EXIT', 'NO_FACE', 'MULTIPLE_FACES', 'LOOKING_AWAY', 'IDENTITY_MISMATCH');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "jdText" TEXT NOT NULL,
    "requiredSkills" TEXT[],
    "tier" "Tier" NOT NULL,
    "resultMode" "ResultMode" NOT NULL DEFAULT 'AUTO_SUGGEST',
    "retakePolicy" "RetakePolicy" NOT NULL DEFAULT 'NONE',
    "clonedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundConfig" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "roundType" "RoundType" NOT NULL,
    "position" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cutoffPercent" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',
    "cutoffMode" "CutoffMode" NOT NULL DEFAULT 'DISQUALIFY',
    "proctoringLevel" "ProctoringLevel" NOT NULL DEFAULT 'OFF',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "humanScored" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RoundConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "candidateCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "dobHash" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "CandidateStatus" NOT NULL DEFAULT 'ACTIVE',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "sessionId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "resumePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionSet" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "roundType" "RoundType" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "QuestionSetStatus" NOT NULL DEFAULT 'DRAFT',
    "candidateId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "kind" "QuestionKind" NOT NULL,
    "position" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "correctIndex" INTEGER,
    "rubric" JSONB,
    "points" INTEGER NOT NULL DEFAULT 1,
    "difficulty" "Difficulty" NOT NULL DEFAULT 'MEDIUM',

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodingProblem" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "difficulty" "Difficulty" NOT NULL,
    "tier" "Tier",
    "starterCode" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodingProblem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "problemId" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "expectedOutput" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "roundType" "RoundType" NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "percent" DOUBLE PRECISION,
    "seed" TEXT,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "response" JSONB,
    "score" DOUBLE PRECISION,
    "feedback" TEXT,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorEvent" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "attemptId" TEXT,
    "roundType" "RoundType" NOT NULL,
    "type" "ProctorEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "ProctorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProctorSnapshot" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProctorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaceReference" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "embeddingEnc" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HumanScore" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "roundType" "RoundType" NOT NULL,
    "score" INTEGER NOT NULL,
    "notes" TEXT,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HumanScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Result" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "weightedScore" DOUBLE PRECISION NOT NULL,
    "suggestedDecision" TEXT NOT NULL,
    "finalDecision" TEXT,
    "pendingHumanReview" BOOLEAN NOT NULL DEFAULT true,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RoundConfig_jobId_position_key" ON "RoundConfig"("jobId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "RoundConfig_jobId_roundType_key" ON "RoundConfig"("jobId", "roundType");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_candidateCode_key" ON "Candidate"("candidateCode");

-- CreateIndex
CREATE INDEX "Candidate_jobId_idx" ON "Candidate"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_jobId_email_key" ON "Candidate"("jobId", "email");

-- CreateIndex
CREATE INDEX "QuestionSet_jobId_roundType_idx" ON "QuestionSet"("jobId", "roundType");

-- CreateIndex
CREATE INDEX "Question_setId_idx" ON "Question"("setId");

-- CreateIndex
CREATE INDEX "TestCase_problemId_idx" ON "TestCase"("problemId");

-- CreateIndex
CREATE UNIQUE INDEX "Attempt_candidateId_roundType_key" ON "Attempt"("candidateId", "roundType");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_attemptId_questionId_key" ON "Answer"("attemptId", "questionId");

-- CreateIndex
CREATE INDEX "ProctorEvent_candidateId_roundType_idx" ON "ProctorEvent"("candidateId", "roundType");

-- CreateIndex
CREATE UNIQUE INDEX "ProctorSnapshot_eventId_key" ON "ProctorSnapshot"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ProctorSnapshot_storageKey_key" ON "ProctorSnapshot"("storageKey");

-- CreateIndex
CREATE INDEX "ProctorSnapshot_expiresAt_idx" ON "ProctorSnapshot"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "FaceReference_candidateId_key" ON "FaceReference"("candidateId");

-- CreateIndex
CREATE INDEX "FaceReference_expiresAt_idx" ON "FaceReference"("expiresAt");

-- CreateIndex
CREATE INDEX "ConsentRecord_candidateId_idx" ON "ConsentRecord"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "HumanScore_candidateId_roundType_key" ON "HumanScore"("candidateId", "roundType");

-- CreateIndex
CREATE UNIQUE INDEX "Result_candidateId_key" ON "Result"("candidateId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RoundConfig" ADD CONSTRAINT "RoundConfig_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSet" ADD CONSTRAINT "QuestionSet_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_setId_fkey" FOREIGN KEY ("setId") REFERENCES "QuestionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodingProblem" ADD CONSTRAINT "CodingProblem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "CodingProblem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorEvent" ADD CONSTRAINT "ProctorEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorEvent" ADD CONSTRAINT "ProctorEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorSnapshot" ADD CONSTRAINT "ProctorSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "ProctorEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProctorSnapshot" ADD CONSTRAINT "ProctorSnapshot_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaceReference" ADD CONSTRAINT "FaceReference_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanScore" ADD CONSTRAINT "HumanScore_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HumanScore" ADD CONSTRAINT "HumanScore_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
