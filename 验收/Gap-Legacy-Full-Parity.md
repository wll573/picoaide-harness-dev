# Gap-Legacy-Full-Parity

对照源：legacy tip `dcceefe07a`  
当前仓迁移前 tip `0a7d3fa3a2`  
基线：legacy README「本次更新」+ 提交索引 + `8757735dd..dcceefe` 修复提交。

故意不迁（老板已定）：审计强制加密（AuditPlain）；公网上游品牌（神机 intranet）。

| 项 | legacy 证据 | tip 状态 | 备注 |
| --- | --- | --- | --- |
| 左侧导航直显 FootNav | README L49; cc990d662 | 已在 tip | Gap-UX-Parity |
| 面板切换 | README L50 | 已在 tip | panel-surface + foot-menu |
| 账户 Token 用量 | README L51 | 已在 tip | Token-only 主路径 |
| 白天主题侧边栏 | a8eee098b | 已在 tip | Gap-SidebarTheme |
| 账号会话隔离 | 7583a21a4 | 缺失已补 | account-data + desktop/session |
| 登录地址记忆 | README L54 | 已在 tip | Gap-P1A last-server |
| 自助注册与审批提示 | 7df219b05 | 缺失已补 | auth-gate + register 代理 |
| 老 methods 无 registration 字段 | 8c695c295 | 缺失已补 | 与注册批一并 |
| 默认完全权限 | 8736b0b48 | 已在 tip | danger-full-access |
| cron uiWorkspace 依赖 | 1f665776f | 缺失已补 | inject 含 uiWorkspace |
| 门户/后台「单位」文案 | 6a16796a9 | 缺失已补 | portal/webadmin |
| 供应商适配与思考映射 | README L64-66 | 已在 tip | channels + bootstrap |
| 思考档位消失 | 9ec3ec96d | 已在 tip | Messages model-info 等价 |
| toolcall 名重复 | 33bd6752b | 故意偏离 | ChatCompletions 专修；当前 Messages |
| 多 Key/隐藏模型/SSE 心跳等 | README L67-72 | 已在 tip | phase1 |
| OpenAI 渠道映射 | a8afcaa476 | 已在 tip | Register/Get 归一 + 单测 |
| 全文审计主体 | README L80-86 | 已在 tip | phase3 |
| 审计强制加密 | 0fc9781cd | 故意偏离 | AuditPlain |
| 审计按 session 分组 | dcceefe07a | 缺失已补 | webadmin UI + 测试 |
| 内置应用离线打包 | dcceefe07a | 已在 tip | --out-dir + offline seed |
| Token 口径/ManagedConfig | README L92-95 | 已在 tip | Gap-P1A |
| 内网 HTTP/离线/Windows | README L104-108 | 已在 tip | phase2/4 |
| 默认渠道 shenji | bd20b5eb6 | 已在 tip | packaging/intranet-channel |
| 隐藏 mac/Linux 下载 | fc79f3bf30 | 已在 tip | 仅 Windows x64 |
| 公网品牌 | 公开仓纪律 | 故意偏离 | 神机 intranet |
| CI Green-4..7 | tip 历史 | 已在 tip | 不重做；不跟踪 channels/ |

## 计数

- 已在 tip：22
- 缺失已补：6（账号隔离、注册审批+legacy methods、cron uiWorkspace、单位文案、审计按会话 UI、OpenAI 渠道单测）
- 故意偏离：3（审计加密、公网品牌、toolcall ChatCompletions）
- 仍缺：0

## 测试

- host-home：86 passed
- cron client-surfaces：7 passed
- enterprise registration / account-data / session-switch / login：passed
- desktop profile-account-data：2 passed
- go channels + portal：ok
- webadmin Audit.test：25 passed

## 残留风险

- toolcall：若 Messages 路径现场复现，另开调查。
- 账号切换会 requestRestart()，需 E2E 确认不串会话。
