# Gap-CI-Green-14

- 日期：2026-10-15 CST（Asia/Shanghai）
- 目标：内网 Desktop CI（Windows installer + Linux）在 Green-12/13 已能打包 shenji 之后，修掉两条仍红：
  1. 非 tag 上传硬编码 `client-assets/official/**` → only-shenji 时空路径失败
  2. Linux E2E `PASS 应用启动并暴露 CDP` 后挂死 → unsettled top-level await / exit 13
- 对照 tip（改前）：`88fd0e5e93`（Green-13）
- 现场（改前，run `38751750644`）：
  1. Windows：packaging done 1 channel，upload-artifact `client-assets/official/**` → No files found
  2. Linux：CDP PASS 后约 15s → `Detected unsettled top-level await` @ `e2e-client.mjs:1101`，exit 13；无 e2e-report

## 改动

1. **`scripts/ci-stage-nontag-client-assets.sh`**（新）
   - 按 `channels.list` 把白名单渠道（`official|beta|shenji`）从 `client-assets/` 拷到 `nontag-client-assets/`
   - 其它品牌 id → fail-loud（多品牌不得在非 tag 泄漏）
   - 无 list 且存在 `client-assets/official` → fork PR 回落 official
2. **`.github/workflows/ci.yml`**
   - Linux / Windows 非 tag：先 stage，再 `upload-artifact` `nontag-client-assets/**`
   - tag 全量 `client-assets/**` 守卫不变
3. **`packages/host/desktop/scripts/e2e-client.mjs`**
   - CDP `send`/`open` 超时；`onclose`/`onerror` 拒绝全部 pending（杜绝永久挂起）
   - `connectUntilLoginForm`：restoring-session 导航弄死 CDP 时重连，直到 `#f1`+`#server`（神机同路径，非另一套 brand selector）
   - 12 分钟 suite hard timeout → 强制 `process.exit(1)`，避免 unsettled top-level await
4. **`scripts/verify-ci-scripts.mjs`**
   - §10b：stage 脚本 shenji / official / 品牌拒绝 / fork fallback 真跑
   - §11：非 tag 接受 `nontag-client-assets/**`；要求 workflow 调用 stage 脚本
5. **`scripts/check-root-guards.mjs`**：刷新 `check:ci-scripts` F1 digest

## 本机验证

- `bash -n scripts/ci-stage-nontag-client-assets.sh`
- stage 烟测：shenji 成功；品牌 id exit 1
- `node --check packages/host/desktop/scripts/e2e-client.mjs`
- `node scripts/verify-ci-scripts.mjs` → **OK**
- `node scripts/check-guard-parser-integrity.mjs` → **OK**（脏树 WARNING 预期）

## 残余风险

1. Linux E2E 若神机包在登录后其它步骤仍因 CDP 断连失败，会变成**明确红**（有 fatal/报告），而不是 hang；需看下一轮 CI 报告是否还有断言红。
2. 非 tag 白名单含 `shenji`：内网 fork 公开 artifact 会带神机安装包名（产品本身即交付面）；其它客户品牌 id 仍拒。
3. macOS 非 tag 仍走 smoke DMG 路径，未改（本轮红项不在 mac）。

## push 记录

- Tip SHA：（push 后补）
- 远程分支：`boss/shenji/intranet`
- CI：（push 后补）
