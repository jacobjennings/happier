import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '../..');

test('preserved Android submit uses dependency-free canonical app identity and selected submit profile', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'happier-aab-retry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, 'submit');
  // Dry-run plans the preserved AAB path without reading it; exact AAB identity and
  // page-size verification are owned by scripts/pipeline/expo/submit_android_publication.test.mjs.
  const aab = path.join(dir, 'candidate.aab');
  execFileSync(process.execPath, [path.join(repoRoot, 'scripts/pipeline/expo/prepare-static-submit-workspace.mjs'),
    '--environment', 'production', '--profile', 'production', '--out-dir', workspace,
  ], { cwd: repoRoot });
  const app = JSON.parse(readFileSync(path.join(workspace, 'app.json'), 'utf8'));
  const eas = JSON.parse(readFileSync(path.join(workspace, 'eas.json'), 'utf8'));
  const canonical = JSON.parse(readFileSync(path.join(repoRoot, 'apps/ui/eas.json'), 'utf8'));
  assert.equal(app.expo.android.package, 'dev.happier.app');
  assert.deepEqual(eas.submit.production.android, canonical.submit.production.android);
  assert.equal(JSON.parse(readFileSync(path.join(workspace, 'package.json'), 'utf8')).dependencies, undefined);

  // Production retries carry the same store-publication inputs as the
  // build-ui-mobile-local retry job: bound notes, exact source, and a Play credential.
  const sourceSha = 'a'.repeat(40);
  const notes = path.join(dir, 'store-release-notes.json');
  writeFileSync(notes, JSON.stringify({ schemaVersion: 2, kind: 'happier.release-notes.projection.v2',
    release: { id: 'r1', sourceSha, components: { ui: '1.2.3' } }, projections: { playStore: { whatsNew: 'Approved notes' } } }));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const credentialJson = JSON.stringify({ type: 'service_account', client_email: 'fixture@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const out = execFileSync(process.execPath, [path.join(repoRoot, 'scripts/pipeline/run.mjs'), 'expo-submit',
    '--environment', 'production', '--platform', 'android', '--profile', 'production',
    '--project-dir', workspace, '--path', aab, '--wait', 'true',
    '--release-notes-json', notes, '--source-sha', sourceSha, '--release-id', 'r1', '--app-version', '1.2.3',
    '--dry-run', '--secrets-source', 'env',
  ], { cwd: repoRoot, env: { ...process.env, CI: 'true', EXPO_TOKEN: '', GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: credentialJson, HAPPIER_EXPO_SUBMIT_APP_ENV: '' }, encoding: 'utf8' });
  assert.ok(out.includes(`(cwd: ${workspace})`));
  assert.ok(out.includes(`--path ${aab}`));
  assert.doesNotMatch(out, /--latest/);
  assert.match(out, /Google Play production publication: package=dev\.happier\.app versionCode=<from-exact-artifact> /);
});
