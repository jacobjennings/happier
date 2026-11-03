import { realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, win32 } from 'node:path';
import { canonicalAbsolutePathsEqual, createCanonicalAbsolutePathComparator, isCanonicalAbsolutePathInsideRoot, resolveCanonicalAbsolutePath } from '@happier-dev/cli-common/path';
import { realpathWithAbsentSuffix } from '@/utils/path/physicalAncestorPath';

/** Native disk IDs carry non-UTF8 POSIX paths losslessly; display names are never filesystem authority. */
export function storagePathToFs(path: string): string | Buffer {
    if (!path.startsWith('bytes:')) return path;
    const encoded = path.slice(6);
    const bytes = Buffer.from(encoded, 'base64');
    if (process.platform === 'win32' || !encoded || bytes.toString('base64') !== encoded
        || bytes[0] !== 47 || bytes.includes(0)) {
        throw Object.assign(new Error('Invalid native byte path'), { code: 'invalid_storage_path' });
    }
    return bytes;
}
export function storagePathFromBytes(bytes: Buffer): string {
    const text = bytes.toString('utf8');
    return Buffer.from(text).equals(bytes) ? text : `bytes:${bytes.toString('base64')}`;
}
export function storageAbsolutePath(path: string): string {
    const decoded = storagePathToFs(path);
    if (typeof decoded === 'string') return resolve(decoded);
    const parts: Buffer[] = [];
    let start = 1;
    for (let index = 1; index <= decoded.length; index += 1) {
        if (index < decoded.length && decoded[index] !== 47) continue;
        const part = decoded.subarray(start, index); start = index + 1;
        if (!part.length || part.equals(Buffer.from('.'))) continue;
        if (part.equals(Buffer.from('..'))) parts.pop(); else parts.push(part);
    }
    return storagePathFromBytes(Buffer.concat([Buffer.from('/'), ...parts.flatMap((part, index) => index ? [Buffer.from('/'), part] : [part])]));
}
export function storagePathDirname(path: string): string {
    const decoded = storagePathToFs(path);
    if (typeof decoded === 'string') return dirname(decoded);
    const absolute = storagePathToFs(storageAbsolutePath(path));
    if (typeof absolute === 'string') return dirname(absolute);
    const slash = absolute.lastIndexOf(47);
    return storagePathFromBytes(absolute.subarray(0, Math.max(1, slash)));
}
/** Actual leaf, unlike the explicitly display-only basename below. */
export function storagePathLeaf(path: string): string | Buffer {
    const decoded = storagePathToFs(path);
    return typeof decoded === 'string' ? basename(decoded) : decoded.subarray(decoded.lastIndexOf(47) + 1);
}
export function storagePathBasename(path: string): string { return storagePathLeaf(path).toString(); }
export function storagePathJoin(root: string, ...parts: readonly (string | Buffer)[]): string {
    const decoded = storagePathToFs(root);
    if (typeof decoded === 'string' && parts.every(part => typeof part === 'string')) return join(decoded, ...parts as string[]);
    const bytes = Buffer.concat([typeof decoded === 'string' ? Buffer.from(decoded) : decoded,
        ...parts.flatMap(part => [Buffer.from('/'), typeof part === 'string' ? Buffer.from(part) : part])]);
    return storageAbsolutePath(storagePathFromBytes(bytes));
}
export function storagePathsEqual(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
    if (!left.startsWith('bytes:') && !right.startsWith('bytes:')) return canonicalAbsolutePathsEqual(left, right);
    const bytes = (path: string) => { const value = storagePathToFs(storageAbsolutePath(path)); return typeof value === 'string' ? Buffer.from(value) : value; };
    return bytes(left).equals(bytes(right));
}
export function storagePathContains(parent: string, child: string, platform: NodeJS.Platform = process.platform): boolean {
    if (!parent.startsWith('bytes:') && !child.startsWith('bytes:')) return storagePathsEqual(parent, child, platform)
        || isCanonicalAbsolutePathInsideRoot(parent, child, { platform });
    const bytes = (path: string) => { const value = storagePathToFs(storageAbsolutePath(path)); return typeof value === 'string' ? Buffer.from(value) : value; };
    const root = bytes(parent); const path = bytes(child);
    return root.equals(path) || path.subarray(0, root.length).equals(root) && (root.length === 1 || path[root.length] === 47);
}
/** Per-read lexical reuse; native byte paths keep their existing lossless comparator. */
export function createStoragePathComparator(platform: NodeJS.Platform = process.platform) {
    const identity = createCanonicalAbsolutePathComparator();
    const containment = createCanonicalAbsolutePathComparator({ platform });
    return {
        equal(left: string, right: string): boolean {
            return left.startsWith('bytes:') || right.startsWith('bytes:')
                ? storagePathsEqual(left, right, platform) : identity.equal(left, right);
        },
        contains(parent: string, child: string): boolean {
            return parent.startsWith('bytes:') || child.startsWith('bytes:')
                ? storagePathContains(parent, child, platform) : identity.equal(parent, child) || containment.contains(parent, child);
        },
    };
}
export type StoragePathComparator = ReturnType<typeof createStoragePathComparator>;

