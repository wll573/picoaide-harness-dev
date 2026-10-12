#!/usr/bin/env bash
# Native Ubuntu install for Intranet AI server (binary + systemd).
# Neutral packaging: set CHANNEL / CHANNEL_DIR via env; do not hardcode channel ids.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PREFIX=${PREFIX:-/opt/picoaide}
DEPLOY_DIR=${DEPLOY_DIR:-$PREFIX}
CHANNEL_DIR=${CHANNEL_DIR:-${PICOAI_CHANNEL_DIR:-$DEPLOY_DIR/channel}}
BIN_SRC=${BIN_SRC:-}
SERVICE_USER=${SERVICE_USER:-picoaide}
ENV_SRC=${ENV_SRC:-$SCRIPT_DIR/server.env.example}
UNIT_SRC=${UNIT_SRC:-$SCRIPT_DIR/systemd/picoaide-server.service}

if [[ "$(id -u)" -ne 0 ]]; then
  echo "install.sh must run as root (or via sudo)" >&2
  exit 1
fi

if [[ -z "$BIN_SRC" ]]; then
  echo "BIN_SRC is required (directory containing picoaide-server and picoaide-app-compile)" >&2
  exit 1
fi
if [[ ! -x "$BIN_SRC/picoaide-server" ]]; then
  echo "missing executable: $BIN_SRC/picoaide-server" >&2
  exit 1
fi
if [[ ! -x "$BIN_SRC/picoaide-app-compile" ]]; then
  echo "missing executable: $BIN_SRC/picoaide-app-compile (must sit beside picoaide-server)" >&2
  exit 1
fi
if [[ ! -f "$UNIT_SRC" ]]; then
  echo "missing unit file: $UNIT_SRC" >&2
  exit 1
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home "$DEPLOY_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 0755 \
  "$DEPLOY_DIR"/bin \
  "$DEPLOY_DIR"/data \
  "$DEPLOY_DIR"/client \
  "$DEPLOY_DIR"/skills \
  "$DEPLOY_DIR"/backups \
  "$CHANNEL_DIR"

install -m 0755 "$BIN_SRC/picoaide-server" "$DEPLOY_DIR/bin/picoaide-server"
install -m 0755 "$BIN_SRC/picoaide-app-compile" "$DEPLOY_DIR/bin/picoaide-app-compile"

if [[ ! -f "$DEPLOY_DIR/server.env" ]]; then
  if [[ -f "$ENV_SRC" ]]; then
    install -m 0640 -o root -g "$SERVICE_USER" "$ENV_SRC" "$DEPLOY_DIR/server.env"
    echo "Wrote $DEPLOY_DIR/server.env from example — edit PICOAI_PG_DSN and change-me-* values before production use."
  else
    echo "No server.env and no ENV_SRC at $ENV_SRC" >&2
    exit 1
  fi
else
  echo "Keeping existing $DEPLOY_DIR/server.env"
fi

ensure_env_line() {
  local key=$1 value=$2
  if ! grep -q "^${key}=" "$DEPLOY_DIR/server.env" 2>/dev/null; then
    printf '%s=%s\n' "$key" "$value" >> "$DEPLOY_DIR/server.env"
  fi
}
ensure_env_line PICOAI_CHANNEL_DIR "$CHANNEL_DIR"
ensure_env_line PICOAI_CLIENT_RELEASE_DIR "$DEPLOY_DIR/client"
ensure_env_line PICOAI_SKILL_SEED_DIR "$DEPLOY_DIR/skills"

install -m 0644 "$UNIT_SRC" /etc/systemd/system/picoaide-server.service
systemctl daemon-reload
systemctl enable picoaide-server.service

if grep -q 'change-me-' "$DEPLOY_DIR/server.env"; then
  echo "Refusing to start: $DEPLOY_DIR/server.env still contains change-me-* placeholders. Edit it, then: systemctl start picoaide-server.service" >&2
  exit 0
fi

systemctl restart picoaide-server.service
echo "Installed under $DEPLOY_DIR. Health: curl -fsS http://127.0.0.1:8080/healthz"
