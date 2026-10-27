ALTER TABLE "SessionPendingMessage" ADD COLUMN "automated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Session" ADD COLUMN "pendingOwnerCount" INTEGER NOT NULL DEFAULT 0;
UPDATE "Session" SET "pendingOwnerCount" = (SELECT COUNT(*) FROM "SessionPendingMessage" WHERE "SessionPendingMessage"."sessionId" = "Session"."id" AND "status" = 'queued' AND "automated" = false);