/** A read-local ancestry join, using the same canonical spelling and lossless byte-path owner. */
export function createStoragePathIndex<T>(items: readonly T[], pathOf: (item: T) => string,
    platform: NodeJS.Platform = process.platform) {
    type Entry = { item: T; order: number };
    type Branch = { entries: Entry[]; children: Map<string, Branch> };
    const branch = (): Branch => ({ entries: [], children: new Map() });
    const root = branch();
    const paths = new Map<string, readonly string[]>();
    const segments = (path: string): readonly string[] => {
        const cached = paths.get(path);
        if (cached) return cached;
        let parts: string[];
        if (platform === 'win32' && !path.startsWith('bytes:')) {
            const canonical = resolveCanonicalAbsolutePath(path, { platform });
            if (!canonical) throw Object.assign(new Error('Storage path must be absolute'), { code: 'invalid_storage_path' });
            const volume = win32.parse(canonical.comparisonKey).root;
            parts = [`win32:${volume}`, ...canonical.comparisonKey.slice(volume.length).split(win32.sep).filter(Boolean)];
        } else {
            const canonical = path.startsWith('bytes:') ? storageAbsolutePath(path)
                : resolveCanonicalAbsolutePath(path, { platform })?.path;
            if (!canonical) throw Object.assign(new Error('Storage path must be absolute'), { code: 'invalid_storage_path' });
            const decoded = storagePathToFs(canonical);
            const bytes = typeof decoded === 'string' ? Buffer.from(decoded) : decoded;
            parts = ['posix:/'];
            let start = 1;
            for (let index = 1; index <= bytes.length; index++) {
                if (index < bytes.length && bytes[index] !== 47) continue;
                if (index > start) parts.push(bytes.subarray(start, index).toString('hex'));
                start = index + 1;
            }
        }
        paths.set(path, parts); return parts;
    };
    for (const [order, item] of items.entries()) {
        let node = root;
        for (const segment of segments(pathOf(item))) {
            let child = node.children.get(segment);
            if (!child) { child = branch(); node.children.set(segment, child); }
            node = child;
        }
        node.entries.push({ item, order });
    }
    const find = (path: string) => {
        let node: Branch | undefined = root;
        for (const segment of segments(path)) { node = node.children.get(segment); if (!node) break; }
        return node;
    };
    const ordered = (entries: Entry[]) => entries.sort((left, right) => left.order - right.order).map(entry => entry.item);
    const hasAncestor = (path: string): boolean => {
        let node = root;
        for (const segment of segments(path)) {
            const child = node.children.get(segment); if (!child) return false;
            node = child; if (node.entries.length) return true;
        }
        return false;
    };
    return {
        exact(path: string): T | undefined { return find(path)?.entries[0]?.item; },
        ancestors(path: string): T[] {
            const entries: Entry[] = []; let node = root;
            for (const segment of segments(path)) {
                const child = node.children.get(segment); if (!child) break;
                node = child;
                for (const entry of node.entries) entries.push(entry);
            }
            return ordered(entries);
        },
        descendants(path: string): T[] {
            const node = find(path); if (!node) return [];
            const entries: Entry[] = []; const pending = [...node.children.values()];
            for (const child of pending) {
                for (const entry of child.entries) entries.push(entry);
                for (const next of child.children.values()) pending.push(next);
            }
            return ordered(entries);
        },
        hasAncestor,
        /** Whether an indexed path is at or beneath this path (without walking that subtree). */
        hasDescendant(path: string): boolean { return find(path) !== undefined; },
        overlaps(path: string): boolean { return hasAncestor(path) || find(path) !== undefined; },
    };
}
export async function realStoragePathWithAbsentSuffix(path: string): Promise<string> {
    const decoded = storagePathToFs(path);
    if (typeof decoded === 'string') return realpathWithAbsentSuffix(decoded);
    try { return storagePathFromBytes(await realpath(decoded, { encoding: 'buffer' })); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        const parent = storagePathDirname(path);
        if (storagePathsEqual(parent, path)) throw error;
        return storagePathJoin(await realStoragePathWithAbsentSuffix(parent), storagePathLeaf(path));
    }
}
export async function physicalStoragePathWithoutFollowingLeaf(path: string): Promise<string> {
    return (await physicalStoragePathsWithoutFollowingLeaf([path])).get(path)!;
}

/** One observation resolves each shared parent once; every subsequent observation reads it afresh. */
export async function physicalStoragePathsWithoutFollowingLeaf(paths: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const parents = new Map<string, string[]>();
    for (const path of new Set(paths)) {
        const parent = storagePathDirname(path);
        const siblings = parents.get(parent) ?? [];
        siblings.push(path); parents.set(parent, siblings);
    }
    const result = new Map<string, string>();
    await Promise.all([...parents].map(async ([parent, siblings]) => {
        const physicalParent = await realStoragePathWithAbsentSuffix(parent);
        for (const path of siblings) result.set(path, storagePathsEqual(parent, path) ? physicalParent
            : storagePathJoin(physicalParent, storagePathLeaf(path)));
    }));
    return result;
}
