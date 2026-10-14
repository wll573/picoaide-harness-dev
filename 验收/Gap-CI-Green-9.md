# Gap-CI-Green-9

- 日期：2026-10-14 CST（Asia/Shanghai）
- 对照 run：`38523805324`（Green-8 tip `428a67cbab`，分支 `boss/shenji/intranet`）
- 结论（查挂）：**卡住包 = `dsh-plugin-desktop` → `verify:profile`（`scripts/verify-profile-boot.mjs`）**
- 证据：
  1. CI Full gate 在 `check-install-integrity: VERDICT PASS` 之后 ~59 min 静默，job 1h 超时取消；清理残留多个 `MainThread`（Electron 测试/冒烟残留）
  2. 本地逐步复核：leaf/mid 包与 desktop `vitest`（~25s）/ `verify:channel|closure|loader|renderer|licenses` 均能结束
  3. `yarn verify:profile` 在打印 `capability section: passed` 之后 **永不退出**（`timeout 60` → 124）；`fiber.dispose()` 本身约 80ms 返回
  4. dispose 后 `process._getActiveRequests()` 残留 `FSReqCallback`（`unlink`/`rimraf` 链路），自然退出挂起；`process.exit(0)` 后立即结束
  5. 次要：`verify:session` 的 `findSessionDir` 仍只扫 `$DSH_HOME/sessions`，账号隔离后会话在 `accounts/signed-out/sessions/...` ⇒ 物化断言假红（会红不会挂）
- 处置：
  1. `verify-profile-boot.mjs`：catch + finally 清理后 **显式 `process.exit`**（成功 0 / 失败 exitCode）
  2. `verify-session-restart.mjs`：按 `accounts/*/sessions`（兼旧路径）找会话目录；成功路径 `process.exit(0)`
  3. `enterprise/src/bootstrap.ts`：`managedTimer` 挂进 `ctx.effect` disposer（登出/dispose 清 30s sync）
  4. `scripts/check-workspaces.mjs`：任务 **starting** 进度行；默认 **20 min** 单任务墙钟（`--task-timeout-ms` / `CHECK_TASK_TIMEOUT_MS`），防再静默吃满 1h
- 本地复核：`verify:profile` ~21s EXIT 0；`verify:session` 16/16；desktop 全量 `yarn check` ~95s EXIT 0；`check:check-workspaces` 509 断言绿
- 远程：待 push `boss/shenji/intranet`（本轮 tip）
- 残余风险：
  - CI 仍把 Full gate stdout/stderr 重定向到 verdict 文件 ⇒ 进度行要等步骤结束才进 GH 日志；单任务超时负责 fail-loud
  - `app-ai-release-gate` 在高负载下偶发假红（单测单独连跑 3 次绿）—— 与本次挂起无关
  - 产品路径上其它“boot 全树后不 `process.exit`”的烟测仍可能被同类 open-request 拖住（本次只钉 profile/session）
