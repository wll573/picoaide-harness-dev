#!/usr/bin/env bash
# Seed the server-side assets needed by an offline runtime bundle.
# Usage: seed-server-assets.sh OUTPUT_DIR [REPO_ROOT]
set -euo pipefail

OUT=${1:?usage: seed-server-assets.sh OUTPUT_DIR [REPO_ROOT]}
ROOT=${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
OUT=$(mkdir -p "$OUT" && cd "$OUT" && pwd)
ROOT=$(cd "$ROOT" && pwd)
CHANNEL_ID=${CHANNEL_ID:-official}
CHANNEL_CONTEXT=${CHANNEL_CONTEXT:-}

for command_name in go node; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required" >&2; exit 1; }
done
[[ -f "$ROOT/server/scripts/build-demo-apps.sh" ]] || { echo "repository has no demo builder" >&2; exit 1; }
[[ -d "$ROOT/server/skills" ]] || { echo "repository has no server skills" >&2; exit 1; }

if [[ -n "$CHANNEL_CONTEXT" ]]; then
  CHANNEL_SOURCE=$(cd "$CHANNEL_CONTEXT/$CHANNEL_ID" 2>/dev/null && pwd) || {
    echo "channel context is missing CHANNEL_ID=$CHANNEL_ID" >&2
    exit 1
  }
else
  CHANNEL_SOURCE="$ROOT/brands/official"
fi
[[ -f "$CHANNEL_SOURCE/logo.svg" && -f "$CHANNEL_SOURCE/logo-dark.svg" ]] || {
  echo "channel source must contain logo.svg and logo-dark.svg" >&2
  exit 1
}

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/picoaide-seed.XXXXXX")
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
mkdir -p "$STAGE/demo-apps" "$STAGE/skills" "$STAGE/channel"

bash "$ROOT/server/scripts/build-demo-apps.sh" --out-dir "$STAGE/demo-apps"
cp -a "$ROOT/server/skills/." "$STAGE/skills/"
cp -a "$CHANNEL_SOURCE/." "$STAGE/channel/"

node - "$STAGE" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const [root] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'demo-apps', 'demos.json'), 'utf8'));
if (!Array.isArray(manifest.demos) || manifest.demos.length === 0) throw new Error('demos.json has no demos');
for (const demo of manifest.demos) {
  if (!/^[a-z0-9][a-z0-9-]*\.wasm$/.test(demo.wasm)) throw new Error(`invalid wasm name: ${demo.wasm}`);
  const wasm = path.join(root, 'demo-apps', demo.wasm);
  if (!fs.statSync(wasm).isFile() || fs.statSync(wasm).size === 0) throw new Error(`missing wasm: ${demo.wasm}`);
}
for (const entry of fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skill = path.join(root, 'skills', entry.name, 'SKILL.md');
  if (!fs.statSync(skill).isFile() || fs.statSync(skill).size === 0) throw new Error(`missing skill manifest: ${entry.name}`);
}
for (const logo of ['logo.svg', 'logo-dark.svg']) {
  if (fs.statSync(path.join(root, 'channel', logo)).size === 0) throw new Error(`empty ${logo}`);
}
NODE

chmod -R a+rX "$STAGE"
rm -rf "$OUT/demo-apps" "$OUT/skills" "$OUT/channel"
mv "$STAGE/demo-apps" "$OUT/demo-apps"
mv "$STAGE/skills" "$OUT/skills"
mv "$STAGE/channel" "$OUT/channel"
echo "offline server assets seeded: $OUT"
