# Phase4-Batch4A 中文文案扫描清单

本批只注入本地私有渠道配置；渠道目录由仓库忽略规则保护，不进入公开仓库。

## 改动路径

- `channels/shenji/channel.json`：私有渠道配置（显示名、登录/门户/客户端文案、ASCII 安装标识、素材文件名）。
- `channels/shenji/logo.svg`：浅色渠道素材，来自老板仓 `picoaide-harness-dev/brands/project/`。
- `channels/shenji/logo-dark.svg`：深色渠道素材，来自老板仓 `brands/project/`。
- `channels/shenji/app-icon.png`：安装器与桌面图标素材，来自老板仓 `brands/project/`。
- `channels/shenji/favicon.svg`：门户/登录页 favicon（与浅色 logo 同源副本）。

## Logo 来源

- 对照：`picoaide-harness-dev@dcceefe07a` 的 `brands/project/{logo.svg,logo-dark.svg,app-icon.png}`。
- 私有目录 `channels/shenji/` 不进公开 git；打包时注入。

## 用户可见面检查

- 登录：`copy.login_display_name`、`copy.login_tagline`、`copy.login_welcome` →「神机」等中文文案。
- 门户：`copy.portal_welcome` → 中文渠道文案。
- 关于/客户端：`identity.*` 与 `copy.client_*` → 中文渠道名与标语。
- 安装标识：`desktop.product_name` / `shortcut_name` / `slug` = ASCII `shenji`；`desktop.app_id` = `com.shenji.desktop`。
- 协议标识例外：`deep_link_scheme=shenji`、`app_origin_scheme=shenji-app`（系统注册/跨端契约，非用户可见主品牌）。

## 扫描结论

- 渠道配置字段齐全：`channel_id`、身份与文案、三类素材、`slug`、`app_id`、深链与应用源协议、独立数据目录均已填写。
- 未对全仓做字符串替换；未修改协议实现、测试夹具或上游子模块；未做 4B/4C/4D。
- 公开仓提交不包含私有渠道 JSON、logo 或密钥。
- 可见面主品牌经渠道配置覆盖；硬编码官方 fallback 保留给非 shenji 构建（避免盲 replace）。
