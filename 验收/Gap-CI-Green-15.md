# Gap-CI-Green-15

- 日期：2026-10-15 CST（Asia/Shanghai）
- 对照：Green-14 tip `883ea38` → CI run 38755740693
- 根因：新增 `scripts/ci-stage-nontag-client-assets.sh` 未登记进 `EXECUTION_FACE_REGISTRY` / `CI_REFERENCED_EXECUTION_REGISTRY`；连带更新 `check-install-integrity.mjs` 内容摘要
- 处置：两处登记补齐 + `REGISTERED_INSTALL_INTEGRITY_BODIES` sha256 同步
- Green-14 功能改动保留
