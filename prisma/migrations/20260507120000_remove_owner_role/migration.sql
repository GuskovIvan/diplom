UPDATE "ProjectMember"
SET "role" = 'ADMIN'
WHERE "role" = 'OWNER';

ALTER TABLE "ProjectMember" ALTER COLUMN "role" DROP DEFAULT;

ALTER TYPE "ProjectRole" RENAME TO "ProjectRole_old";
CREATE TYPE "ProjectRole" AS ENUM ('ADMIN', 'MEMBER');

ALTER TABLE "ProjectMember"
ALTER COLUMN "role" TYPE "ProjectRole"
USING ("role"::text::"ProjectRole");

ALTER TABLE "ProjectMember" ALTER COLUMN "role" SET DEFAULT 'MEMBER';

DROP TYPE "ProjectRole_old";
