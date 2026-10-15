# Gap-CI-Green-12

- 日期：2026-10-15 CST（Asia/Shanghai）
- 目标：Desktop CI（Windows installer + Linux）在无 `CHANNELS_REPO_TOKEN` / `CHANNELS_REPO_SSH_KEY` 时，不再因 `bash scripts/ci-channels.sh` 缺凭据整条红；用跟踪中的 `packaging/intranet-channel/shenji` 物化默认神机包。有 secrets 时私有仓路径不变。
- 对照 tip（改前）：`012b73e1f0`（Green-11 docs）
- 现场（改前，run `38655897933`）：
  1. Full gate 已绿；Desktop Linux / Windows installer 挂在 **Fetch channel packages (private repo)**
  2. env 中 `CHANNELS_REPO_*` / `CI_CHANNELS_PIN` 均为空 → `channels credential form: none` → exit 1
  3. macOS Desktop 绿（分支上不跑 Fetch channel packages，仅 tag 才跑）

## 改动

1. **`scripts/ci-channels.sh`**
   - 凭据形态 `none` 且未设 `CI_CHANNELS_SOURCE`、且存在 `packaging/intranet-channel/shenji/channel.json` 时：
     - 物化 `channels/shenji`（从跟踪 pack 复制；**不**把 `channels/` 入库）
     - `channels.list` 只写 `shenji`（覆盖非 tag 的 official / tag 的 all 选择，因只有这一份包）
     - stderr 中性日志：`channel packages materialized from intranet pack (no private-repo credentials)`
     - `CHANNELS_FROM_REMOTE=0`，跳过目录数下限（与本地夹具同理）
   - `--resolve-only` 在同样条件下输出稳定本地 pin：`channels_rev=intranet-local`（非 40-hex，不进远端 fetch / `require_pin_shape`）
   - 无 pack 时仍 fail-loud（指明缺 `CHANNELS_REPO_TOKEN` / `CHANNELS_REPO_SSH_KEY`）
   - 有 token/ssh/url/source 时**不**介入，私有仓 clone/pin 行为不变
   - 可选测控：`CI_INTRANET_PACK_ROOT` / `CI_INTRANET_CHANNEL_ID`
2. **`scripts/verify-ci-scripts.mjs`**
   - 无凭据 + 有 intranet 包：`--resolve-only` → `intranet-local`；全量跑 → list=`shenji`
   - 无凭据 + 强制无 pack：仍 fail-loud
   - 有 token：仍走远端（坏 URL 失败，不得打印物化日志）
3. **workflow**：未改。gate 仅在 tag 上 `--resolve-only`；分支 Desktop 收空 pin + 空 secrets → 走 fallback。tag 无 secrets 时 gate 给出 `intranet-local`，Desktop 同路径物化。

## 本机验证

- `bash -n scripts/ci-channels.sh`
- 无凭据物化 / `--resolve-only` → `intranet-local`；`CI_INTRANET_PACK_ROOT` 指空 → fail-loud
- `node scripts/verify-ci-scripts.mjs` → **OK**（含新增 intranet fallback 断言）

## 成功报告字段（push 后补）

- Tip SHA：见本文件末「push 记录」
- CI URL：见本文件末「push 记录」

## 残余风险

1. 无 secrets 时 Desktop 只构建 **shenji**（不再有 official 作 E2E/排障基准）；`--official-last` 在 list 仅 shenji 时无 official 可置后，`dist/` 留下神机产物，Linux E2E 对着神机包跑。
2. tag 发布若长期无 `CHANNELS_REPO_*`，只能交付跟踪 pack 里的 shenji，无法拉私有仓全渠道集 —— 有 secrets 时行为与上游一致。
3. `intranet-local` pin 不是可复现的内容哈希；同 pin 不保证 pack 字节不变（pack 随本仓提交变）。需要内容钉死时可再改为 pack 树哈希。

## push 记录

- Tip SHA：`14911fba40`（`fix(ci): Gap-CI-Green-12 intranet channel fallback without secrets`）
- 远程分支：`boss/shenji/intranet`
- CI：https://github.com/wll573/picoaide-harness-dev/actions/runs/38748060617
- 推送时间：2026-10-15 22:03 CST（Asia/Shanghai）
