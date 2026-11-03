import type { ProjectSetupInspection } from './projectSetupPreparation';
import { logger } from '@/ui/logger';

/** Preserve typed read failures without logging private inputs or error messages. */
export function projectSetupInspectionFailure(error: unknown, signal?: AbortSignal): ProjectSetupInspection {
    signal?.throwIfAborted();
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
        ? error.code : 'project_setup_inspection_failed';
    logger.debug('[ProjectSetup] inspection failed', { code });
    return { setupReadiness: { kind: 'unknown', code } };
}
