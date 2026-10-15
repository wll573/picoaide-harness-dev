# Gap-CI-Green-16

- 日期：2026-10-15 CST（Asia/Shanghai）
- 目标：修 Desktop Linux Client E2E：CDP 已通（port 9223 PASS）后 ~15s WebSocket `readyState=3`，无法完成 `e2e:client` + `e2e:sidebar`
- 对照 tip（改前）：`096e85d174`（Green-15）
- 现场（改前，run `38759092815`）：
  1. `PASS 应用启动并暴露 CDP — port 9223`
  2. ~15s 后 `e2e-client fatal: CDP WebSocket not open (readyState=3) for Runtime.evaluate`
  3. `FAIL 应用未就绪`；1/2；`e2e:sidebar` 因 `set -e` 未跑
  4. job 收尾留下 `chrome_crashpad_handler` orphan（与 Green-13 hang 同形：CDP 死后进程侧崩溃迹象）

## 根因

Green-14 已把「CDP 挂死 → unsettled top-level await / exit 13」改成明确红；本轮是**同一崩溃面的下一表现**：

1. Green-12 起无 secrets 时 Desktop 只打 **shenji** 包，Linux E2E 首次稳定对着神机 unpack 跑（不再有 official 作对照）。
2. e2e 启动参数只有 `--no-sandbox`，**缺少** GHA Linux 常见的 `--disable-dev-shm-usage`（`/dev/shm` 过小易杀 renderer）；WASM 探针早已带 `--disable-gpu`。
3. `stdio: 'ignore'` 吞掉 Electron 日志；WS 闪断时只见 `readyState=3`，分不清「应用已退出」还是「页目标导航」。
4. `connectUntilLoginForm` 在 `#f1` 刚出现就交出会话，随后文档 settle/renderer 死亡 → 下一步 `Runtime.evaluate` 直接 readyState=3。

## 改动

1. **`packages/host/desktop/scripts/e2e-client.mjs`**
   - 启动加 `--disable-dev-shm-usage` + `--disable-gpu`
   - 捕获 app stdout/stderr → workDir `app.log`，失败时落到 `.e2e-app.log`；监听 `child.exit`
   - 登录表单 settle 后再交出会话；登录填表 CDP 断连时有界重连；`diagnoseAppDeath` 报告进程退出码 / CDP HTTP / 日志尾
2. **`e2e-right-sidebar.mjs` / `e2e-foot-lane.mjs` / `e2e-terminal.mjs`**：同组 Chromium 旗标
3. **`.github/workflows/ci.yml`**：上传 `e2e-app.log` 进 `e2e-results`

Green-14/15 的 CDP 超时、suite hard timeout、nontag stage 登记均保留。

## 本机验证

- `node --check` 上述四个 e2e 脚本 → OK
- 完整 Electron E2E 需 Xvfb + 已打包 `dist/linux-unpacked`（本环境无产物）；正确性按旗标/诊断/重连路径推理

## push 记录

- Tip SHA：（push 后补）
- 远程分支：`boss/shenji/intranet`
- CI：（push 后补）
