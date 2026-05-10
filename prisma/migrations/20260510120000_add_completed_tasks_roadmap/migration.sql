ALTER TYPE "TaskEventType" ADD VALUE IF NOT EXISTS 'TASK_COMPLETED';
ALTER TYPE "TaskEventType" ADD VALUE IF NOT EXISTS 'TASK_ROADMAP_MOVED';

ALTER TABLE "Task"
  ADD COLUMN "isCompleted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "completedPosition" INTEGER;

CREATE INDEX "Task_columnId_isCompleted_completedPosition_idx"
  ON "Task"("columnId", "isCompleted", "completedPosition");
