-- AlterEnum
ALTER TYPE "ProctorEventType" ADD VALUE 'CAMERA_UNAVAILABLE';

-- AlterTable
ALTER TABLE "RoundConfig" ADD COLUMN "cameraRequired" BOOLEAN NOT NULL DEFAULT true;
