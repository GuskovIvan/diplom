CREATE TABLE "Announcement" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "authorId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnnouncementRecipient" (
  "id" TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Announcement_projectId_createdAt_idx" ON "Announcement"("projectId", "createdAt");
CREATE INDEX "Announcement_authorId_idx" ON "Announcement"("authorId");
CREATE UNIQUE INDEX "AnnouncementRecipient_announcementId_memberId_key" ON "AnnouncementRecipient"("announcementId", "memberId");
CREATE INDEX "AnnouncementRecipient_memberId_readAt_idx" ON "AnnouncementRecipient"("memberId", "readAt");

ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Announcement"
  ADD CONSTRAINT "Announcement_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AnnouncementRecipient"
  ADD CONSTRAINT "AnnouncementRecipient_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnnouncementRecipient"
  ADD CONSTRAINT "AnnouncementRecipient_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "ProjectMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
