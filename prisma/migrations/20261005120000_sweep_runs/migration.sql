-- CreateTable
CREATE TABLE "SweepRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "finalized" INTEGER NOT NULL DEFAULT 0,
    "graded" INTEGER NOT NULL DEFAULT 0,
    "stillPending" INTEGER NOT NULL DEFAULT 0,
    "held" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "stoppedEarly" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SweepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SweepRun_startedAt_idx" ON "SweepRun"("startedAt");
