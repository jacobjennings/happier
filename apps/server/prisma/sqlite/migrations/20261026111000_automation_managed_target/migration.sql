ALTER TABLE "Automation" ADD COLUMN "managedTargetHomeId" TEXT;
ALTER TABLE "Automation" ADD COLUMN "managedTargetManagedId" TEXT;
ALTER TABLE "Automation" ADD COLUMN "managedTargetIndexed" BOOLEAN NOT NULL DEFAULT false;
-- Legacy Session targets and the exact canonical observation-only marker cannot execute a managed Workflow action.
UPDATE "Automation" SET "managedTargetIndexed" = true WHERE "targetType" IS NOT NULL
    OR "templateCiphertext" = '{"kind":"observationOnly","templateVersion":' || CAST("templateVersion" AS TEXT) || '}';
CREATE INDEX "Automation_account_managed_target_idx" ON "Automation"("accountId", "deletedAt", "managedTargetIndexed", "managedTargetHomeId", "managedTargetManagedId");
CREATE INDEX "Automation_account_managed_unknown_idx" ON "Automation"("accountId", "deletedAt", "managedTargetIndexed", "updatedAt", "id");
