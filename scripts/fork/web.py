#!/usr/bin/env python3
"""Build, deploy, observe and roll back the fork UI. Linux operator tooling."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
MARKER = re.compile(r'\d+\.\d+\.\d+-jake\.([0-9a-f]{40})(?![0-9a-f])')


def run(args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def required(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise ValueError(f'{name} is required')
    return value


def harness_artifact(role, command, marker, destination):
    config = os.environ.get('HARNESS_CONFIG', str(Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'harness/config.env'))
    hosts = run(['bash', '-eu', '-c', 'source "$1"; printf "%s" "$HARNESS_HOSTS"', 'bash', config], capture_output=True).stdout
    host = json.loads(hosts)[role]['ssh']
    artifact = None
    invocation = ['harness', 'run', role, '--keep']
    if timeout := os.environ.get('HAPPIER_ARTIFACT_TIMEOUT_SECONDS'):
        invocation += ['--timeout', timeout]
    with subprocess.Popen([*invocation, '--', *command], cwd=ROOT,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) as process:
        for line in process.stdout:
            print(line, end='', flush=True)
            if line.startswith(marker):
                artifact = line.strip().removeprefix(marker)
        if process.wait() or not artifact:
            raise ValueError(f'Harness role {role} did not produce {marker}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    run(['scp', '-q', host + ':' + artifact, str(destination)])


def fetch(url, token=None):
    headers = {'Cache-Control': 'no-cache'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers)) as response:
        return response.read().decode('utf-8')


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'script' and values.get('src'):
            self.sources.append(values['src'])


def entry_javascript(url):
    parser = Scripts()
    parser.feed(fetch(url + '/'))
    if not parser.sources:
        raise ValueError('Served index has no entry JavaScript')
    for source in parser.sources:
        asset = urllib.parse.urljoin(url + '/', source)
        if urllib.parse.urlsplit(asset).netloc != urllib.parse.urlsplit(url).netloc:
            raise ValueError('Refusing a cross-origin entry JavaScript URL')
        yield fetch(asset)


def observe(url):
    commits = {sha for source in entry_javascript(url) for sha in MARKER.findall(source)}
    if len(commits) != 1:
        raise ValueError(f'Expected one full fork commit in served entry JavaScript, found {len(commits)}')
    return commits.pop()


def sessions(url, token):
    ids = set()
    for route in ('/v2/sessions', '/v2/sessions/archived'):
        cursor = None
        seen = set()
        while True:
            endpoint = url + route
            if cursor:
                endpoint += '?' + urllib.parse.urlencode({'cursor': cursor})
            payload = json.loads(fetch(endpoint, token))
            rows = payload['sessions']
            if not isinstance(rows, list):
                raise ValueError('Invalid session listing')
            ids.update(row['id'] for row in rows)
            cursor = payload.get('nextCursor')
            if not cursor:
                break
            if cursor in seen:
                raise ValueError('Session pagination cursor repeated')
            seen.add(cursor)
    return ids


def verify(url, token, expected, before):
    if re.fullmatch('[0-9a-f]{40}', expected):
        actual = observe(url)
        if actual != expected:
            raise ValueError(f'Served commit {actual} differs from expected {expected}')
    else:
        pattern = r'(?<![A-Za-z0-9_.-])' + re.escape(expected) + r'(?![A-Za-z0-9_.-])'
        if not any(re.search(pattern, source) for source in entry_javascript(url)):
            raise ValueError(f'Served entry JavaScript does not contain version {expected}')
        actual = expected
    page = fetch(url + '/')
    if '<html' not in page.lower() or '<script' not in page.lower():
        raise ValueError('Login route did not serve an app document')
    after = sessions(url, token)
    # Archived sessions move between lists. Resolve any remaining IDs directly.
    for missing in before - after:
        fetch(url + '/v2/sessions/' + urllib.parse.quote(missing, safe=''), token)
    print(f'CHECK served entry JavaScript: {actual}', flush=True)
    print('CHECK /: HTTP 200 login app document', flush=True)
    print(f'CHECK authenticated session listings: {len(after)} IDs, {len(before)} prior IDs preserved', flush=True)


def build(sha):
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Build requires a full source commit')
    work = ROOT / '.project/fork-web'
    work.mkdir(parents=True, exist_ok=True)
    # Match docs/fork-builds.md without requiring Docker in the compute guest.
    version = '22.14.0'
    archive = f'node-v{version}-linux-x64.tar.xz'
    if os.uname().machine != 'x86_64':
        raise ValueError('The documented fork build toolchain requires Linux x86-64')
    base = f'https://nodejs.org/dist/v{version}/'
    checksums = fetch(base + 'SHASUMS256.txt')
    expected = next(line.split()[0] for line in checksums.splitlines() if line.endswith('  ' + archive))
    binary = work / archive
    urllib.request.urlretrieve(base + archive, binary)
    if hashlib.sha256(binary.read_bytes()).hexdigest() != expected:
        raise ValueError('Node archive checksum mismatch')
    run(['tar', '-xf', str(binary), '-C', str(work)])
    env = os.environ.copy()
    env.update(HOME=str(work / 'home'), CI='1', APP_ENV='production',
               HAPPIER_INSTALL_SCOPE='ui,protocol,agents,cli-common,release-runtime,transfers,connection-supervisor,audio-stream-native,sherpa-native',
               HAPPIER_UI_VENDOR_WEB_ASSETS='0', EXPO_APP_NAME='Happier (Jake)',
               EXPO_PUBLIC_HAPPY_SERVER_URL='',
               EXPO_APP_LOCAL_CONFIG_PATH=str(work / 'local-config.cjs'))
    env['PATH'] = str(work / f'node-v{version}-linux-x64/bin') + ':' + env['PATH']
    Path(env['HOME']).mkdir(exist_ok=True)
    (work / 'local-config.cjs').write_text('module.exports = { updates: { enabled: false } };\n')
    run(['npm', 'install', '--prefix', str(work / 'tools'), 'yarn@1.22.22'], cwd=ROOT, env=env)
    env['PATH'] = str(work / 'tools/node_modules/.bin') + ':' + env['PATH']
    package_version = json.loads((ROOT / 'apps/ui/package.json').read_text())['version']
    env['EXPO_APP_VERSION'] = f'{package_version}-jake.{sha}'
    run(['bash', 'scripts/ci/yarn-install-with-retry.sh', '--frozen-lockfile', '--ignore-engines',
         '--network-timeout', '600000', '--non-interactive'], cwd=ROOT, env=env)
    run(['node', 'scripts/pipeline/release/build-ui-web-bundle.mjs', '--version', env['EXPO_APP_VERSION']], cwd=ROOT, env=env)
    # Check the compiled entry before transferring it, using the same parser as the live probe.
    parser = Scripts()
    parser.feed((ROOT / 'apps/ui/dist/index.html').read_text())
    markers = set()
    for source in parser.sources:
        markers.update(MARKER.findall((ROOT / 'apps/ui/dist' / source.lstrip('/')).read_text()))
    if markers != {sha}:
        raise ValueError('Compiled entry does not identify the requested full source commit')
    bundle = work / 'web.tar'
    with tarfile.open(bundle, 'w') as output:
        output.add(ROOT / 'apps/ui/dist', arcname='.')
    print('BUILD_EXPORT=' + str(bundle), flush=True)


def remote(mode, host, root, source, identity):
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', root):
        raise ValueError('Remote root must be an absolute shell-safe path')
    if mode == 'rollback' and not re.fullmatch(re.escape(root) + r'/backups/[A-Za-z0-9_-]+', source):
        raise ValueError('Rollback must select a backup under the configured root')
    remote_script = f'/tmp/{identity}.sh'
    run(['scp', '-q', str(ROOT / 'scripts/fork/web-remote.sh'), host + ':' + remote_script])
    status = f'/tmp/{identity}.status'
    channel = identity
    command = shlex.join(['bash', remote_script, mode, root, source, identity])
    wrapped = f'{command} 2>&1 | tee ~/{identity}.log; result=${{PIPESTATUS[0]}}; echo "$result" > {status}; tmux wait-for -S {channel}'
    launch = ('tmux has-session -t 2 2>/dev/null || tmux new-session -d -s 2; '
              + shlex.join(['tmux', 'new-window', '-d', '-t', '2', '-n', identity, 'bash -c ' + shlex.quote(wrapped)]))
    run(['ssh', host, launch])
    run(['ssh', host, shlex.join(['tmux', 'wait-for', channel])])
    run(['ssh', host, f'cat ~/{identity}.log; test "$(cat {status})" = 0'])


def deploy(args):
    url = required('HAPPIER_DEPLOY_URL').rstrip('/')
    host = required('HAPPIER_DEPLOY_SSH')
    root = os.environ.get('HAPPIER_DEPLOY_ROOT', '/opt/happier')
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', root) or '..' in Path(root).parts:
        raise ValueError('Remote root must be an absolute path without traversal')
    if urllib.parse.urlsplit(url).scheme != 'https':
        raise ValueError('Deployment checks require HTTPS')
    if args.command == 'rollback':
        if not args.expect:
            raise ValueError('Rollback requires --expect FULL_COMMIT_OR_VERSION')
        if not re.fullmatch(r'[0-9a-f]{40}|[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', args.expect):
            raise ValueError('Rollback expectation must be a full commit or version')
        if not re.fullmatch(re.escape(root) + r'/backups/[A-Za-z0-9_-]+', args.backup):
            raise ValueError('Rollback must select a backup under the configured root')
        if args.dry_run:
            command = shlex.join(['bash', '-s', '--', 'rollback-dry-run', root, args.backup, 'dry-run'])
            run(['ssh', host, command], input=(ROOT / 'scripts/fork/web-remote.sh').read_text())
            print(f'DRY RUN: back up active configuration on {host}, restore the saved override or base-only selection from {args.backup}, recreate only relay, verify {args.expect}')
            print('Read-only preflight completed. No build, upload or service mutation performed')
            return
        sha = args.expect
    else:
        run(['jj', 'git', 'fetch', '--remote', 'origin'], cwd=ROOT)
        sha = run(['jj', 'log', '-r', 'main@origin', '--no-graph', '-T', 'commit_id'], cwd=ROOT, capture_output=True).stdout.strip()
        changed = run(['jj', 'diff', '--from', 'main@origin', '--name-only'], cwd=ROOT, capture_output=True).stdout.splitlines()
        allowed = {'.harness-deploy', 'docs/fork-builds.md', 'scripts/fork/web.py', 'scripts/fork/web-remote.sh', 'scripts/fork/check-login.mjs'}
        if set(changed) - allowed:
            raise ValueError('Refusing to label modified application source as main: ' + ', '.join(set(changed) - allowed))
    if args.ready_timeout <= 0:
        raise ValueError('Readiness deadline must be positive')
    token = json.loads(Path(required('HAPPIER_DEPLOY_CREDENTIALS')).expanduser().read_text())['token']
    before = sessions(url, token)
    print(f'CHECK pre-deployment authenticated listing: {len(before)} IDs', flush=True)
    identity = ('fork-' + sha if re.fullmatch('[0-9a-f]{40}', sha) else 'rollback') + '-' + uuid.uuid4().hex[:12]
    if args.command == 'deploy':
        # harness syncs this workspace and hides credentials from the compute guest.
        local = ROOT / '.project/fork-web/deploy.tar'
        harness_artifact(os.environ.get('HAPPIER_BUILD_HOST', 'compute'),
                         ['python3', 'scripts/fork/web.py', 'build', '--sha', sha], 'BUILD_EXPORT=', local)
        source = f'/tmp/{identity}.tar'
        run(['scp', '-q', str(local), host + ':' + source])
    else:
        source = args.backup
    remote(args.command, host, root, source, identity)
    # A recreated relay may still be starting. This operator-controlled deadline
    # covers service readiness only and is not a product request timeout.
    deadline = time.monotonic() + args.ready_timeout
    while True:
        try:
            verify(url, token, sha, before)
            break
        except (OSError, ValueError, KeyError) as error:
            if time.monotonic() >= deadline:
                raise
            print(f'Waiting for recreated relay: {error}', flush=True)
            time.sleep(2)
    harness_artifact(os.environ.get('HAPPIER_BROWSER_HOST', 'browser'),
                     ['node', 'scripts/fork/check-login.mjs', url + '/'], 'LOGIN_SCREENSHOT=',
                     ROOT / '.project/fork-web/login.png')
    print('DEPLOYED_COMMIT=' + sha, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('check')
    builder = commands.add_parser('build', help='Internal command executed through harness compute')
    builder.add_argument('--sha', required=True)
    for name in ('deploy', 'rollback'):
        command = commands.add_parser(name)
        command.add_argument('--ready-timeout', type=float, default=120,
                             help='Operator readiness deadline in seconds (default: 120)')
        if name == 'rollback':
            command.add_argument('--backup', required=True)
            command.add_argument('--expect', required=True)
            command.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.command == 'check':
        print(observe(required('HAPPIER_DEPLOY_URL').rstrip('/')))
    elif args.command == 'build':
        build(args.sha)
    else:
        deploy(args)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError, StopIteration) as error:
        print(f'fork-web: {error}', file=sys.stderr)
        sys.exit(1)
