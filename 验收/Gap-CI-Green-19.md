# Gap-CI-Green-19

- 日期：2026-10-16 CST（Asia/Shanghai）
- 目标：Desktop Linux E2E 在 tip `20c0da2`（run 38769542873）登录 settle 阶段 **app exit 0**，`e2e:client` 红、`e2e:sidebar` 因 set -e 未跑
- 对照 tip（改前）：`20c0da21ab`（Green-18）
- 现场：CDP 9223 PASS → ~8s `app_exited code=0 signal=null`；`cdp_http ok targets=1`；日志尾 `token persisted as 0600 plaintext` + D-Bus；非 OOM/SIGKILL

## 根因

账号数据隔离（`createAccountDataScope`）：冷启动 identity=`signed-out`，**首次** `setSession` 必走 `!matches` → `persist`（plaintext warn）→ `activate` → `runtime.requestRestart()` → `app.relaunch()` + **exit 0**。

Green-16 把 tracked child 的 `exit` 当成「应用已死」；重拉起后 CDP 仍在（新 PID），于是诊断自相矛盾：`app_exited` 且 `cdp_http ok`。这是**有意的进程轮换**，不是崩溃。

## 改动

1. **`e2e-client.mjs` / `e2e-right-sidebar.mjs` / `e2e-foot-lane.mjs` / `e2e-terminal.mjs`**
   - 启动前写入 `$DSH_HOME/account-data.json`（`admin` + mock 网关），使首次登录 `matches` → **跳过 activate/relaunch**
   - Chromium 加 `--password-store=basic`（无 keyring 的 GHA 少打 D-Bus）
2. **`e2e-client.mjs` 兜底**：若仍出现 code=0 且 CDP 存活，采纳 relaunch 并探测已登录态；失败文案改为 `app_voluntarily_exited` / `app voluntarily exited`

Green-16/17/18 保留。

## 本机验证

- `node --check` 上述四个 e2e 脚本 → OK
- 完整 Electron E2E 需 GHA Xvfb + 打包产物

## push 记录

- Tip SHA：`eb890c72de5d`（验收补记；功能 tip `8a4dfe5d5935`）
- 远程分支：`boss/shenji/intranet`
- CI：https://github.com/wll573/picoaide-harness-dev/actions/runs/38773878238（验收补记推送；功能推送 run 38773832597）
