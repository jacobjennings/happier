-- Execution Run queues have their own summaries; the Session summary covers its primary runtime.
UPDATE "Session" SET "pendingOwnerCount" = (SELECT COUNT(*) FROM "SessionPendingMessage" WHERE "SessionPendingMessage"."sessionId" = "Session"."id" AND "targetExecutionRunId" IS NULL AND "status" = 'queued' AND "automated" = false);
