# Gap-CI-Green-10

- 日期：2026-10-15 CST（Asia/Shanghai）
- 对照 run：`38554161483`（Green-9 tip `283b50f726`，分支 `shenji/intranet`）
- 结论（查挂）：Green-9 解掉 `verify:profile` 挂起后，Full gate 暴露 enterprise 测红；主因是 Gap-P1A `getLastServer` 后多处 auth-gate mock 未补齐
- 证据：
  1. CI annotations / Full gate：`ctx.picoSession.getLastServer is not a function`（`auth-gate-brand`、`audit-r9-auth-gate-locale`、`auth-gate-i18n`、`auth-gate-browser-login-pending` 等）
  2. 同轮非 mock 红：`auth-gate-i18n` en 页含「本地账号」；`bootstrap.spec` / `session-epoch-wiring` / `session-sentinel` 另有断言失败
- 本机已做（未 push）：
  1. 8 个 auth-gate 相关测补 `getLastServer: () => null`
  2. 本地复核：`auth-gate-brand` + `audit-r9` 11/11 绿
- 待拍板：先 push mock 修复，还是把剩余红一并收完再推
- 远程：https://github.com/wll573/picoaide-harness-dev/actions/runs/38554161483

## 续（Green-11）

- push tip：`13878f84bd`（本文件所列 mock 修复已推）
- 剩余 i18n / bootstrap / epoch / sentinel 红见 `验收/Gap-CI-Green-11.md`
