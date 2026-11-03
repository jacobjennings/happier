import type { PreNormalizedActionSpec } from './definition.js';
import { ReviewCommentActionInputSchemasV1, ReviewCommentActionOutputSchemasV1, type ReviewCommentActionIdV1 } from '../../reviews/comments/actions.js';
import { RPC_METHODS } from '../../rpc/methods.js';


export const REVIEW_COMMENT_ACTION_TITLES: Readonly<Record<ReviewCommentActionIdV1, string>> = Object.freeze({
  'reviews.comments.create': 'Create review comment',
  'reviews.comments.list': 'List review comments',
  'reviews.comments.get': 'Get review comment',
  'reviews.comments.transition': 'Transition review comment',
  'reviews.comments.edit': 'Edit review comment',
  'reviews.comments.reply': 'Reply to review comment',
  'reviews.comments.redact': 'Redact review comment',
  'reviews.comments.setDisposition': 'Set review comment disposition',
  'reviews.comments.attachEvidence': 'Attach review comment evidence',
  'reviews.comments.bulkTransition': 'Bulk transition review comments',
  'reviews.comments.claimPublicationDispatch': 'Claim review comment publication dispatch',
});

export const REVIEW_COMMENT_ACTION_SDK_METHODS: Readonly<Record<ReviewCommentActionIdV1, string>> = Object.freeze({
  'reviews.comments.create': 'reviews.comments.create',
  'reviews.comments.list': 'reviews.comments.list',
  'reviews.comments.get': 'reviews.comments.get',
  'reviews.comments.transition': 'reviews.comments.transition',
  'reviews.comments.edit': 'reviews.comments.edit',
  'reviews.comments.reply': 'reviews.comments.reply',
  'reviews.comments.redact': 'reviews.comments.redact',
  'reviews.comments.setDisposition': 'reviews.comments.setDisposition',
  'reviews.comments.attachEvidence': 'reviews.comments.attachEvidence',
  'reviews.comments.bulkTransition': 'reviews.comments.bulkTransition',
  'reviews.comments.claimPublicationDispatch': 'reviews.comments.claimPublicationDispatch',
});

export const REVIEW_COMMENT_ACTION_RPC_METHODS: Readonly<Record<ReviewCommentActionIdV1, string>> = Object.freeze({
  'reviews.comments.create': RPC_METHODS.REVIEW_COMMENTS_CREATE,
  'reviews.comments.list': RPC_METHODS.REVIEW_COMMENTS_LIST,
  'reviews.comments.get': RPC_METHODS.REVIEW_COMMENTS_GET,
  'reviews.comments.transition': RPC_METHODS.REVIEW_COMMENTS_TRANSITION,
  'reviews.comments.edit': RPC_METHODS.REVIEW_COMMENTS_EDIT,
  'reviews.comments.reply': RPC_METHODS.REVIEW_COMMENTS_REPLY,
  'reviews.comments.redact': RPC_METHODS.REVIEW_COMMENTS_REDACT,
  'reviews.comments.setDisposition': RPC_METHODS.REVIEW_COMMENTS_SET_DISPOSITION,
  'reviews.comments.attachEvidence': RPC_METHODS.REVIEW_COMMENTS_ATTACH_EVIDENCE,
  'reviews.comments.bulkTransition': RPC_METHODS.REVIEW_COMMENTS_BULK_TRANSITION,
  'reviews.comments.claimPublicationDispatch': RPC_METHODS.REVIEW_COMMENTS_CLAIM_PUBLICATION_DISPATCH,
});

/** What a person reads in Settings, approvals and the form. Agents read `description`. */
export const REVIEW_COMMENT_ACTION_SUMMARIES: Readonly<Record<ReviewCommentActionIdV1, string>> = Object.freeze({
  'reviews.comments.create': 'Add a comment to a review, on a line or on the whole change.',
  'reviews.comments.list': 'See the comments on a review.',
  'reviews.comments.get': 'Read one review comment and its replies.',
  'reviews.comments.transition': 'Move a review comment along, for example from proposed to open, or to resolved.',
  'reviews.comments.edit': 'Change the text of a review comment.',
  'reviews.comments.reply': 'Answer a review comment.',
  'reviews.comments.redact': 'Hide the text of a review comment that should not be shown, keeping its place in the review.',
  'reviews.comments.setDisposition': 'Record what was decided about a review comment, such as whether it must be fixed.',
  'reviews.comments.attachEvidence': 'Add proof to a review comment, such as a failing test or a file reference.',
  'reviews.comments.bulkTransition': 'Move several review comments along in one step.',
  'reviews.comments.claimPublicationDispatch': 'Reserve review comments for posting to the pull request, so they are posted only once.',
});

