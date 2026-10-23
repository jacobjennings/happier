import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { resolveUiWebBeforeAllTimeoutMs, startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { fakeClaudeFixturePath, readFakeClaudeLogEvents, waitForFakeClaudeInvocation, waitForFakeClaudeUserText } from '../../src/testkit/fakeClaude';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { createSessionFromNewSessionComposer } from '../../src/testkit/uiE2e/createSessionFromNewSessionComposer';
import { mutateUiE2eScopedAccountSettings } from '../../src/testkit/uiE2e/scopedAccountSettingsStorage';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { waitForDaemonMachineIdFromCliSettings } from '../../src/testkit/uiE2e/daemonMachineId';
import { appendBrowserDiagnostics, collectBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';

const run = createRunDirs({ runLabel: 'ui-e2e' });

test.describe('ui e2e: Pending until ready with immediate steering', () => {
  const suiteDir = run.testDir('pending-immediate-steer-suite');
  const cliHomeDir = resolve(join(suiteDir, 'cli-home'));

  let server: StartedServer | null = null;
  let ui: StartedUiWeb | null = null;
  let uiBaseUrl: string | null = null;
  let daemon: StartedDaemon | null = null;

  test.beforeAll(async () => {
    test.setTimeout(resolveUiWebBeforeAllTimeoutMs(process.env));
    await mkdir(cliHomeDir, { recursive: true });
    await writeFile(resolve(join(cliHomeDir, 'AGENTS.md')), '# UI e2e fixture\n', 'utf8');

    server = await startServerLight({
      testDir: suiteDir,
      dbProvider: 'sqlite',
      extraEnv: {
        HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
        HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
        HAPPIER_FEATURE_ENCRYPTION__STORAGE_POLICY: 'plaintext_only',
        HAPPIER_E2E_PROVIDER_SKIP_SERVER_SHARED_DEPS_BUILD: '1',
      },
    });

    ui = await startUiWeb({
      testDir: suiteDir,
      env: {
        ...process.env,
        EXPO_PUBLIC_DEBUG: '1',
        EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
        EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
      },
    });

    uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await daemon?.stop().catch(() => {});
    await ui?.stop().catch(() => {});
    await server?.stop().catch(() => {});
  });

  test('steers a web message during an open Claude SDK turn with Pending until ready', async ({ page }) => {
    test.setTimeout(180_000);
    if (!server || !uiBaseUrl) throw new Error('missing server/ui fixtures');
    const browserDiagnostics = collectBrowserDiagnostics({ page });
    try {
      const fakeClaudeLogPath = resolve(suiteDir, 'fake-claude.jsonl');
      await page.setViewportSize({ width: 1440, height: 900 });
      daemon = await authenticateAndStartDaemon({
        page,
        testDir: suiteDir,
        cliHomeDir,
        serverUrl: server.baseUrl,
        uiBaseUrl,
        extraEnv: {
          ...process.env,
          HOME: cliHomeDir,
          HAPPIER_CLAUDE_PATH: fakeClaudeFixturePath(),
          HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeClaudeLogPath,
          HAPPIER_E2E_FAKE_CLAUDE_SESSION_ID: `fake-claude-steer-${run.runId}`,
          HAPPIER_E2E_FAKE_CLAUDE_SCENARIO: 'in-flight-steer',
        },
      });
      await mutateUiE2eScopedAccountSettings({
        page,
        settingsPatch: {
          sessionMessageSendMode: 'server_pending',
          sessionBusySteerSendPolicy: 'steer_immediately',
          claudeUnifiedTerminalEnabled: false,
        },
        featureToggles: { 'providers.claude.unifiedTerminal': false },
      });
      // Reload so the real composer consumes the persisted account settings.
      await gotoDomContentLoadedWithRetries(page, uiBaseUrl);
      const machineId = await waitForDaemonMachineIdFromCliSettings({ cliHomeDir, timeoutMs: 120_000 });
      const firstPrompt = `keep this turn open ${run.runId}`;
      const { sessionId } = await createSessionFromNewSessionComposer({ page, uiBaseUrl, machineId, prompt: firstPrompt });
      await waitForFakeClaudeInvocation(fakeClaudeLogPath, (event) => event.mode === 'sdk');
      await expect(page.getByTestId('transcript-chat-list')).toContainText('FAKE_CLAUDE_TURN_OPEN', { timeout: 120_000 });

      const secondPrompt = `steer the running turn ${run.runId}`;
      const enqueueResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/v2/sessions/${sessionId}/pending`,
      );
      const composer = page.locator('textarea[data-testid="session-composer-input"]:visible').first();
      await composer.fill(secondPrompt);
      await page.getByTestId('session-composer-send').click();
      const response = await enqueueResponse;
      expect(response.ok()).toBe(true);
      expect(response.request().postDataJSON()).toMatchObject({
        requestedAction: { v: 1, kind: 'steer_if_active' },
      });
      await waitForFakeClaudeUserText(fakeClaudeLogPath, (text) => text.includes(secondPrompt));
      await expect(page.getByTestId('transcript-chat-list')).toContainText('FAKE_CLAUDE_STEER_RECEIVED', { timeout: 120_000 });

      // The fixture emits no result until the second prompt reaches the same SDK process.
      // A queued next-turn message cannot satisfy this scenario.
      const events = await readFakeClaudeLogEvents(fakeClaudeLogPath);
      const firstInputIndex = events.findIndex((event) => event.type === 'sdk_stdin' && String(event.userTextPreview).includes(firstPrompt));
      const steerInputIndex = events.findIndex((event) => event.type === 'sdk_stdin' && String(event.userTextPreview).includes(secondPrompt));
      expect(firstInputIndex).toBeGreaterThanOrEqual(0);
      expect(steerInputIndex).toBeGreaterThan(firstInputIndex);
      expect(events[steerInputIndex]?.invocationId).toBe(events[firstInputIndex]?.invocationId);
      expect(events.slice(firstInputIndex, steerInputIndex).filter((event) =>
        event.type === 'sdk_stdout' && event.messageType === 'result',
      )).toHaveLength(0);
      expect(events.filter((event) => event.type === 'sdk_stdin' && event.controlSubtype === 'interrupt')).toHaveLength(0);
    } catch (error) {
      throw appendBrowserDiagnostics(error, browserDiagnostics());
    }
  });
});
