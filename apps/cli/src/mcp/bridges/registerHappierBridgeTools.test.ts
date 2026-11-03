import { describe, expect, it, vi } from 'vitest';
import { forwardHappierBridgeTool } from './registerHappierBridgeTools';

describe('forwardHappierBridgeTool', () => {
  it('returns an MCP error result when the authoritative remote invocation fails', async () => {
    await expect(forwardHappierBridgeTool('acme_review_start', {}, undefined, async () => {
      throw new Error('remote disconnected');
    })).resolves.toEqual({
      content: [{
        type: 'text',
        text: 'Failed to call tool acme_review_start: remote disconnected',
      }],
      isError: true,
    });
  });

  it('forwards the MCP request abort signal to the authoritative remote invocation', async () => {
    const callHttpTool = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      isError: false,
    }));

    const controller = new AbortController();
    await forwardHappierBridgeTool('acme_review_start', {}, { signal: controller.signal }, callHttpTool);

    expect(callHttpTool).toHaveBeenCalledWith(
      'acme_review_start',
      {},
      { signal: controller.signal },
    );
  });

  it('does not convert an aborted remote invocation into an ordinary tool failure', async () => {
    const abortError = new DOMException('The request was aborted', 'AbortError');
    const controller = new AbortController();
    controller.abort();

    await expect(
      forwardHappierBridgeTool('acme_review_start', {}, { signal: controller.signal }, async () => {
        throw abortError;
      }),
    ).rejects.toBe(abortError);
  });

  it('forwards requested MCP progress across the bridge', async () => {
    const callHttpTool = vi.fn(async (_name: string, _args: unknown, options?: {
      onprogress?: (progress: { progress: number }) => void;
    }) => {
      options?.onprogress?.({ progress: 1 });
      return { content: [{ type: 'text' as const, text: 'ok' }], isError: false };
    });

    const sendNotification = vi.fn(async () => undefined);
    await forwardHappierBridgeTool('long_running', {}, {
      _meta: { progressToken: 'progress-1', callId: 'codex-native-call', 'claudecode/toolUseId': 'claude-native-call' },
      sendNotification,
    }, callHttpTool);

    expect(callHttpTool).toHaveBeenCalledWith('long_running', {}, expect.objectContaining({
      requestMetadata: { progressToken: 'progress-1', callId: 'codex-native-call', 'claudecode/toolUseId': 'claude-native-call' },
    }));
    expect(sendNotification).toHaveBeenCalledWith({
      method: 'notifications/progress',
      params: { progressToken: 'progress-1', progress: 1 },
    });
  });
});
