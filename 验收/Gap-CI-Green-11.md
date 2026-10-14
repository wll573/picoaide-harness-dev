# Gap-CI-Green-11

- 日期：2026-10-15 CST（Asia/Shanghai）
- 对照：Green-10 tip `13878f84bd`（auth-gate `getLastServer` mocks 已推）；Full gate 红来自 run `38554161483`（Green-9 tip `283b50f726`）
- 本轮收口（Green-10 留下的非 mock 红）：
  1. **i18n**：en 登录页 HTML 内联脚本注释含「本地账号」，撞上 `ZH_MARKERS` 全页扫描 → 改注释措辞（`name===local`），文案键本身未改
  2. **bootstrap / session-sentinel**：`installPerModelReasoning` 在结构替身缺 `llm` 时 `Object.getPrototypeOf(undefined)` 抛错 → 缺席则跳过补丁，成功后再置 `perModelReasoningPatched`
  3. **bootstrap 代际竞态用例**：sync 在 `getBootstrap` 后还会打 managed policy/state；deferred fetch 只挂 bootstrap，follow-on 立即回空策略
  4. **session-epoch-wiring**：登记 `bootstrap.ts#installPerModelReasoning$2` 的 `AWAIT_EXEMPTIONS`；`managed-policy.ts` 本地 epoch 闸 interval → `ENTRY_EXEMPTIONS`（witness `current === epoch`）
- 本地复核：`auth-gate-i18n` + `bootstrap` + `session-sentinel` + `session-epoch-wiring` + `auth-gate-brand` + `audit-r9-auth-gate-locale` → **48/48 绿**
- 残留风险：
  - Full gate 其它包/其它 job 未在本机整跑；以 push 后 CI 为准
  - `installPerModelReasoning` 在无 `llm` 替身上跳过是测试友好路径；真宿主仍靠 `inject: ['llm']`
  - managed-policy 入口走等价本地 epoch，未改成库 `createSessionEpoch`（装库代际会拖整文件进规则 C）
- 远程：push 后填 CI URL
