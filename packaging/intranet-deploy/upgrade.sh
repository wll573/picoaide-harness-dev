#!/usr/bin/env bash
# Upgrade binaries; on health failure, invoke rollback.sh with the just-created backup.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PREFIX=${PREFIX:-/opt/picoaide}
DEPLOY_DIR=${DEPLOY_DIR:-$PREFIX}
BIN_SRC=${BIN_SRC:?set BIN_SRC to the directory with new picoaide-server and picoaide-app-compile}
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:8080/healthz}
HEALTH_RETRIES=${HEALTH_RETRIES:-20}
HEALTH_SLEEP=${HEALTH_SLEEP:-1}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "upgrade.sh must run as root (or via sudo)" >&2
  exit 1
fi
if [[ ! -x "$BIN_SRC/picoaide-server" || ! -x "$BIN_SRC/picoaide-app-compile" ]]; then
  echo "BIN_SRC must contain executable picoaide-server and picoaide-app-compile" >&2
  exit 1
fi
if [[ ! -d "$DEPLOY_DIR/bin" ]]; then
  echo "deploy dir missing bin/: $DEPLOY_DIR (run install.sh first)" >&2
  exit 1
fi

stamp=$(date +%Y%m%d%H%M%S)
backup="$DEPLOY_DIR/backups/$stamp"
mkdir -p "$backup"
cp -a "$DEPLOY_DIR/bin" "$backup/"
if [[ -f "$DEPLOY_DIR/server.env" ]]; then
  cp -a "$DEPLOY_DIR/server.env" "$backup/"
fi
if [[ -f "$DEPLOY_DIR/VERSION" ]]; then
  cp -a "$DEPLOY_DIR/VERSION" "$backup/"
fi
printf '%s\n' "$stamp" > "$DEPLOY_DIR/backups/LAST_BACKUP"
echo "Backup saved to $backup (binaries + server.env). Also back up PostgreSQL and data/master.key before upgrades."

systemctl stop picoaide-server.service || true
install -m 0755 "$BIN_SRC/picoaide-server" "$DEPLOY_DIR/bin/picoaide-server"
install -m 0755 "$BIN_SRC/picoaide-app-compile" "$DEPLOY_DIR/bin/picoaide-app-compile"
if [[ -n "${VERSION:-}" ]]; then
  printf '%s\n' "$VERSION" > "$DEPLOY_DIR/VERSION"
fi

systemctl start picoaide-server.service

ok=0
for ((i = 1; i <= HEALTH_RETRIES; i++)); do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep "$HEALTH_SLEEP"
done

if [[ "$ok" -ne 1 ]]; then
  echo "health check failed against $HEALTH_URL; rolling back to $backup" >&2
  BACKUP_DIR="$backup" "$SCRIPT_DIR/rollback.sh"
  exit 1
fi

echo "Upgrade OK. Active backup: $backup"
