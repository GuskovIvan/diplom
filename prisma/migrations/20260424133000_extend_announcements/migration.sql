CREATE TYPE "AnnouncementPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'URGENT');

ALTER TABLE "Announcement"
  ADD COLUMN "priority" "AnnouncementPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "expiresAt" TIMESTAMP(3);

ALTER TABLE "AnnouncementRecipient"
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "archivedAt" TIMESTAMP(3);
