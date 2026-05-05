ALTER TABLE "Task"
ADD COLUMN "creatorId" TEXT;

UPDATE "Task" AS task
SET "creatorId" = COALESCE(
  (
    SELECT event."actorId"
    FROM "TaskEvent" AS event
    WHERE event."taskId" = task."id"
      AND event."type" = 'TASK_CREATED'
      AND event."actorId" IS NOT NULL
    ORDER BY event."createdAt" ASC
    LIMIT 1
  ),
  (
    SELECT project."ownerId"
    FROM "Project" AS project
    WHERE project."id" = task."projectId"
  )
);

ALTER TABLE "Task"
ALTER COLUMN "creatorId" SET NOT NULL;

CREATE INDEX "Task_creatorId_idx" ON "Task"("creatorId");

ALTER TABLE "Task"
ADD CONSTRAINT "Task_creatorId_fkey"
FOREIGN KEY ("creatorId") REFERENCES "User"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
