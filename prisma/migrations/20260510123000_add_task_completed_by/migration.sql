ALTER TABLE "Task"
  ADD COLUMN "completedById" TEXT;

CREATE INDEX "Task_completedById_idx" ON "Task"("completedById");

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
