import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('tests workflow includes self-host + daemon E2E gate and runs real integration harness', async () => {
  const raw = await readFile(join(repoRoot, '.github', 'workflows', 'tests.yml'), 'utf8');

  assert.match(raw, /run_self_host_daemon:/, 'tests.yml should define run_self_host_daemon input');
  // The explicit-selection gate of self-host-daemon-e2e is owned by
  // tests_workflow.reusable_run_flags.contract.test.mjs (exact parsed `if`).
  assert.match(
    raw,
    /node\s+--test\s+apps\/stack\/scripts\/self_host_daemon\.real\.integration\.test\.mjs/,
    'self-host daemon e2e should execute the real integration test harness',
  );
});
