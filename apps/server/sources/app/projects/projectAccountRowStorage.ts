import * as z from 'zod/mini';
import {
    ProjectAccountAuthoringSessionV1Schema,
    StoredProjectAccountRowContentV1Schema,
    assertProjectAccountRowContentForModeV1,
    assertProjectAccountRowPayloadBindingV1,
    type ProjectAccountRowKeyV1,
    type ProjectAccountRowV1,
} from '@happier-dev/protocol/projects/projectAccountRowsV1';
import type { ReservedAccountScopedKvRowDomain } from '@/app/kv/reservedAccountScopedKvRow';

/** Storage-only metadata sits beside, never inside, the private content envelope. */
const ProjectAccountRowStorageEnvelopeSchema = z.intersection(StoredProjectAccountRowContentV1Schema,
    z.object({ authoringSession: z.optional(ProjectAccountAuthoringSessionV1Schema) }));
type ProjectAccountRowStorageEnvelope = z.infer<typeof ProjectAccountRowStorageEnvelopeSchema>;

export function projectAccountRowStorageDomain(key?: ProjectAccountRowKeyV1): ReservedAccountScopedKvRowDomain<ProjectAccountRowStorageEnvelope> {
    const parse = (input: unknown): ProjectAccountRowStorageEnvelope | null => {
        const parsed = ProjectAccountRowStorageEnvelopeSchema.safeParse(input);
        if (!parsed.success || (key && key.kind !== 'workspace-ref' && parsed.data.authoringSession)) return null;
        if (key && parsed.data.t === 'plain') {
            try { assertProjectAccountRowPayloadBindingV1(key, parsed.data.v); }
            catch { return null; }
        }
        return parsed.data;
    };
    return { label: 'Project Account row', parseStoredEnvelope: parse, parseCandidateEnvelope: parse,
        assertEnvelopeForMode: (content, mode) => { assertProjectAccountRowContentForModeV1(content, mode); } };
}

/** Legacy reads and mutation acknowledgements retain their exact private wire shape. */
export function projectAccountRowFromStorage(input: Readonly<{ key: ProjectAccountRowKeyV1; revision: number;
    envelope: ProjectAccountRowStorageEnvelope | null; includeAuthoringSession?: true }>): ProjectAccountRowV1 {
    if (input.envelope === null) return { key: input.key, revision: input.revision, content: null };
    const { authoringSession, ...content } = input.envelope;
    return { key: input.key, revision: input.revision,
        content,
        ...(input.includeAuthoringSession && input.key.kind === 'workspace-ref' && authoringSession ? { authoringSession } : {}) };
}
