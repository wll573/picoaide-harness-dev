# Gap-CI-Green-13

- 日期：2026-10-15 CST（Asia/Shanghai）
- 对照：Green-12 tip `6b2e684` → CI run 38748112540
- 根因：有意改 `scripts/verify-ci-scripts.mjs` 后，F1 `check:ci-scripts` 登记 digest 未跟（登记 `08679662…` ≠ 实际 `e49d61e5…`）
- 处置：更新 `scripts/check-root-guards.mjs` 中 `REGISTERED_GUARD_ENTRIES` 的 `check:ci-scripts` digest
- 验证：`node scripts/check-guard-parser-integrity.mjs` 通过
