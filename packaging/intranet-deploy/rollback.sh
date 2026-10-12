#!/usr/bin/env bash
# Restore previous binaries from a backup directory created by upgrade.sh.
# Does NOT reverse database migrations — restore a PG dump + data dir if schema changed.
set -euo pipefail

PREFIX=${PREFIX:-/opt/picoaide}
DEPLOY_DIR=${DEPLOY_DIR:-$PREFIX}
BACKUP_DIR=${BACKUP_DIR:-}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "rollback.sh must run as root (or via sudo)" >&2
  exit 1
fi

if [[ -z "$BACKUP_DIR" ]]; then
  if [[ -f "$DEPLOY_DIR/backups/LAST_BACKUP" ]]; then
    BACKUP_DIR="$DEPLOY_DIR/backups/$(tr -d '[:space:]' < "$DEPLOY_DIR/backups/LAST_BACKUP")"
  else
    BACKUP_DIR=$(find "$DEPLOY_DIR/backups" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1 || true)
  fi
fi

if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR/bin" ]]; then
  echo "No usable BACKUP_DIR (expected .../backups/<stamp>/bin)" >&2
  exit 1
fi

echo "Rolling back binaries from $BACKUP_DIR"
echo "NOTE: binary rollback cannot undo applied PostgreSQL migrations."

systemctl stop picoaide-server.service || true
rm -rf "$DEPLOY_DIR/bin"
cp -a "$BACKUP_DIR/bin" "$DEPLOY_DIR/"
if [[ -f "$BACKUP_DIR/server.env" ]]; then
  cp -a "$BACKUP_DIR/server.env" "$DEPLOY_DIR/server.env"
fi
if [[ -f "$BACKUP_DIR/VERSION" ]]; then
  cp -a "$BACKUP_DIR/VERSION" "$DEPLOY_DIR/VERSION"
fi
systemctl start picoaide-server.service
echo "Rollback complete from $BACKUP_DIR"
