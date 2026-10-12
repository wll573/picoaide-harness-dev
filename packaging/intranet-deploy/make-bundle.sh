#!/usr/bin/env bash
# Assemble a native deploy bundle directory. Without BIN_SRC, runs in dry-run
# (placeholders only) and prints a clear notice — does not claim a production binary.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
OUT=${OUT:-$SCRIPT_DIR/bundle}
BIN_SRC=${BIN_SRC:-}
CHANNEL_SRC=${CHANNEL_SRC:-}
CLIENT_SRC=${CLIENT_SRC:-}
SKILLS_SRC=${SKILLS_SRC:-}
DRY_RUN=0

mkdir -p "$OUT"/{bin,channel,client,skills,systemd,scripts,docs}

cp -a "$SCRIPT_DIR/systemd/picoaide-server.service" "$OUT/systemd/"
cp -a "$SCRIPT_DIR/server.env.example" "$OUT/"
cp -a "$SCRIPT_DIR/README.md" "$OUT/"
cp -a "$SCRIPT_DIR"/docs/*.md "$OUT/docs/" 2>/dev/null || true
for s in install upgrade rollback uninstall make-bundle; do
  cp -a "$SCRIPT_DIR/${s}.sh" "$OUT/scripts/"
done

if [[ -n "$BIN_SRC" && -f "$BIN_SRC/picoaide-server" && -f "$BIN_SRC/picoaide-app-compile" ]]; then
  cp -a "$BIN_SRC/picoaide-server" "$OUT/bin/"
  cp -a "$BIN_SRC/picoaide-app-compile" "$OUT/bin/"
  chmod 0755 "$OUT/bin/picoaide-server" "$OUT/bin/picoaide-app-compile"
else
  DRY_RUN=1
  echo "DRY-RUN: binaries absent. Set BIN_SRC=/path/to/bin containing picoaide-server and picoaide-app-compile for a real bundle." >&2
  : > "$OUT/bin/.keep"
fi

if [[ -n "$CHANNEL_SRC" && -d "$CHANNEL_SRC" ]]; then
  cp -a "$CHANNEL_SRC"/. "$OUT/channel/"
else
  : > "$OUT/channel/.keep"
  echo "channel/ is a placeholder. Inject channel assets via CHANNEL_SRC or CHANNEL_DIR at install time." >&2
fi

if [[ -n "$CLIENT_SRC" && -d "$CLIENT_SRC" ]]; then
  cp -a "$CLIENT_SRC"/. "$OUT/client/"
else
  : > "$OUT/client/.keep"
fi

if [[ -n "$SKILLS_SRC" && -d "$SKILLS_SRC" ]]; then
  cp -a "$SKILLS_SRC"/. "$OUT/skills/"
else
  : > "$OUT/skills/.keep"
fi

(
  cd "$OUT"
  find . -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Wrote dry-run bundle at $OUT (placeholders only; not a production deliverable)."
else
  echo "Wrote bundle at $OUT"
fi
