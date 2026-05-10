ALTER TYPE "TaskEventType" ADD VALUE IF NOT EXISTS 'TASK_COMPLETION_REQUESTED';

ALTER TABLE "Task"
  ADD COLUMN "completionRequestedAt" TIMESTAMP(3),
  ADD COLUMN "completionRequestedById" TEXT;

CREATE INDEX "Task_completionRequestedById_idx" ON "Task"("completionRequestedById");

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_completionRequestedById_fkey"
  FOREIGN KEY ("completionRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
