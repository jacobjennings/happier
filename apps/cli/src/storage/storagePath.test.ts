import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readStoragePathIdentity } from './trash/removeStoragePath';
import { classifyPath } from './protection/protectedPaths';
import { createStoragePathComparator, createStoragePathIndex, storagePathContains, storagePathsEqual } from './storagePath';

it.each(['linux', 'darwin', 'win32'] as const)('indexes native ancestry with the canonical comparator on %s', platform => {
    const paths = platform === 'win32' ? [
        'C:\\Users\\Alice\\project', 'c:/users/alice/project/nested', 'C:\\Users\\Alice\\project2',
        'C:\\Users\\Alice\\project\\nested\\cache', 'D:\\Users\\Alice\\project', '\\\\server\\share\\project', 'c:/USERS/ALICE/PROJECT',
    ] : ['/people/alice/project', '/people/alice/project/nested', '/people/alice/project2',
        '/people/alice/project/nested/cache', '/people/alice/other', '/people/Alice/project'];
    const items = paths.map((path, index) => ({ path, index }));
    const index = createStoragePathIndex(items, item => item.path, platform);
    const compare = createStoragePathComparator(platform);
    for (const path of [...paths, ...paths.map(path => `${path}/child`), platform === 'win32' ? 'c:/users/alice' : '/people/alice',
        platform === 'win32' ? '\\\\SERVER/share' : '/', platform === 'win32' ? 'C:\\' : '/unrelated']) {
        expect(index.exact(path)).toEqual(items.find(item => compare.equal(item.path, path)));
        expect(index.ancestors(path)).toEqual(items.filter(item => compare.contains(item.path, path)));
        expect(index.descendants(path)).toEqual(items.filter(item => !compare.equal(item.path, path) && compare.contains(path, item.path)));
        expect(index.hasAncestor(path)).toBe(items.some(item => compare.contains(item.path, path)));
        expect(index.hasDescendant(path)).toBe(items.some(item => compare.contains(path, item.path)));
        expect(index.overlaps(path)).toBe(items.some(item => compare.contains(item.path, path) || compare.contains(path, item.path)));
    }
});

it('keeps empty ancestry reads empty', () => {
    const index = createStoragePathIndex<string>([], path => path);
    const path = join(tmpdir(), 'absent-storage-item');
    expect(index.exact(path)).toBeUndefined();
    expect(index.ancestors(path)).toEqual([]);
    expect(index.descendants(path)).toEqual([]);
    expect(index.hasAncestor(path)).toBe(false);
    expect(index.hasDescendant(path)).toBe(false);
    expect(index.overlaps(path)).toBe(false);
});

it.skipIf(process.platform === 'win32')('indexes byte paths and UTF-8 ancestors without merging a replacement spelling', () => {
    const raw = Buffer.concat([Buffer.from('/projects/'), Buffer.from([0xff])]);
    const path = `bytes:${raw.toString('base64')}`;
    const child = `bytes:${Buffer.concat([raw, Buffer.from('/cache')]).toString('base64')}`;
    const paths = [child, '/projects', raw.toString('utf8'), path, '/projects2'];
    const index = createStoragePathIndex(paths, path => path);
    const compare = createStoragePathComparator();
    for (const candidate of [...paths, '/']) {
        expect(index.exact(candidate)).toBe(paths.find(path => compare.equal(path, candidate)));
        expect(index.ancestors(candidate)).toEqual(paths.filter(path => compare.contains(path, candidate)));
        expect(index.descendants(candidate)).toEqual(paths.filter(path => !compare.equal(path, candidate) && compare.contains(candidate, path)));
    }
});

it.each(['linux', 'darwin', 'win32'] as const)('keeps per-read comparisons equivalent on %s', platform => {
    const compare = createStoragePathComparator(platform);
    const pairs = platform === 'win32' ? [
        ['C:\\Users\\Alice', 'c:/users/alice/project'],
        ['C:\\Users\\Alice', 'C:\\Users\\Alice2\\project'],
        ['C:\\Users\\Alice', 'D:\\Users\\Alice'],
        ['\\\\server\\share', '//SERVER/share/project'],
    ] : [['/home/alice', '/home/alice/../alice/project'], ['/home/alice', '/home/alice2'], ['/home/Alice', '/home/alice']];
    for (const [root, child] of pairs) {
        expect(compare.equal(root, child)).toBe(storagePathsEqual(root, child, platform));
        expect(compare.contains(root, child)).toBe(storagePathContains(root, child, platform));
        expect(compare.contains(child, root)).toBe(storagePathContains(child, root, platform));
    }
});

it.skipIf(process.platform === 'win32')('reads and protects the actual POSIX byte path rather than its UTF replacement spelling', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'happier-storage-byte-path-')));
    const bytes = Buffer.concat([Buffer.from(`${root}/`), Buffer.from([0xff]), Buffer.from('-private')]);
    const path = `bytes:${bytes.toString('base64')}`;
    const twin = bytes.toString('utf8');
    try {
        await mkdir(bytes); await mkdir(twin);
        await writeFile(Buffer.concat([bytes, Buffer.from('/exact')]), 'exact');
        const identity = await readStoragePathIdentity(path);
        expect(identity.ino).toBe(String((await lstat(bytes, { bigint: true })).ino));
        expect(identity.ino).not.toBe(String((await lstat(twin, { bigint: true })).ino));
        const child = `bytes:${Buffer.concat([bytes, Buffer.from('/exact')]).toString('base64')}`;
        const compare = createStoragePathComparator();
        expect(compare.contains(path, child)).toBe(true);
        expect(compare.equal(path, twin)).toBe(false);
        expect(compare.contains(twin, child)).toBe(false);
        expect(await classifyPath(child, { homeDir: root, userProtectedFolders: [path] }))
            .toMatchObject({ tier: 'keep', reason: { code: 'user_protected' } });
        expect((await classifyPath(twin, { homeDir: root, userProtectedFolders: [path] })).tier).not.toBe('keep');
        const hidden = Buffer.concat([Buffer.from(`${root}/.`), Buffer.from([0xff]), Buffer.from('-state')]);
        await mkdir(hidden);
        expect(await classifyPath(`bytes:${hidden.toString('base64')}`, { homeDir: root }))
            .toMatchObject({ tier: 'caution', reason: { code: 'not_rebuildable', detail: { hiddenFolder: true } } });
    } finally { await rm(root, { recursive: true, force: true }); }
});
