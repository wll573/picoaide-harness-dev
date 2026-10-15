# Gap-CI-Green-18

- 日期：2026-10-16 CST（Asia/Shanghai）
- 对照：Green-17 tip `9828ab5` → CI run 38766776217
- 根因：`audit-r26-lifecycle-transition-preemption` afterEach 清理临时 `DSH_HOME` 时，`fs.promises.rm(recursive)` 在 CI 上偶发对仍非空的 `…/connectors` 走 `rmdir` → `ENOTEMPTY`，砸红 teardown（用例③）
- 处置：清理加 `maxRetries`/`retryDelay`，失败再 `rmSync` 同参，仍失败则吞掉（临时目录 best-effort，不掩盖 FIX-31 断言）
- Green-16/17 保留；本地 vitest 该文件 3/3 绿
