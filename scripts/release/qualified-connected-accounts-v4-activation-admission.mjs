#!/usr/bin/env node

import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_MIGRATION =
  '20260725100000_activate_qualified_connected_accounts_v4';

export const QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_PATHS = Object.freeze([
  Object.freeze({
    provider: 'postgresql',
    label: 'PostgreSQL',
    path: `apps/server/prisma/migrations/${QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_MIGRATION}/migration.sql`,
  }),
  Object.freeze({
    provider: 'mysql',
    label: 'MySQL',
    path: `apps/server/prisma/mysql/migrations/${QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_MIGRATION}/migration.sql`,
  }),
  Object.freeze({
    provider: 'sqlite',
    label: 'SQLite',
    path: `apps/server/prisma/sqlite/migrations/${QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_MIGRATION}/migration.sql`,
  }),
]);

export const ACCOUNT_SESSION_READ_STATE_BACKFILL_MIGRATION =
  '20260905235000_add_account_session_read_state';

export const ACCOUNT_SESSION_READ_STATE_BACKFILL_PATHS = Object.freeze([
  Object.freeze({
    provider: 'postgresql',
    label: 'PostgreSQL',
    path: `apps/server/prisma/migrations/${ACCOUNT_SESSION_READ_STATE_BACKFILL_MIGRATION}/migration.sql`,
  }),
  Object.freeze({
    provider: 'mysql',
    label: 'MySQL',
    path: `apps/server/prisma/mysql/migrations/${ACCOUNT_SESSION_READ_STATE_BACKFILL_MIGRATION}/migration.sql`,
  }),
  Object.freeze({
    provider: 'sqlite',
    label: 'SQLite',
    path: `apps/server/prisma/sqlite/migrations/${ACCOUNT_SESSION_READ_STATE_BACKFILL_MIGRATION}/migration.sql`,
  }),
]);

export const QUALIFIED_CONNECTED_ACCOUNTS_V4_ROLLBACK_SUPPORT = Object.freeze([
  Object.freeze({
    key: 'qualifiedAccountsV4',
    label: 'Qualified Connected Accounts V4 protocol and daemon client',
    checks: Object.freeze([
      Object.freeze({
        path: 'packages/protocol/src/connect/qualifiedConnectedAccountsV4.ts',
        content: 'export const CONNECTED_ACCOUNT_V4_PROTOCOL_VERSION = 4 as const;',
      }),
      Object.freeze({
        path: 'apps/cli/src/api/client/qualifiedConnectedAccountApi.ts',
        content: 'export async function listQualifiedConnectedAccountsV4',
      }),
    ]),
  }),
  Object.freeze({
    key: 'qualifiedConfigurationKind9',
    label: 'qualified Connected Account configuration cipher envelope kind 9',
    checks: Object.freeze([
      Object.freeze({
        path: 'packages/protocol/src/crypto/accountScopedCipherEnvelope.ts',
        content: 'qualified_connected_account_configuration: 9,',
      }),
    ]),
  }),
  Object.freeze({
    key: 'sessionMetadataLayout1Kind26',
    label: 'Session metadata layout 1 and owner-metadata cipher envelope kind 26',
    checks: Object.freeze([
      Object.freeze({
        path: 'packages/protocol/src/crypto/accountScopedCipherEnvelope.ts',
        content: 'session_owner_metadata: 26,',
      }),
      Object.freeze({
        path: 'packages/protocol/src/sessions/metadata/sessionMetadataSchemasV1.ts',
        content: 'export const SESSION_METADATA_LAYOUT_VERSION_V1 = 1 as const;',
      }),
      Object.freeze({
        path: 'apps/cli/src/session/metadata/sessionMetadataLayout.ts',
        content: 'if (layoutVersion !== SESSION_METADATA_LAYOUT_VERSION_V1) return null;',
      }),
    ]),
  }),
  Object.freeze({
    key: 'publicManagedProviderRuntime',
    label: 'public managed Provider runtime and session-demand custody',
    checks: Object.freeze([
      Object.freeze({
        path: 'apps/cli/src/providers/lifecycle/publicManagedProviderRuntimeStart.ts',
        content: 'export async function startPublicManagedProviderRuntime',
      }),
      Object.freeze({
        path: 'apps/cli/src/daemon/startup/startDaemonSessionControlRuntime.ts',
        content: "'sessionDemand' as const,",
      }),
      Object.freeze({
        path: 'apps/cli/src/providers/lifecycle/managedEndpointRecovery.ts',
        absent: true,
      }),
      Object.freeze({
        path: 'apps/cli/src/providers/discovery/managedStart.ts',
        absent: true,
      }),
    ]),
  }),
]);

