#!/usr/bin/env bash
# Regenerate 验收/pack-windows/SHA256SUMS from a local media folder that holds
# the Windows Setup.exe and linux amd64 picoaide-server (downloaded from CI).
# Does not download anything; does not commit binaries.
#
# Usage: ./验收/pack-windows/regen-sha256sums.sh MEDIA_DIR
# MEDIA_DIR must contain (or nest) shenji-*-x64-Setup.exe and picoaide-server
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MEDIA=${1:?usage: regen-sha256sums.sh MEDIA_DIR}

TIP=${TIP:-c428c13b216235bdae259ed3261c6e17d47cbdb7}
CI_RUN=${CI_RUN:-38777494364}
OUT=${OUT:-"$SCRIPT_DIR/SHA256SUMS"}

find_one() {
  local pattern=$1
  local hits
  mapfile -t hits < <(find "$MEDIA" -type f -name "$pattern" | sort)
  if [[ ${#hits[@]} -ne 1 ]]; then
    echo "expected exactly one file matching $pattern under $MEDIA (found ${#hits[@]})" >&2
    printf '  %s\n' "${hits[@]}" >&2
    exit 1
  fi
  printf '%s\n' "${hits[0]}"
}

SETUP=$(find_one 'shenji-*-x64-Setup.exe')
SERVER=$(find_one 'picoaide-server')

{
  echo "# Pack-Windows SHA256SUMS — tip ${TIP}"
  echo "# Source CI: https://github.com/wll573/picoaide-harness-dev/actions/runs/${CI_RUN}"
  echo "# Artifacts: desktop-Windows-installer + picoaide-server-linux-amd64"
  echo "# Generated: $(TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M %Z') (Asia/Shanghai)"
  echo "# Do not commit the binaries; re-download from the CI run above and verify."
  echo "#"
  printf '%s  %s\n' "$(sha256sum "$SETUP" | awk '{print $1}')" "$(basename "$SETUP")"
  printf '%s  %s\n' "$(sha256sum "$SERVER" | awk '{print $1}')" "$(basename "$SERVER")"
} > "$OUT"

echo "wrote $OUT"
cat "$OUT"
