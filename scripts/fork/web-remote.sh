#!/usr/bin/env bash
# Runs only inside the relay host's tmux session 2. Never touches relay data.
set -euo pipefail
umask 077
mode=$1
root=$2
source=$3
identity=$4
cd "$root/relay"
compose=(docker compose --env-file ../versions.env --env-file .env -f compose.yaml)
if [[ "$mode" == rollback || "$mode" == rollback-dry-run ]]; then
  test -d "$source/relay"
  cmp "$source/relay/compose.yaml" compose.yaml
  cmp "$source/versions.env" "$root/versions.env"
  cmp "$source/relay/.env" .env
  saved=(docker compose --env-file ../versions.env --env-file .env -f "$source/relay/compose.yaml")
  if [[ -f "$source/relay/compose.override.yaml" ]]; then
    saved+=(-f "$source/relay/compose.override.yaml")
  fi
  "${saved[@]}" config --quiet
  printf 'CHECK rollback backup, unchanged base configuration and Compose validation: OK\n'
  [[ "$mode" != rollback-dry-run ]] || exit 0
fi
backup="$root/backups/$identity"
mkdir -p "$backup"
cp -a "$root/relay" "$backup/relay"
cp -a "$root/versions.env" "$backup/versions.env"
"${compose[@]}" config > "$backup/base-resolved.yaml"
container=$("${compose[@]}" ps -q relay)
test -n "$container"
docker inspect "$container" > "$backup/container.json"
if [[ -f compose.override.yaml ]]; then
  "${compose[@]}" -f compose.override.yaml config > "$backup/resolved.yaml"
fi
printf 'BACKUP=%s\n' "$backup"
if [[ "$mode" == deploy ]]; then
  destination="$root/web/$identity"
  # An existing export is immutable. A redeploy gets a new identity.
  mkdir -p "$root/web"
  mkdir -m 755 "$destination"
  tar -xf "$source" -C "$destination"
  test -s "$destination/index.html"
  cat > compose.override.yaml.next <<YAML
services:
  relay:
    environment:
      HAPPIER_SERVER_UI_DIR: /opt/happier/fork-web
      HAPPIER_SERVER_UI_REQUIRED: "1"
    volumes:
      - $destination:/opt/happier/fork-web:ro
YAML
  mv compose.override.yaml.next compose.override.yaml
elif [[ "$mode" == rollback ]]; then
  # The selected backup restores the previously mounted fork or base-only UI.
  if [[ -f "$source/relay/compose.override.yaml" ]]; then
    cp -a "$source/relay/compose.override.yaml" compose.override.yaml
  elif [[ -f compose.override.yaml ]]; then
    mv compose.override.yaml "$backup/removed.override.yaml"
  fi
else
  echo 'Unknown remote mode' >&2
  exit 1
fi
if [[ -f compose.override.yaml ]]; then
  compose+=(-f compose.override.yaml)
fi
"${compose[@]}" up -d --no-deps --force-recreate relay
"${compose[@]}" ps relay