export const REVIEW_COMMENT_ACTION_VOICE_EXAMPLES = {
  'reviews.comments.create': '{"workspace":{"machineId":"machine-1","path":"/repo"},"anchor":{"kind":"file","filePath":"src/main.ts"},"snapshot":{"kind":"none","capturedAt":1},"body":"Check the failure path.","clientMutationId":"create-1"}',
  'reviews.comments.list': '{"workspace":{"machineId":"machine-1","path":"/repo"}}',
  'reviews.comments.get': '{"commentId":"comment-1"}',
  'reviews.comments.transition': '{"workspace":{"machineId":"machine-1","path":"/repo"},"commentId":"comment-1","expectedServerRevision":1,"expectedState":"open","toState":"resolved","reason":"The regression test passes.","clientMutationId":"transition-1"}',
  'reviews.comments.edit': '{"workspace":{"machineId":"machine-1","path":"/repo"},"commentId":"comment-1","expectedServerRevision":1,"expectedBodyVersion":1,"nextBody":"Check the cancellation path.","clientMutationId":"edit-1"}',
  'reviews.comments.reply': '{"workspace":{"machineId":"machine-1","path":"/repo"},"parentCommentId":"comment-1","expectedParentServerRevision":1,"body":"Added a regression test.","clientMutationId":"reply-1"}',
  'reviews.comments.redact': '{"workspace":{"machineId":"machine-1","path":"/repo"},"commentId":"comment-1","expectedServerRevision":1,"reason":"Contains private content.","clientMutationId":"redact-1"}',
  'reviews.comments.setDisposition': '{"workspace":{"machineId":"machine-1","path":"/repo"},"commentId":"comment-1","expectedServerRevision":1,"disposition":"blocking","clientMutationId":"disposition-1"}',
  'reviews.comments.attachEvidence': '{"workspace":{"machineId":"machine-1","path":"/repo"},"commentId":"comment-1","expectedServerRevision":1,"evidence":[{"kind":"reasoning","message":"Cancellation leaves the destination unchanged."}],"clientMutationId":"evidence-1"}',
  'reviews.comments.bulkTransition': '{"workspace":{"machineId":"machine-1","path":"/repo"},"commentIds":["comment-1"],"expectedServerRevisions":{"comment-1":1},"expectedState":"open","toState":"resolved","reason":"The regression test passes.","clientMutationId":"bulk-1"}',
} as const satisfies Record<Exclude<ReviewCommentActionIdV1, 'reviews.comments.claimPublicationDispatch'>, string>;

export function createReviewCommentActionSpec(actionId: ReviewCommentActionIdV1): PreNormalizedActionSpec {
  const isRead = actionId === 'reviews.comments.list' || actionId === 'reviews.comments.get';
  const isReversibleMutation = actionId === 'reviews.comments.transition' || actionId === 'reviews.comments.bulkTransition'
    || actionId === 'reviews.comments.edit' || actionId === 'reviews.comments.reply';
  const isPublicCommentAction = actionId !== 'reviews.comments.claimPublicationDispatch';
  return {
    // A publication handler awaits its claim correlations before
    // provider dispatch. Keep that nested plugin invocation on the existing
    // approval waiter instead of returning an approval Artifact as a claim.
    id: actionId, approval: { result: actionId === 'reviews.comments.claimPublicationDispatch' ? 'required' : 'none' },
    ...(actionId === 'reviews.comments.claimPublicationDispatch' ? { irreversible: true as const } : {}),
    executionPlacement: 'account',
    title: REVIEW_COMMENT_ACTION_TITLES[actionId],
    description: 'Operate on durable review comments through the shared review-comment substrate.',
    safety: isRead || isReversibleMutation ? 'safe' : 'danger',
    ...(isReversibleMutation ? { approvalPolicy: { agentDefault: 'authority' as const } } : {}),
    placements: [],
    bindings: {
      rpcMethod: REVIEW_COMMENT_ACTION_RPC_METHODS[actionId],
      sdkMethod: REVIEW_COMMENT_ACTION_SDK_METHODS[actionId],
      ...(isPublicCommentAction ? {
        mcpToolName: actionId.replaceAll('.', '_'),
        voiceClientToolName: actionId.replaceAll('.', '_'),
      } : {}),
    },
    surfaces: {
      ui: true,
      voice: isPublicCommentAction,
      agent: isPublicCommentAction,
      mcp: isPublicCommentAction,
      cli: isPublicCommentAction,
      rpc: true,
    },
    ...(isPublicCommentAction ? { cli: { acceptsServerId: true, commands: [{
      path: actionId.split('.').map((segment) => segment.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)),
      visibility: 'canonical' as const,
    }] } } : {}),
    sideEffectClass: isRead ? 'read' : 'write',
    outputSchema: ReviewCommentActionOutputSchemasV1[actionId],
    inputSchema: ReviewCommentActionInputSchemasV1[actionId],
    inputHints: { description: REVIEW_COMMENT_ACTION_SUMMARIES[actionId], fields: [] },
    ...(actionId === 'reviews.comments.claimPublicationDispatch' ? {} : {
      examples: { voice: { argsExample: REVIEW_COMMENT_ACTION_VOICE_EXAMPLES[actionId] } },
    }),
  };
}
