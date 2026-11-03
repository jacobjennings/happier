import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const cliCommonRoot = join(repoRoot, 'packages', 'cli-common');

// The component-artifact builder stopped archiving the deferred Voice runtime when Voice became an
// optional published component (ce90344b89); the exported Personal Home backup/restore owner is
// cli-common's production tar consumer now.
test('cli-common owns tar as a runtime dependency for its exported Personal Home archive owner', async () => {
  const [packageJson, productionAdapters, archiveSource] = await Promise.all([
    readFile(join(cliCommonRoot, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(cliCommonRoot, 'src', 'firstPartyRuntime', 'personalHome', 'productionAdapters.ts'), 'utf8'),
    readFile(join(cliCommonRoot, 'src', 'firstPartyRuntime', 'personalHome', 'archive.ts'), 'utf8'),
  ]);

  assert.equal(
    packageJson.exports?.['./firstPartyRuntime/personalHome/productionAdapters']?.import,
    './dist/firstPartyRuntime/personalHome/productionAdapters.js',
    'the Personal Home production adapters must remain an exported production path',
  );
  assert.match(
    productionAdapters,
    /from '\.\/archive\.js';/u,
    'the exported production adapters must reach the archive owner',
  );
  assert.match(
    archiveSource,
    /import \* as tar from 'tar';/u,
    'the Personal Home archive owner must continue to use its package-owned archive library',
  );
  assert.match(
    archiveSource,
    /await tar\.create\(/u,
    'Personal Home backups must be created through the imported archive library',
  );
  assert.equal(
    packageJson.dependencies?.tar,
    '7.5.22',
    'an exported production archive owner must own tar in dependencies',
  );
  assert.equal(
    packageJson.devDependencies?.tar,
    undefined,
    'tar must not be demoted to a development-only dependency while production source imports it',
  );
});
