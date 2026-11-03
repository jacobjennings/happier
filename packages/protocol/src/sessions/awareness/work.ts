import { projectSessionWorkDisplayV1, type SessionWorkDisplayV1 } from '../work/state/sessionWorkStatePrimary.js';
import type { SessionWorkStateV1 } from '../work/state/sessionWorkStateV1.js';
import type { SessionWorkflowActivityHeadlineV1 } from '../work/workflow/sessionWorkflowActivityHeadlineV1.js';
import { normalizeAwarenessTextV1 } from './inputV1.js';
import type { SessionAwarenessWorkHeadlineV1 } from './projectionV1.js';

/**
 * The bounded "what is this Session working on" line.
 *
 * It composes the two facts the platform already publishes — the canonical work-state primary
 * item and the runtime's compact workflow headline — and adds no third ranking of its own. Where
 * a surface needs a rich Agent/Run card it composes Lane 05's Agent-activity presentation beside
 * awareness instead; duplicating that model here would be the same split-brain in a new file.
 */
export function projectSessionAwarenessWorkHeadlineV1(
  params: Readonly<{
    work?: SessionWorkStateV1 | SessionWorkDisplayV1 | null;
    workflowHeadline?: SessionWorkflowActivityHeadlineV1 | null;
    contentReadable: boolean;
    workEvidenceUnavailable?: boolean;
  }>,
): SessionAwarenessWorkHeadlineV1 | undefined {
  // Work titles are user content. A caller that could not open the Session gets no headline at
  // all rather than a redacted placeholder that would still prove the work exists.
  if (!params.contentReadable || params.workEvidenceUnavailable === true) return undefined;

  const activeWorkflowRunCount = params.workflowHeadline?.activeRuns.length ?? 0;

  const primaryItem = projectSessionWorkDisplayV1(params.work)?.primaryItem;
  const primaryTitle = normalizeAwarenessTextV1(primaryItem?.title);
  if (primaryItem && primaryTitle) {
    return {
      title: primaryTitle,
      itemId: primaryItem.id,
      kind: primaryItem.kind,
      status: primaryItem.status,
      ...(activeWorkflowRunCount > 0 ? { activeWorkflowRunCount } : {}),
    };
  }

  const workflowRun = readPrimaryWorkflowRunV1(params.workflowHeadline);
  const workflowTitle = normalizeAwarenessTextV1(workflowRun?.title);
  if (!workflowTitle) return undefined;
  return {
    title: workflowTitle,
    ...(activeWorkflowRunCount > 0 ? { activeWorkflowRunCount } : {}),
  };
}

function readPrimaryWorkflowRunV1(
  headline: SessionWorkflowActivityHeadlineV1 | null | undefined,
): SessionWorkflowActivityHeadlineV1['activeRuns'][number] | null {
  if (!headline) return null;
  const primaryRunId = normalizeAwarenessTextV1(headline.primaryRunId);
  if (primaryRunId) {
    const primaryRun = headline.activeRuns.find((run) => run.runId === primaryRunId);
    if (primaryRun) return primaryRun;
  }
  // `activeRuns` already arrives in the shared headline ordering (attention first, then stable
  // identity), so the first entry is the canonical choice — not an arbitrary one.
  return headline.activeRuns[0] ?? null;
}
