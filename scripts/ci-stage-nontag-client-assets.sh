#!/usr/bin/env bash
#
# 非 tag（PR/分支）公开 artifact 出口：只把 channels.list 里的渠道从 client-assets/
# 拷到中性 staging 目录，供 upload-artifact 上传。
#
# 背景（Gap-CI-Green-14）：
#   旧 ci.yml 非 tag 硬编码 client-assets/official/**。内网无 CHANNELS_REPO_* 时
#   ci-channels.sh 只物化 shenji → 打包进 client-assets/shenji/，official 空目录
#   ⇒ upload-artifact if-no-files-found:error 红。
#
# 守卫：
#   - 禁止上传整份 client-assets/**（品牌泄漏面）
#   - 渠道 id 必须落在公开/内网缺省白名单：official | beta | shenji
#   - 缺 list 时若仅有 official 目录（fork PR 回落路径）则只 stage official
#   - staging 后必须至少有一个渠道目录，否则 fail-loud
#
# 用法:
#   scripts/ci-stage-nontag-client-assets.sh \
#     [--list channels.list] [--from client-assets] [--to nontag-client-assets]
#
set -euo pipefail

LIST="channels.list"
FROM="client-assets"
TO="nontag-client-assets"

while [ $# -gt 0 ]; do
  case "$1" in
    --list) LIST="$2"; shift 2 ;;
    --from) FROM="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "::error::unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# 相对路径相对仓库根（本脚本所在 scripts/ 的上一级），与 ci-package-clients.sh 同口径。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
case "$LIST" in /*) ;; *) LIST="$REPO_ROOT/$LIST" ;; esac
case "$FROM" in /*) ;; *) FROM="$REPO_ROOT/$FROM" ;; esac
case "$TO" in /*) ;; *) TO="$REPO_ROOT/$TO" ;; esac

# 非 tag 允许进入公开 artifact 的渠道（官方/预发公开品牌 + 内网缺省神机）。
# 其它品牌渠道 id 一律拒绝 —— 与「多品牌不得在非 tag 泄漏」同源。
allowed_channel() {
  case "$1" in
    official|beta|shenji) return 0 ;;
    *) return 1 ;;
  esac
}

channels=()
if [ -f "$LIST" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    # 跳过空行与 # 注释
    case "$line" in
      ''|\#*) continue ;;
    esac
    # 只取第一列（防 list 被误写成 "id extra"）
    id="${line%%[[:space:]]*}"
    [ -n "$id" ] || continue
    channels+=("$id")
  done < "$LIST"
fi

# fork PR：Fetch channel packages 跳过 ⇒ 无 channels.list；回落步骤只写 official。
if [ "${#channels[@]}" -eq 0 ]; then
  if [ -d "$FROM/official" ]; then
    channels=("official")
    echo "nontag client-assets: channels.list missing/empty → fallback official" >&2
  else
    echo "::error::channels.list 缺失或为空，且 client-assets/official 不存在 —— 非 tag 无可上传产物" >&2
    exit 1
  fi
fi

rm -rf "$TO"
mkdir -p "$TO"

staged=0
for id in "${channels[@]}"; do
  if ! allowed_channel "$id"; then
    echo "::error::non-tag upload refuses brand channel '$id' (allowed: official|beta|shenji; multi-brand must not leak on non-tag)" >&2
    exit 1
  fi
  if [ ! -d "$FROM/$id" ]; then
    echo "::error::client-assets/$id missing (channel listed but not staged by packaging)" >&2
    exit 1
  fi
  # 目录非空才算产物（upload-artifact 对空 glob 会红）
  if ! find "$FROM/$id" -type f -print -quit | grep -q .; then
    echo "::error::client-assets/$id exists but has no files" >&2
    exit 1
  fi
  cp -a "$FROM/$id" "$TO/"
  staged=$((staged + 1))
done

if [ "$staged" -eq 0 ]; then
  echo "::error::nontag staging copied 0 channels" >&2
  exit 1
fi

echo "nontag client-assets staged: ${staged} channel(s) → ${TO#"$REPO_ROOT"/}"
