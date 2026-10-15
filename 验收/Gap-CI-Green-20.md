# Gap-CI-Green-20

- 日期：2026-10-16 CST（Asia/Shanghai）
- 目标：Desktop Linux `e2e:client` 在 tip `eae439e`（CI run 38773915254）16 红；侧边栏因 `set -e` 未跑
- 对照 tip（改前）：`eae439e76a`（Green-19）
- 对照成功：Green-19 已消除 exit 0/relaunch，完整跑完 client；本轮红在**断言口径与产品 UI 漂移**

## 失败现场（run 38773915254）

1. `登录成功… title=神机 expected=shenji`（日志里 expected 被 redact 成 `***`）
2. `侧边栏底部只剩「更多」… leaked=["定时任务",…] visibleButtons=11` → `「更多」浮层… open=NOT_FOUND` → 面板 click 级联 `NOT_FOUND`
3. `账户卡折叠行… rowText="Aadmin·0"`；浮层文案已是 Token 用量，仍断言 `账户余额`/`¥88.50`

## 根因

### 1. 品牌标题：断言用了 product_name slug

- `channel.json`：`desktop.product_name=shenji`（安装包/ASCII），`desktop.window_title` / `identity.title=神机`（窗口标题）
- 运行期 `document.title` = window_title（`desktop-channel.ts`）
- E2E 用 `packagedProductName()`（读 product_name）对标题 → 永远 `神机 ≠ shenji`

### 2. 「更多」：产品已改回逐行直显，E2E 仍量并道态

- `FootNavRows.tsx`（2026-10 内网交付）：五个入口常显，不再经 `.pico-foot-menu-trigger`
- E2E 仍要求「更多」折叠 + 浮层条目 → 把**正确产品行为**判红；面板入口 click 全挂

判定：**产品行为正确**（非 selector 漂移），修 E2E。

### 3. 账户行：UI 已改 Token 用量，E2E 仍量余额主数字

- `AccountCard.tsx`：内网交付不再渲染 ¥/账户余额，折叠行 = 用户名 · Token 总数
- fixture 原 `total_usage=0` → 行文案 `Aadmin·0`；余额数据链路（88.5）本身 PASS

判定：对齐 E2E + 给 fixture 非零 `total_usage`，便于量到主数字。

## 改动

1. **`channel-build.ts`**：`packagedWindowTitle()`（`window_title` → `identity.title` → `display_name` → product_name）；`readChannelDesktopBranding` 增 `windowTitle`
2. **`e2e-client.mjs`**
   - 登录标题断言改用 `WINDOW_TITLE`
   - 底部：断言五条 `.pico-foot-nav-row` 常显 + 设置 + 账户行、无「更多」触发器；`clickFootMenuItem` 直接点导航行
   - 账户：折叠行/浮层断言 Token 主数字与「Token 用量」/「退出登录」；保留 balance 数据链路断言
3. **`e2e-fixture-gateway.mjs`**：`total_usage=1234`，补 `input_tokens`/`output_tokens`
4. **`verification-brand-agnostic.spec.ts`**：window_title ≠ product_name 单测

Green-16–19 保留。未改产品 FootNav / AccountCard 源码（口径已是内网交付目标）。

## 本机验证

- `node --check` e2e-client / fixture → OK
- `vitest` `verification-brand-agnostic.spec.ts` → 9 passed
- 完整 Electron E2E 需 GHA Xvfb + 打包产物

## push 记录

- Tip SHA：`1f9e39972fea`
- 远程分支：`boss/shenji/intranet`
- CI：（push 后 `gh run list`）
