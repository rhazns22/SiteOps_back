-- Extend activity audit trail
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_DELETED';
ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'REQUEST_RESTORED';

-- User profile metadata
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarPath" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- Client lifecycle and contact metadata
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "contactName" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "contactPhone" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "memo" TEXT;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "managerId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Client_managerId_fkey'
  ) THEN
    ALTER TABLE "Client"
      ADD CONSTRAINT "Client_managerId_fkey"
      FOREIGN KEY ("managerId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Client_isActive_idx" ON "Client"("isActive");
CREATE INDEX IF NOT EXISTS "Client_managerId_idx" ON "Client"("managerId");

-- Soft delete for maintenance requests
ALTER TABLE "MaintenanceRequest" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "MaintenanceRequest" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
ALTER TABLE "MaintenanceRequest" ADD COLUMN IF NOT EXISTS "deleteReason" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'MaintenanceRequest_deletedById_fkey'
  ) THEN
    ALTER TABLE "MaintenanceRequest"
      ADD CONSTRAINT "MaintenanceRequest_deletedById_fkey"
      FOREIGN KEY ("deletedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "MaintenanceRequest_deletedAt_idx" ON "MaintenanceRequest"("deletedAt");
CREATE INDEX IF NOT EXISTS "MaintenanceRequest_deletedById_idx" ON "MaintenanceRequest"("deletedById");

-- Persisted user notification preferences
CREATE TABLE IF NOT EXISTS "UserPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedNotification" BOOLEAN NOT NULL DEFAULT true,
  "commentNotification" BOOLEAN NOT NULL DEFAULT true,
  "reviewNotification" BOOLEAN NOT NULL DEFAULT true,
  "approvedNotification" BOOLEAN NOT NULL DEFAULT true,
  "rejectedNotification" BOOLEAN NOT NULL DEFAULT true,
  "deadlineNotification" BOOLEAN NOT NULL DEFAULT true,
  "emailNotification" BOOLEAN NOT NULL DEFAULT false,
  "appNotification" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserPreference_userId_key" ON "UserPreference"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UserPreference_userId_fkey'
  ) THEN
    ALTER TABLE "UserPreference"
      ADD CONSTRAINT "UserPreference_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Workspace-level non-secret defaults
CREATE TABLE IF NOT EXISTS "WorkspaceSetting" (
  "id" TEXT NOT NULL DEFAULT 'workspace',
  "serviceName" TEXT NOT NULL DEFAULT 'SiteOps',
  "defaultDueDays" INTEGER NOT NULL DEFAULT 7,
  "defaultPriority" "Priority" NOT NULL DEFAULT 'NORMAL',
  "maxFileSizeMb" INTEGER NOT NULL DEFAULT 10,
  "inviteExpiresInDays" INTEGER NOT NULL DEFAULT 7,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceSetting_pkey" PRIMARY KEY ("id")
);

INSERT INTO "WorkspaceSetting" ("id")
VALUES ('workspace')
ON CONFLICT ("id") DO NOTHING;
