# Scheduled-runner tools only. The checkout is mounted at execution time.
FROM docker.io/library/node:22.14.0-bookworm

# Match CI's tmux setup. Linux listener ownership uses lsof, and SQLite
# retention fixtures invoke sqlite3 even in the broad PGlite suite.
# The nested rootless mapping cannot represent _apt's nogroup GID.
# Container root is unprivileged on the guest, and can fetch packages here.
RUN apt-get -o APT::Sandbox::User=root update && \
    apt-get -o APT::Sandbox::User=root install -y --no-install-recommends tmux lsof sqlite3