const RELEASE_CONFIRMATIONS = new Set([
  'release dev to preview',
  'release preview to main',
  'reset main from preview',
  'release dev to main',
  'reset main from dev',
]);

function formatPresence(presence) {
  return QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_PATHS
    .map(({ provider, label }) => `${label}=${presence[provider] === true}`)
    .join(', ');
}

function resolveUniformPresence(presence, owner) {
  const values = QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_PATHS
    .map(({ provider }) => presence[provider] === true);
  if (!values.every((value) => value === values[0])) {
    throw new Error(
      `[qualified-v4-activation] ${owner} migration set is split-brain: ${formatPresence(presence)}`,
    );
  }
  return values[0] === true;
}

function resolveUniformReadStatePresence(presence, owner) {
  const values = ACCOUNT_SESSION_READ_STATE_BACKFILL_PATHS
    .map(({ provider }) => presence[provider] === true);
  if (!values.every((value) => value === values[0])) {
    const formatted = ACCOUNT_SESSION_READ_STATE_BACKFILL_PATHS
      .map(({ provider, label }) => `${label}=${presence[provider] === true}`)
      .join(', ');
    throw new Error(
      `[read-state-backfill] ${owner} migration set is split-brain: ${formatted}`,
    );
  }
  return values[0] === true;
}

function missingRollbackSupport(support) {
  return QUALIFIED_CONNECTED_ACCOUNTS_V4_ROLLBACK_SUPPORT
    .filter(({ key }) => support?.[key] !== true);
}

function assertRollbackSupportComplete(support, owner) {
  const missing = missingRollbackSupport(support);
  if (missing.length === 0) return;
  throw new Error(
    `[qualified-v4-activation] ${owner} is missing old-daemon rollback support: ` +
    `${missing.map(({ key, label }) => `${key} (${label})`).join(', ')}; ` +
    'old-daemon rollback is prohibited after activation',
  );
}

export function evaluateQualifiedConnectedAccountsV4ActivationAdmission({
  baselinePresence,
  candidatePresence,
  candidateRollbackSupport,
  approved,
  approvalSource,
}) {
  const baselineHasActivation = resolveUniformPresence(baselinePresence, 'deployed baseline');
  const candidateHasActivation = resolveUniformPresence(candidatePresence, 'candidate');
  const common = {
    migration: QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_MIGRATION,
    irreversible: true,
    oldServerRollbackAllowed: false,
    oldDaemonRollbackAllowed: false,
  };

  if (candidateHasActivation) {
    assertRollbackSupportComplete(candidateRollbackSupport, 'candidate');
  }
  if (baselineHasActivation && !candidateHasActivation) {
    throw new Error(
      `[qualified-v4-activation] candidate removes ${QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_MIGRATION}; ` +
      'old-server rollback is prohibited after activation',
    );
  }
  if (!candidateHasActivation) {
    return { status: 'not-present', ...common };
  }
  if (baselineHasActivation) {
    return { status: 'already-activated', ...common };
  }
  if (approved !== true) {
    throw new Error(
      `[qualified-v4-activation] ${QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_MIGRATION} is pending and irreversible. ` +
      'Promotion requires human confirmation that backup/restore readiness was verified and that old-server rollback ' +
      'is prohibited after activation.',
    );
  }

  return {
    status: 'activation-approved',
    ...common,
    approvalSource: String(approvalSource ?? '').trim() || 'unspecified',
  };
}

export function evaluateQualifiedConnectedAccountsV4PayloadPublicationAdmission({
  baselinePresence,
  candidateRollbackSupport,
}) {
  const baselineHasActivation = resolveUniformPresence(
    baselinePresence,
    'deployed baseline',
  );
  const common = {
    migration: QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_MIGRATION,
    irreversible: true,
  };
  if (!baselineHasActivation) {
    return {
      status: 'pre-activation',
      ...common,
      exactPayloadReversionAllowed: true,
      oldServerRollbackAllowed: false,
      oldDaemonRollbackAllowed: false,
    };
  }

  assertRollbackSupportComplete(candidateRollbackSupport, 'candidate payload');
  return {
    status: 'post-activation-compatible',
    ...common,
    exactPayloadReversionAllowed: false,
    oldServerRollbackAllowed: false,
    oldDaemonRollbackAllowed: false,
  };
}

