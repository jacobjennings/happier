# Scheduled-runner tools only. The checkout is mounted at execution time.
FROM docker.io/library/node:22.23.4-bookworm

# Match CI's tmux setup. Linux listener ownership uses lsof, and SQLite
# retention fixtures invoke sqlite3 even in the broad PGlite suite.
# The nested rootless mapping cannot represent _apt's nogroup GID.
# Container root is unprivileged on the guest, and can fetch packages here.
RUN apt-get -o APT::Sandbox::User=root update && \
    apt-get -o APT::Sandbox::User=root install -y --no-install-recommends tmux lsof sqlite3 systemd

# Prepare the same repository and discovery inputs that actions/checkout gives
# CI. The scheduled runner exports tracked files without Git metadata.
RUN printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'mkdir -p "$HOME"' \
    'npm install --prefix /cache/tools --no-audit --no-fund bun@1.4.2' \
    'export PATH="/cache/tools/node_modules/.bin:$PATH"' \
    'bun --version' \
    '' \
    'git init -q -b main' \
    'git remote add origin https://github.com/jacobjennings/happier.git' \
    'git fetch --no-tags --depth=1 origin "${HAPPIER_HARNESS_SOURCE_SHA:?}"' \
    'git update-ref HEAD FETCH_HEAD' \
    'git read-tree HEAD' \
    'git update-ref refs/remotes/origin/main HEAD' \
    'git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main' \
    '' \
    'if [[ ${HAPPIER_HARNESS_WEBSITE_FIXTURES:-} == 1 ]]; then' \
    '    export HAPPIER_SHIPPED_TREE=/cache/fixtures/released-cli-stable' \
    '    export HAPPIER_UNRELEASED_TREE=/cache/fixtures/unreleased-v0.3' \
    '    for specification in "cli-stable:$HAPPIER_SHIPPED_TREE" "v0.3:$HAPPIER_UNRELEASED_TREE"; do' \
    '        ref=${specification%%:*}' \
    '        directory=${specification#*:}' \
    '        git clone --depth=1 --filter=blob:none --sparse --branch "$ref" \' \
    '            https://github.com/happier-dev/happier.git "$directory"' \
    '        git -C "$directory" sparse-checkout set packages/agents/src' \
    '    done' \
    fi \
    '' \
    'yarn install --frozen-lockfile' \
    'exec "$@"' \
    > /usr/local/bin/harness-run && chmod 0755 /usr/local/bin/harness-run
