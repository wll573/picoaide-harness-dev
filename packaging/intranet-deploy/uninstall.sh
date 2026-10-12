#!/usr/bin/env bash
# Stop and remove the systemd unit. Data directory is retained unless REMOVE_DATA=1.
set -euo pipefail

PREFIX=${PREFIX:-/opt/picoaide}
DEPLOY_DIR=${DEPLOY_DIR:-$PREFIX}
REMOVE_DATA=${REMOVE_DATA:-0}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "uninstall.sh must run as root (or via sudo)" >&2
  exit 1
fi

systemctl disable --now picoaide-server.service 2>/dev/null || true
rm -f /etc/systemd/system/picoaide-server.service
systemctl daemon-reload

if [[ "$REMOVE_DATA" == "1" ]]; then
  echo "REMOVE_DATA=1 — deleting $DEPLOY_DIR (including data/master.key if present)"
  rm -rf "$DEPLOY_DIR"
else
  echo "Unit removed. Data retained at $DEPLOY_DIR (set REMOVE_DATA=1 to delete)."
fi
