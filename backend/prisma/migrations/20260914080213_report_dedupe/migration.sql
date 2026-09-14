-- AlterTable
ALTER TABLE "reports" ADD COLUMN     "ipHash" TEXT,
ADD COLUMN     "sessionId" TEXT;

-- CreateIndex
CREATE INDEX "reports_targetType_targetId_status_idx" ON "reports"("targetType", "targetId", "status");