export function evaluateAccountSessionReadStateBackfillAdmission({
  baselinePresence,
  candidatePresence,
  approved,
  approvalSource,
}) {
  const baselineHasBackfill = resolveUniformReadStatePresence(
    baselinePresence,
    'deployed baseline',
  );
  const candidateHasBackfill = resolveUniformReadStatePresence(
    candidatePresence,
    'candidate',
  );
  const common = {
    migration: ACCOUNT_SESSION_READ_STATE_BACKFILL_MIGRATION,
    irreversible: true,
    legacyApiWriterDrainRequired: true,
    oldServerRollbackAllowed: false,
  };

  if (baselineHasBackfill && !candidateHasBackfill) {
    throw new Error(
      `[read-state-backfill] candidate removes ${ACCOUNT_SESSION_READ_STATE_BACKFILL_MIGRATION}; ` +
      'old-server rollback is prohibited after AccountSessionReadState activation',
    );
  }
  if (!candidateHasBackfill) {
    return { status: 'not-present', ...common };
  }
  if (baselineHasBackfill) {
    return { status: 'already-activated', ...common };
  }
  if (approved !== true) {
    throw new Error(
      `[read-state-backfill] ${ACCOUNT_SESSION_READ_STATE_BACKFILL_MIGRATION} is pending and irreversible. ` +
      'The AccountSessionReadState owner backfill cannot run until all legacy API read-state writers are drained, ' +
      'will remain stopped if migration fails, and old-server rollback is prohibited.',
    );
  }

  return {
    status: 'activation-approved',
    ...common,
    approvalSource: String(approvalSource ?? '').trim() || 'unspecified',
  };
}

function takeArg(argv, name, defaultValue = '') {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1).trim();
  const index = argv.indexOf(name);
  return index >= 0 ? String(argv[index + 1] ?? '').trim() : defaultValue;
}

function requireArg(argv, name) {
  const value = takeArg(argv, name);
  if (!value) throw new Error(`[qualified-v4-activation] missing ${name}`);
  return value;
}

function git(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status === 0) return result;
  if (allowFailure) return result;
  const details = String(result.stderr || result.stdout || '').trim();
  throw new Error(
    `[qualified-v4-activation] git ${args.join(' ')} failed with exit ${result.status}` +
    (details ? `: ${details}` : ''),
  );
}

function refExists(repoRoot, ref) {
  return git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    allowFailure: true,
  }).status === 0;
}

function readPresenceAtRef(
  repoRoot,
  ref,
  { allowMissingRef = false, paths = QUALIFIED_CONNECTED_ACCOUNTS_V4_ACTIVATION_PATHS } = {},
) {
  if (!refExists(repoRoot, ref)) {
    if (!allowMissingRef) {
      throw new Error(`[qualified-v4-activation] Git ref does not exist: ${ref}`);
    }
    return Object.fromEntries(
      paths.map(({ provider }) => [provider, false]),
    );
  }
  return Object.fromEntries(
    paths.map(({ provider, path }) => [
      provider,
      git(repoRoot, ['cat-file', '-e', `${ref}:${path}`], { allowFailure: true }).status === 0,
    ]),
  );
}

function readRollbackSupportAtRef(repoRoot, ref, { allowMissingRef = false } = {}) {
  if (!refExists(repoRoot, ref)) {
    if (!allowMissingRef) {
      throw new Error(`[qualified-v4-activation] Git ref does not exist: ${ref}`);
    }
    return Object.fromEntries(
      QUALIFIED_CONNECTED_ACCOUNTS_V4_ROLLBACK_SUPPORT
        .map(({ key }) => [key, false]),
    );
  }

  const contentByPath = new Map();
  const readPath = (path) => {
    if (contentByPath.has(path)) return contentByPath.get(path);
    const result = git(repoRoot, ['show', `${ref}:${path}`], { allowFailure: true });
    const content = result.status === 0 ? String(result.stdout) : null;
    contentByPath.set(path, content);
    return content;
  };
  return Object.fromEntries(
    QUALIFIED_CONNECTED_ACCOUNTS_V4_ROLLBACK_SUPPORT.map(({ key, checks }) => [
      key,
      checks.every(({ path, content, absent }) => {
        const source = readPath(path);
        return absent === true
          ? source === null
          : source?.includes(content) === true;
      }),
    ]),
  );
}

function resolveApproval(argv) {
  const kind = requireArg(argv, '--approval-kind');
  const value = takeArg(argv, '--approval-value');
  if (kind === 'release-confirm') {
    return {
      approved: RELEASE_CONFIRMATIONS.has(value),
      source: value ? `release-confirm: ${value}` : 'release-confirm: <missing>',
    };
  }
  if (kind === 'explicit-checkbox') {
    return {
      approved: value === 'true',
      source: 'promote-server explicit irreversible migration approval',
    };
  }
  throw new Error(`[qualified-v4-activation] unsupported --approval-kind: ${kind}`);
}

