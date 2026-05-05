CREATE TABLE "TaskGroup" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaskGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TaskGroupMember" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TaskGroupMember_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Task" ADD COLUMN "assigneeGroupId" TEXT;

CREATE UNIQUE INDEX "TaskGroup_projectId_name_key" ON "TaskGroup"("projectId", "name");
CREATE INDEX "TaskGroup_projectId_idx" ON "TaskGroup"("projectId");
CREATE UNIQUE INDEX "TaskGroupMember_groupId_memberId_key" ON "TaskGroupMember"("groupId", "memberId");
CREATE INDEX "TaskGroupMember_memberId_idx" ON "TaskGroupMember"("memberId");
CREATE INDEX "Task_assigneeGroupId_idx" ON "Task"("assigneeGroupId");

ALTER TABLE "TaskGroup"
  ADD CONSTRAINT "TaskGroup_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskGroupMember"
  ADD CONSTRAINT "TaskGroupMember_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "TaskGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskGroupMember"
  ADD CONSTRAINT "TaskGroupMember_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "ProjectMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_assigneeGroupId_fkey"
  FOREIGN KEY ("assigneeGroupId") REFERENCES "TaskGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
