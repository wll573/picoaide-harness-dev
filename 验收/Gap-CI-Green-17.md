# Gap-CI-Green-17

- 日期：2026-10-16 CST（Asia/Shanghai）
- 对照：Green-16 tip `81caa94` → CI run 38763346826
- 根因：`Collect E2E report` 新增 `cp …/.e2e-app.log … || true` 触发 SK-7a；原有三条 `cp || true` 在 SWALLOW_ALLOWLIST，新行未登记且吞码不合规
- 处置：四处改为 `if [ -f|-d ]; then cp; fi`；删除三条已死的 SWALLOW 条目；同步 `check:workflows` digest
- Green-16 E2E 改动保留