function renderSummary(result, { baselineRef, candidateRef, admissionKind }) {
  const approval = result.status === 'activation-approved'
    ? `\n- approval record: \`${result.approvalSource}\``
    : '';
  const rollback = result.status === 'pre-activation'
    ? [
        '- exact local payload reversion is admitted before activation: `true`',
        '- old-server semantic rollback allowed: `false`',
        '- old-daemon semantic rollback allowed: `false`',
      ]
    : [
        '- old-server rollback allowed after activation: `false`',
        '- old-daemon rollback allowed after activation: `false`',
      ];
  return [
    admissionKind === 'payload-publication'
      ? '### Qualified Connected Accounts V4 payload publication admission'
      : '### Qualified Connected Accounts V4 migration admission',
    '',
    `- migration: \`${result.migration}\``,
    `- deployed baseline: \`${baselineRef}\``,
    `- candidate: \`${candidateRef}\``,
    `- status: \`${result.status}\``,
    '- irreversible: `true`',
    ...rollback,
    approval,
    '',
  ].filter((line) => line !== '').join('\n') + '\n';
}

function renderReadStateSummary(result, { baselineRef, candidateRef }) {
  const approval = result.status === 'activation-approved'
    ? `\n- approval record: \`${result.approvalSource}\``
    : '';
  return [
    '### AccountSessionReadState backfill admission',
    '',
    `- migration: \`${result.migration}\``,
    `- deployed baseline: \`${baselineRef}\``,
    `- candidate: \`${candidateRef}\``,
    `- status: \`${result.status}\``,
    '- irreversible: `true`',
    '- legacy API read-state writers drained before backfill: `required`',
    '- old-server rollback allowed after activation: `false`',
    approval,
    '',
  ].filter((line) => line !== '').join('\n') + '\n';
}

export async function runQualifiedConnectedAccountsV4ActivationAdmission(argv = process.argv.slice(2)) {
  const repoRoot = resolve(takeArg(argv, '--repo-root', '.'));
  const baselineRef = requireArg(argv, '--baseline-ref');
  const candidateRef = requireArg(argv, '--candidate-ref');
  const summaryFile = takeArg(argv, '--summary-file');
  const admissionKind = takeArg(argv, '--admission-kind', 'activation');
  const baselinePresence = readPresenceAtRef(
    repoRoot,
    baselineRef,
    { allowMissingRef: true },
  );
  const candidateRollbackSupport = readRollbackSupportAtRef(
    repoRoot,
    candidateRef,
  );
  let result;
  let additionalSummary = '';
  if (admissionKind === 'payload-publication') {
    result = evaluateQualifiedConnectedAccountsV4PayloadPublicationAdmission({
      baselinePresence,
      candidateRollbackSupport,
    });
  } else if (admissionKind === 'activation') {
    const approval = resolveApproval(argv);
    result = evaluateQualifiedConnectedAccountsV4ActivationAdmission({
      baselinePresence,
      candidatePresence: readPresenceAtRef(repoRoot, candidateRef),
      candidateRollbackSupport,
      approved: approval.approved,
      approvalSource: approval.source,
    });
    const readStateResult = evaluateAccountSessionReadStateBackfillAdmission({
      baselinePresence: readPresenceAtRef(repoRoot, baselineRef, {
        allowMissingRef: true,
        paths: ACCOUNT_SESSION_READ_STATE_BACKFILL_PATHS,
      }),
      candidatePresence: readPresenceAtRef(repoRoot, candidateRef, {
        paths: ACCOUNT_SESSION_READ_STATE_BACKFILL_PATHS,
      }),
      approved: approval.approved,
      approvalSource: approval.source,
    });
    additionalSummary = renderReadStateSummary(readStateResult, {
      baselineRef,
      candidateRef,
    });
  } else {
    throw new Error(
      `[qualified-v4-activation] unsupported --admission-kind: ${admissionKind}`,
    );
  }
  const summary = renderSummary(result, {
    baselineRef,
    candidateRef,
    admissionKind,
  }) + additionalSummary;
  process.stdout.write(summary);
  if (summaryFile) await appendFile(summaryFile, summary, 'utf8');
  return result;
}

const invokedAsMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsMain) {
  runQualifiedConnectedAccountsV4ActivationAdmission().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
