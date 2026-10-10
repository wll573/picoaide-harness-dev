#!/usr/bin/env bash
set -euo pipefail

ROOT=${1:?usage: register-windows-installer.sh RELEASE_ROOT INSTALLER VERSION [CHANNEL]}
INSTALLER=${2:?usage: register-windows-installer.sh RELEASE_ROOT INSTALLER VERSION [CHANNEL]}
VERSION=${3:?usage: register-windows-installer.sh RELEASE_ROOT INSTALLER VERSION [CHANNEL]}
CHANNEL=${4:-inner}
# 更新说明（需求 §3.3「服务端发布版本号、更新说明、…」）：可选，给用户看的这版改了什么。
# 来源优先第 5 个参数，其次环境变量 CLIENT_RELEASE_NOTES；都没有则清单里不带该字段。
NOTES=${5:-${CLIENT_RELEASE_NOTES:-}}
ROOT=$(cd "$ROOT" && pwd)
RELEASE_DIR="$ROOT/client-release"
[[ -d "$RELEASE_DIR" ]] || { echo "missing client-release directory: $RELEASE_DIR" >&2; exit 1; }
[[ -f "$INSTALLER" ]] || { echo "installer not found: $INSTALLER" >&2; exit 1; }
INSTALLER=$(cd "$(dirname "$INSTALLER")" && pwd)/$(basename "$INSTALLER")
FILENAME=$(basename "$INSTALLER")
[[ "$FILENAME" =~ \.[Ee][Xx][Ee]$ ]] || { echo "installer must be a .exe: $FILENAME" >&2; exit 1; }
[[ "$FILENAME" != .* && "$FILENAME" != *..* && "$FILENAME" != */* && "$FILENAME" != *\\* ]] || {
  echo "installer filename is unsafe: $FILENAME" >&2
  exit 1
}
[[ "$VERSION" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || { echo "invalid version: $VERSION" >&2; exit 1; }
[[ "$CHANNEL" =~ ^[0-9A-Za-z][0-9A-Za-z._-]*$ ]] || { echo "invalid channel: $CHANNEL" >&2; exit 1; }

TARGET="$RELEASE_DIR/$FILENAME"
TMP_ASSET="$RELEASE_DIR/.$FILENAME.tmp.$$"
TMP_MANIFEST="$RELEASE_DIR/.CLIENT-RELEASE.json.tmp.$$"
cleanup() { rm -f "$TMP_ASSET" "$TMP_MANIFEST"; }
trap cleanup EXIT
cp "$INSTALLER" "$TMP_ASSET"
mv -f "$TMP_ASSET" "$TARGET"
SHA256=$(sha256sum "$TARGET" | awk '{print $1}')
SIZE=$(stat -c '%s' "$TARGET" 2>/dev/null || stat -f '%z' "$TARGET")
python3 - "$TMP_MANIFEST" "$CHANNEL" "$VERSION" "$FILENAME" "$SHA256" "$SIZE" "$NOTES" <<'PY'
import json
import pathlib
import sys

manifest_path, channel, version, filename, sha256, size, notes = sys.argv[1:]
data = {
    "schema": 1,
    "channel_id": channel,
    "client": {
        "version": version,
        # 空串 = 本次没有更新说明；客户端与门户页据此决定是否展示那一栏。
        "notes": notes,
        "assets": {
            "win-x64": {
                "file": filename,
                "sha256": sha256,
                "size": int(size),
            }
        },
    },
}
pathlib.Path(manifest_path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
mv -f "$TMP_MANIFEST" "$RELEASE_DIR/CLIENT-RELEASE.json"
# 发布面硬约束：清单只能有 Windows x64，目录不能残留其他平台资产。
python3 - "$RELEASE_DIR/CLIENT-RELEASE.json" "$RELEASE_DIR" <<'PY'
import json
import pathlib
import sys

manifest_path, release_dir = sys.argv[1:]
data = json.loads(pathlib.Path(manifest_path).read_text(encoding="utf-8"))
assets = data.get("client", {}).get("assets", {})
if set(assets) != {"win-x64"}:
    raise SystemExit("CLIENT-RELEASE.json must contain only win-x64")
for entry in pathlib.Path(release_dir).iterdir():
    if entry.name == "CLIENT-RELEASE.json":
        continue
    if not entry.is_file() or entry.suffix.lower() != ".exe":
        raise SystemExit(f"non-Windows release asset found: {entry.name}")
PY
echo "registered Windows installer: $TARGET"
