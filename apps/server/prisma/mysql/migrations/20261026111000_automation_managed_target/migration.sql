ALTER TABLE `Automation` ADD COLUMN `managedTargetHomeId` VARCHAR(191) NULL;
ALTER TABLE `Automation` ADD COLUMN `managedTargetManagedId` VARCHAR(191) NULL;
ALTER TABLE `Automation` ADD COLUMN `managedTargetIndexed` BOOLEAN NOT NULL DEFAULT false;
-- Legacy Session targets and the exact canonical observation-only marker cannot execute a managed Workflow action.
UPDATE `Automation` SET `managedTargetIndexed` = true WHERE `targetType` IS NOT NULL
    OR BINARY `templateCiphertext` = BINARY CONCAT('{"kind":"observationOnly","templateVersion":', CAST(`templateVersion` AS CHAR), '}');
CREATE INDEX `Automation_account_managed_target_idx` ON `Automation`(`accountId`, `deletedAt`, `managedTargetIndexed`, `managedTargetHomeId`, `managedTargetManagedId`);
CREATE INDEX `Automation_account_managed_unknown_idx` ON `Automation`(`accountId`, `deletedAt`, `managedTargetIndexed`, `updatedAt`, `id`);
