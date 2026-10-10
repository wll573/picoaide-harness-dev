# Phase4-Batch4A 中文文案扫描清单

本批只注入本地私有渠道配置；渠道目录由仓库忽略规则保护，不进入公开仓库。

## 改动路径

- `channels/<channel-id>/channel.json`：私有渠道配置（显示名、登录/门户/客户端文案、ASCII 安装标识、素材文件名）。
- `channels/<channel-id>/logo.svg`：浅色渠道素材，来自老板仓 brands/project 的本地副本。
- `channels/<channel-id>/logo-dark.svg`：深色渠道素材，来自老板仓 brands/project 的本地副本。
- `channels/<channel-id>/app-icon.png`：安装器与桌面图标素材，来自老板仓 brands/project 的本地副本。
- `channels/<channel-id>/favicon.svg`：门户/登录页 favicon 素材，本地私有渠道资源。

## 用户可见面检查

- 登录：`copy.login_display_name`、`copy.login_tagline`、`copy.login_welcome` 使用中文渠道文案。
- 门户：`copy.portal_welcome` 使用中文渠道文案。
- 关于/客户端：`identity.*` 与 `copy.client_*` 使用中文渠道名与标语。
- 安装标识：`desktop.product_name`、`desktop.shortcut_name`、`desktop.slug` 使用 ASCII 安装名；`desktop.app_id` 使用 ASCII 标识。
- 协议标识：`deep_link_scheme`、`app_origin_scheme` 保留 ASCII 值以满足系统注册与跨端协议契约；不属于用户可见主品牌。

## 扫描结论

- 渠道配置字段齐全：`channel_id`、身份与文案、三类素材、`slug`、`app_id`、深链与应用源协议、独立数据目录均已填写。
- 未对全仓做字符串替换；未修改协议实现、测试夹具或上游子模块。
- 公开仓提交不包含私有渠道 JSON、logo 或密钥。
