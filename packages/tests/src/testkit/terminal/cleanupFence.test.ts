import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateTerminalCleanupSourceTree, validateTerminalCompatibilitySunsetPolicy } from './cleanupFence';

describe('terminal cleanup source-tree fence', () => {
  it('passes the canonical source tree while allowing only the named release-window schema', () => {
    expect(validateTerminalCleanupSourceTree()).toEqual([]);
  });

  it('is wired into the canonical policy lane', () => {
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['test:policy']).toContain('packages/tests/src/testkit/terminal/cleanupFence.ts');
  });

  it('requires a named compatibility release and distinct removal release', () => {
    expect(validateTerminalCompatibilitySunsetPolicy()).toEqual([]);
  });

  it('fails closed when the app reaches the removal release while legacy compatibility remains', () => {
    expect(validateTerminalCompatibilitySunsetPolicy('0.3.0')).toEqual([
      expect.objectContaining({ rule: 'legacy-sunset-policy' }),
    ]);
  });
});
