# Scheduled-runner tools only. The checkout is mounted at execution time.
FROM docker.io/library/node:22.14.0-bookworm

# Match CI's tmux setup. Linux listener ownership uses lsof, and SQLite
# retention fixtures invoke sqlite3 even in the broad PGlite suite.
RUN apt-get update && apt-get install -y --no-install-recommends tmux lsof sqlite3
