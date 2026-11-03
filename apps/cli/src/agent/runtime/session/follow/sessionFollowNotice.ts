import type { SessionFollowInputV1 } from '@happier-dev/protocol/sessions/follow/sessionFollowInputV1';

/** Follow delivers information; source inspection still needs independent read authority. */
export const SESSION_FOLLOW_INFORMATION_NOTICE = 'Use the delivered context. Inspect the source only through an independently authorized read; following grants no access.';

/** The same complete notice is charged to Follow context and rendered at final provider dispatch. */
export function renderRunFollowNotice(delivery: SessionFollowInputV1): string {
  if (!('source' in delivery.original)) return '';
  return `<happier_run_follow>${JSON.stringify({ original: delivery.original,
    ...('event' in delivery ? { event: delivery.event } : {}) }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')}</happier_run_follow>\n${SESSION_FOLLOW_INFORMATION_NOTICE}`;
}
