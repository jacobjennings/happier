import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { RequestMeta } from '@modelcontextprotocol/sdk/types.js';

import { configuration } from '@/configuration';

const MAX_SAFE_NODE_TIMEOUT_MS = 2_147_000_000;
const EXECUTION_RUN_START_TOOL_NAME = 'execution_run_start';
const EXECUTION_RUN_WAIT_TOOL_NAME = 'execution_run_wait';

type McpCallToolClient = Pick<Client, 'callTool'>;

function normalizeMcpToolArguments(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
  return args as Record<string, unknown>;
}

function isExecutionRunWaitToolName(toolName: string): boolean {
  return toolName === EXECUTION_RUN_WAIT_TOOL_NAME || toolName.endsWith(`__${EXECUTION_RUN_WAIT_TOOL_NAME}`);
}

function isExecutionRunStartToolName(toolName: string): boolean {
  return toolName === EXECUTION_RUN_START_TOOL_NAME || toolName.endsWith(`__${EXECUTION_RUN_START_TOOL_NAME}`);
}

function readTimeoutSeconds(args: unknown): number | null {
  const record = normalizeMcpToolArguments(args);
  const timeoutSeconds = record?.timeoutSeconds;
  if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return null;
  }
  return timeoutSeconds;
}

function readObservationTimeoutSeconds(toolName: string, args: unknown): number | null {
  if (toolName !== 'wait' && !toolName.endsWith('__wait')) return null;
  const timeout = normalizeMcpToolArguments(normalizeMcpToolArguments(args)?.timeout);
  const durationMs = timeout?.durationMs;
  return typeof durationMs === 'number' && Number.isSafeInteger(durationMs) && durationMs > 0
    ? durationMs / 1000 : null;
}

function readExecutionRunStartWaitTimeoutSeconds(args: unknown): number | null {
  const record = normalizeMcpToolArguments(args);
  if (record?.waitForCompletion !== true) return null;
  const timeoutSeconds = record.waitTimeoutSeconds;
  if (typeof timeoutSeconds !== 'number' || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return null;
  }
  return timeoutSeconds;
}

function resolveMcpToolCallDefaultTimeoutMs(): number {
  return configuration.mcpToolCallTimeoutMs;
}

function resolveExecutionRunWaitMcpTimeoutGraceMs(): number {
  return configuration.mcpExecutionRunWaitTimeoutGraceMs;
}

export function resolveMcpToolCallRequestTimeoutMs(params: Readonly<{
  toolName: string;
  args: unknown;
}>): number {
  const timeoutSeconds = isExecutionRunWaitToolName(params.toolName)
    ? readTimeoutSeconds(params.args)
    : isExecutionRunStartToolName(params.toolName)
      ? readExecutionRunStartWaitTimeoutSeconds(params.args)
      : readObservationTimeoutSeconds(params.toolName, params.args);
  if (timeoutSeconds != null) {
    const requestedWaitMs = Math.max(1, Math.floor(timeoutSeconds * 1_000));
    return Math.min(
      requestedWaitMs + resolveExecutionRunWaitMcpTimeoutGraceMs(),
      MAX_SAFE_NODE_TIMEOUT_MS,
    );
  }
  return resolveMcpToolCallDefaultTimeoutMs();
}

export async function callMcpToolWithResolvedTimeout(params: Readonly<{
  client: McpCallToolClient;
  toolName: string;
  args: unknown;
  signal?: AbortSignal;
  requestMetadata?: RequestMeta;
  onprogress?: RequestOptions['onprogress'];
}>): ReturnType<Client['callTool']> {
  return await params.client.callTool(
    {
      name: params.toolName,
      arguments: normalizeMcpToolArguments(params.args),
      ...(params.requestMetadata === undefined ? {} : { _meta: params.requestMetadata }),
    },
    undefined,
    {
      timeout: resolveMcpToolCallRequestTimeoutMs({ toolName: params.toolName, args: params.args }),
      ...(params.signal === undefined ? {} : { signal: params.signal }),
      ...(params.onprogress === undefined ? {} : {
        onprogress: params.onprogress,
        resetTimeoutOnProgress: true,
      }),
    },
  );
}
