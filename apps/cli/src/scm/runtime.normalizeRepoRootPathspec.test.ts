import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { normalizeRepoRootPathspec, normalizeRepoRootRelativePath } from './runtime';

describe('normalizeRepoRootPathspec', () => {
    it.skipIf(process.platform === 'win32')('preserves leading and trailing filename whitespace', () => {
        const cwd = mkdtempSync(join(tmpdir(), 'happier-whitespace-pathspec-'));
        const filename = ' leading\t\n';
        try {
            execFileSync('git', ['init'], { cwd, stdio: 'pipe' });
            writeFileSync(join(cwd, filename), 'selected');
            writeFileSync(join(cwd, 'leading'), 'unrelated');
            execFileSync('git', ['add', '.'], { cwd, stdio: 'pipe' });
            const result = normalizeRepoRootRelativePath(filename);
            expect(result.ok).toBe(true);
            if (!result.ok) throw new Error(result.error);
            expect(result.relativePath).toBe(filename);
            expect(execFileSync('git', ['ls-files', '-z', '--', result.pathspec], { cwd, encoding: 'utf8' }))
                .toBe(`${filename}\0`);
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });

    it('anchors repo-root-relative paths using git pathspec magic', () => {
        const result = normalizeRepoRootPathspec('src/a.ts');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.pathspec).toBe(':(top)src/a.ts');
    });

    it('returns the repo-root-relative path for safe filesystem operations', () => {
        const result = normalizeRepoRootRelativePath('src/a.ts');
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.relativePath).toBe('src/a.ts');
        expect(result.pathspec).toBe(':(top)src/a.ts');
    });

    it('rejects pathspec magic injection', () => {
        const result = normalizeRepoRootRelativePath(':(exclude)a.ts');
        expect(result.ok).toBe(false);
    });

    it('rejects .. segments', () => {
        const result = normalizeRepoRootRelativePath('../a.ts');
        expect(result.ok).toBe(false);
    });
});
