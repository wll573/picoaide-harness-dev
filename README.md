# picoaide-harness-dev

<img src="brands/project/logo.svg" alt="项目现用 Logo" width="80" />

这是 `wll573` 的个人开发仓，用于维护基于 DeepSeek Harness 的桌面客户端、服务端、模型网关和自动化验证环境。

桌面端负责会话、工作区、工具与交互；服务端负责账号认证、模型接入、组织管理、用量审计和共享能力。客户端连接服务端后获取可用模型与能力配置，模型供应商密钥由服务端管理。

本仓库不是上游项目的官方发布仓，也不代表上游项目。当前开发分支为 **`integration/intranet-merge`**；上游代码通过 **`deepseek-harness/` 固定版本子模块**接入。功能与安装包以对应分支、提交和验证记录为准。

## 快速导航

| 需要做什么 | 入口 |
| --- | --- |
| 学习客户端操作 | [客户端图文教程](docs/client-guide.md) |
| 查看相对原项目的改动 | [本次更新](#本次更新) |
| 从源码启动客户端 | [开发环境与客户端启动](#开发环境与客户端启动) |
| 启动服务端和管理后台 | [服务端本地开发](#服务端本地开发) |
| 了解注册与历史记录 | [注册审批与账号数据](#注册审批与账号数据) |
| 生成安装包 | [客户端打包与品牌](#客户端打包与品牌) |
| 运行检查 | [测试与验证](#测试与验证) |
| 排查运行问题 | [常见问题](#常见问题) |
| 部署、升级与回滚 | [部署与维护](#部署与维护) |

## 主要功能

| 模块 | 功能 |
| --- | --- |
| 对话与工作区 | 新建和继续会话、搜索历史、选择目录、引用文件、执行工具 |
| 桌面界面 | Electron 客户端、白天 / 夜间 / 跟随系统主题、侧边栏、设置和账户入口 |
| 模型网关 | 统一配置供应商、密钥、模型与协议，记录请求和用量 |
| 账号与组织 | 本地账号认证、可配置的 LDAP / OIDC、注册审批、用户与部门管理 |
| 能力中心 | 浏览、安装和管理服务端提供的技能、Agent 等能力 |
| 连接器与浏览器 | 连接外部工具，使用浏览器相关功能 |
| 定时任务 | 创建周期任务、立即执行、查看执行结果 |
| 应用中心 | 浏览与使用服务端提供的应用 |
| 自动化验证 | 单元测试、类型检查、仓库守卫、打包校验、客户端 E2E 与真实环境验证 |

可用模型、登录方式、能力与权限由实际连接的服务端决定。图文教程使用中性品牌与演示数据，具体界面可能随渠道配置变化。

## 本次更新

本节记录在原 `picoaide-harness` 基础上合入本开发分支的修改，基线为共同祖先 **`8757735dd`**（`v2.8.2-beta.3` 交付说明所在提交），按 `8757735dd..HEAD` 的实际差异整理。这里列的是本分支新增或修改的行为；上方“主要功能”介绍的是整个项目的能力，两者范围不同。

### 1. 客户端界面与日常操作

| 修改项 | 当前行为 | 主要代码位置 |
| --- | --- | --- |
| 左侧导航直显 | 定时任务、能力中心、连接器、浏览器、应用中心从“更多”浮层改为独立入口；收紧行高、间距与内边距，保留折叠图标、激活态和等待提示 | `packages/client/foot-menu/` |
| 面板切换 | 同步导航选中状态与面板焦点，处理面板关闭后状态清理，完善客户端插件之间的导航交接 | `packages/client/panel-surface/`、`packages/client/foot-menu/` |
| 账户显示 Token 用量 | 账户卡主展示改为输入、输出、总 Token，并显示今日 / 当月用量；缺数据与零用量分别处理 | `packages/client/account-card/` |
| 白天主题侧边栏 | 使用解析后的主题背景，修复部分电脑开启白天主题但侧边栏仍为黑色的问题 | `packages/host/desktop/src/client/styles.ts` |
| 账号会话隔离 | 按服务端地址与用户名保存会话、索引和缓存；切换身份时完整重启宿主，避免混入前一个账号的数据 | `packages/host/host-home/src/account-data.ts`、desktop `main.ts` / `profile.ts`、enterprise `session-service.ts` |
| 登录地址记忆 | 保存最近连接的服务端地址；退出登录后可直接进入该服务端的账号登录流程 | `packages/host/enterprise/src/session-service.ts`、`auth-gate.ts` |
| 自助注册与审批提示 | 从服务端读取注册开关；注册成功提示联系管理员审批，不再立即登录并误报账号或密码错误 | `packages/host/enterprise/src/auth-gate.ts`、`server/internal/serverauth/` |
| 审批面板与默认权限 | 将工具执行审批面板纳入桌面配置，默认权限档位设为完全权限；仍由实际工具权限和审批机制控制执行 | `packages/host/desktop/src/profile.ts` |
| 定时任务服务依赖 | 显式依赖工作区 UI 服务，修复定时任务页面缺少服务注入的问题 | `packages/host/cron/src/client/index.ts` |
| 本地化与文案 | 调整客户端、管理后台和门户相关文案，统一使用“单位”等称呼，并同步导航与用量相关语言项 | client locales、`server/internal/portal/`、`server/webadmin/src/pages/` |

### 2. 模型网关与思考参数

| 修改项 | 当前行为 | 主要代码位置 |
| --- | --- | --- |
| 供应商适配 | 新增 Qwen、GLM、MiniMax、Hunyuan 的兼容适配；沿用配置的供应商地址进行模型发现与请求转发 | `server/internal/llmgateway/channels/` |
| 思考档位映射 | 将客户端的 off / low / high / max 按适配器转换为上游参数；Qwen 对应 none / low / medium / xhigh，移除冲突或不支持的参数 | `channels/qwen.go`、`channels/openai_compat.go`、`upstream.go` |
| 按模型呈现思考选项 | 支持模型级 `_thinking_adapter`，可以显示不同档位、只显示关闭 / 默认，或隐藏选择器；从模型参数解析上下文窗口 | `packages/host/enterprise/src/bootstrap.ts` |
| 多 API Key 管理 | 同一供应商维护多把加密 Key，支持标签、启停、优先级、重置与删除，旧单 Key 可迁移到池中 | `keypool.go`、网关 `admin.go`、`serverstore/provider_keys.go` |
| 轮询、重试与冷却 | 分配可用 Key；网络错误和指定上游错误可换 Key 重试，失败后冷却；记录使用、成功、失败与最近错误 | `server/internal/llmgateway/keypool.go` |
| Key 成功率展示 | 管理后台显示每把 Key 的成功次数、请求次数与成功率；没有样本时显示暂无数据 | `server/webadmin/src/pages/Gateway.tsx` |
| 隐藏不需要的模型 | 增加独立的管理员隐藏开关，客户端模型列表过滤隐藏模型；目录同步不会覆盖管理员的隐藏意图 | `serverstore/gateway.go`、`llmgateway/models.go`、`Gateway.tsx` |
| 上游调用策略 | 增加供应商级超时、最大 Key 尝试次数、Chat Completions 与 Responses 开关，并在转发路径执行这些配置 | `llmgateway/admin.go`、`upstream.go`、`handler.go` |
| 流式心跳 | 上游沉默期发送 SSE 心跳，降低中间代理因空闲关闭长请求的风险 | `server/internal/llmgateway/handler.go` |

模型最终可用性仍取决于实际服务端配置、上游协议与访问权限。某台部署机上调整的密钥、模型参数和用户授权保存在数据库中，不会因为提交源码自动同步到其他环境。

### 3. Prompt / Response 全文审计

| 修改项 | 当前行为 | 主要代码位置 |
| --- | --- | --- |
| 网关全文留存 | 在相关网关路由记录原始请求和响应；流式响应按加密分块保存，避免一次性积累完整流到内存 | `llmgateway/transcript_middleware.go`、`serverstore/transcript.go` |
| 审计详情字段 | 记录模型、实际供应商、输入 / 输出 / 总 Token、耗时、流式状态、会话 / 工作区标签和错误信息 | `serverstore/transcript.go`、`llmgateway/handler.go` |
| 完整性状态 | 区分进行中、完整、未正常收尾与本地写入失败，避免将上游 HTTP 200 但截断的流当作正常完成 | `llmgateway/handler.go`、`transcript_middleware.go` |
| 正文可读展示 | 从 Chat Completions、Anthropic 和 Responses JSON / SSE 中提取可读的用户输入与模型回复，同时保留原始数据 | `serverauth/transcript_readable.go`、`webadmin/src/components/transcript-detail.tsx` |
| 查询与导出 | 提供分页、用户 / 模型 / 会话 / 时间等筛选、详情与 CSV 导出，保留对应管理权限控制 | `serverauth/transcript_admin.go`、`webadmin/src/pages/Audit.tsx` |
| 留存与敏感操作日志 | 将全文审计留存任务接入调度；敏感操作日志与 LLM 请求 / 响应展示分开整理 | `server/internal/auditretention/`、`webadmin/src/pages/SystemLogs.tsx` |
| 审计计量补齐 | 将最终计量的输入 / 输出 Token 和命中的供应商传递到审计结果，减少有用量但详情字段为空的问题 | `llmgateway/handler.go`、`transcript_middleware.go` |

### 4. 管理后台与托管客户端

| 修改项 | 当前行为 | 主要代码位置 |
| --- | --- | --- |
| 管理后台 Token 口径 | 调整概览、成员、部门、模型、日志、报告和账户相关页面，以 Token 统计作为主要展示；对应服务端查询补齐计数 | `server/webadmin/src/pages/usage/`、`serverstore/usage.go`、`serverauth/handler.go` |
| 托管配置管理 | 增加管理员配置界面和客户端策略接口，保存用户设置、Skill 策略和设备同步状态 | `server/internal/managedconfig/`、`serverstore/managed_client_policy.go`、`webadmin/src/pages/ManagedConfig.tsx` |
| 默认模型与思考档位下发 | 客户端登录与同步时应用服务端指定的默认模型和 reasoning effort，并处理旧服务端缺少策略接口的情况 | `packages/host/enterprise/src/managed-policy.ts`、`bootstrap.ts` |
| Skill 策略执行 | 支持必装、允许与禁止策略；按策略下载、核对版本 / 校验值、安装或移除 Skill，并上报客户端执行状态 | `managed-policy.ts`、`skill-install.ts` |
| 权限与路由同步 | 为新审计和托管页面补齐客户端接口、管理接口、后台导航、路由与 RBAC 声明 | `server/internal/router/`、`serverauth/rbac.go`、`webadmin/src/lib/` |

Token 展示调整不等于删除原有计费与余额账本；底层资金记录仍按服务端实现保留。

### 5. 内网部署、离线构建与更新

| 修改项 | 当前行为 | 主要代码位置 |
| --- | --- | --- |
| 内网 HTTP 适配 | 增加 HTTP 部署的 Caddy / Compose 入口与运行配置；客户端连接、技能安装、安装包下载和更新地址支持部署所需的 HTTP 表面 | `server/Caddyfile.http`、`docker-compose.http.yml`、desktop / enterprise 的地址处理 |
| 更新说明与发布放行 | 扩展客户端发布元数据和更新说明，在客户端更新流程展示相关信息；调整运行配置与下载校验的接入 | `server/internal/clientrelease/`、desktop `desktop-release.ts` / `updates.ts` / `update-download.ts` |
| 服务端离线构建 | 新增联网准备、Go / npm / Yarn / pnpm 缓存、Ubuntu 工具链、基础镜像、服务端镜像导入导出和 SHA256 校验流程 | `packaging/offline/`、`server/Dockerfile`、`server/Makefile` |
| Windows 离线打包 | 新增 Windows 工具链与依赖缓存准备、缓存恢复、原生安装包构建与登记流程 | `packaging/offline/*.ps1`、`register-windows-installer.sh` |
| 本地构建与 WSL 同步 | 扩展本机构建矩阵，提供 Windows / WSL 同步脚本；同步脚本中的本机路径需要按实际环境配置 | `packaging/local-build-matrix.mjs`、`scripts/wsl-sync.*` |
| 本地默认渠道 | 显式环境变量优先，非 CI 环境可读取私有 `channels/.build-default`，减少重复打包时的渠道遗漏 | `packages/host/desktop/scripts/channel-build.ts` |
| 项目 Logo 素材 | 将现用主 Logo、深色版和应用图标原样公开到独立目录，并在 README 展示；未采用的概念稿不进入发布素材 | [brands/project](brands/project/README.md) |

### 6. 数据迁移、文档与验证

本分支新增 PostgreSQL 迁移 **0083–0089**，分别覆盖全文审计 / 加密响应分块、供应商 Key 池、托管策略与设备、审计详情字段、Key 成功率、模型隐藏、供应商调用策略。相应迁移校验、查询、测试与数据库说明同步调整。升级前须备份数据库和加密主密钥。

文档补充了[客户端图文教程](docs/client-guide.md)、[内网部署说明](docs/deploy/INTRANET-UBUNTU24-WINDOWS.md)、[离线构建说明](packaging/offline/README.md)和[插件清单](docs/deploy/DEEPSEEK-HARNESS-PLUGIN-INVENTORY.md)。本次文档整理删除无关 AI 工具入口 / 提示词材料及协作开发指南，并清理引用与对应的构建校验依赖。

验证方面新增或修订了网关适配、Key 池、思考参数、全文审计、流式心跳、管理后台、账号隔离、注册审批、导航面板与主题测试；客户端 E2E 和真实环境脚本同步当前 UI、模拟接口与定时任务流程。合并过程还修复了类型 / 构建缺口、跨平台断言、数据库迁移范围、路由契约和测试夹具漂移。

公开基础镜像源与包源的域名守卫登记也作了必要调整。上述验证代码属于分支修改的一部分，具体运行结果以[测试与验证](#测试与验证)及 CI 记录为准，不能仅凭测试文件存在就认定全部功能已经验证。

### 7. 追溯本分支修改

使用固定基线可以检查全部修改文件与提交，不依赖上游分支后续是否继续更新：

```sh
git diff --stat 8757735dd..HEAD
git diff --name-status 8757735dd..HEAD
git log --reverse --oneline 8757735dd..HEAD
```

关键提交索引：

| 范围 | 提交 |
| --- | --- |
| 初始服务端、客户端、网关与离线交付合入 | `2a3715269`、`c06341ca4`、`f97e7a638`、`c71f904a1` |
| 编译与跨平台收口、审批面板、迁移约束与测试修正 | `9b333506e`、`8736b0b48`、`2c607e8f0`、`b17b84da4` |
| 全文审计与供应商 / Token 计量 | `637aa1d4e`、`980b462eb` |
| Key 轮询、成功率与模型隐藏 | `8a10934ad` |
| 客户端导航与管理后台 Token 用量 | `cc990d662`、`7548d9634` |
| 更新说明、部署与流式心跳 | `b7695ce75`、`257008c1c` |
| 定时任务、UI 自动化和公开包源登记 | `1f665776f`、`c57f19a1b`、`116a101cc` |
| 需求基线、开发仓说明、单位文案与使用教程 | `5435ebfe2`、`a3c015342`、`6a16796a9`、`cd589392a` |
| 本地默认渠道、白天主题、注册审批与账号隔离 | `bd20b5eb6`、`a8eee098b`、`7df219b05`、`7583a21a4` |
| README 扩充与现用 Logo 公开 | `5917c2695`、`7edb20cf3` |

## 仓库结构

| 路径 | 用途 |
| --- | --- |
| `packages/host/desktop/` | Electron 启动、桌面界面、主题、打包与平台验证 |
| `packages/host/enterprise/` | 登录、会话身份、服务端连接、网关与企业能力 |
| `packages/host/host-home/` | 安装数据目录与账号会话目录的解析 |
| `packages/host/cron/` | 定时任务服务及测试 |
| `packages/host/connectors/`、`packages/host/browser/` | 连接器与浏览器服务 |
| `packages/host/wasm-apps-host/` | 应用运行相关的宿主服务 |
| `packages/client/` | 账户、品牌与侧边栏功能等客户端插件 |
| `server/cmd/`、`server/internal/` | Go 服务端入口、认证、网关、数据访问与业务接口 |
| `server/webadmin/` | 编译进服务端二进制的 Web 管理后台 |
| `server/skills/` | 随服务端分发的技能资源 |
| `brands/official/` | 官方品牌图形的源文件 |
| `docs/`、`integration-tests/` | 使用教程、部署说明、设计记录与集成验证 |
| `scripts/`、`packaging/` | 仓库守卫、构建与交付工具 |
| `deepseek-harness/` | 固定版本的上游子模块；桌面功能开发不直接修改其文件 |

## 开发环境与客户端启动

### 环境要求

- Node.js **`^22.19.0` 或 `>=24.0.0`**，以根目录 `package.json` 为准。
- Corepack，以及根目录指定的 **Yarn `4.18.0`**。
- Git，用于初始化上游子模块。
- 服务端开发还需要 Go **`1.26.6` 或兼容更新版本**、PostgreSQL、npm 与 make。生产数据库使用 PostgreSQL 18。
- Windows 上可在 PowerShell 开发和打包客户端，在 WSL / Linux 中开发 Go 服务端；不同系统的依赖目录分别安装。

根工作区使用 Yarn；`deepseek-harness/` 保留上游 pnpm 工作区；`server/webadmin/` 使用自己的 npm 锁文件。

### 获取代码与依赖

```sh
git clone --branch integration/intranet-merge --recurse-submodules https://github.com/wll573/picoaide-harness-dev.git
cd picoaide-harness-dev
corepack enable
git submodule update --init --recursive
corepack yarn install --immutable
```

如果 `--immutable` 报告锁文件需要修改，应先核对当前分支的包清单与 `yarn.lock` 是否同步。不要把关闭不可变检查后的安装当作可重复构建验证。

### 构建并启动

首次启动前先构建工作区依赖，避免干净检出缺少 `lib/` 或类型声明：

```sh
corepack yarn prebuild
corepack yarn dev
```

`dev` 会构建桌面包并启动客户端。已有构建产物时可用 `corepack yarn start`。首次登录输入服务端基础地址，例如本机联调的 `http://localhost:8080`，然后使用已启用的账号登录。

客户端连接地址不应包含管理后台的 `/admin/` 路径。服务端运行在 WSL、容器或另一台机器时，先确认客户端所在系统能访问该地址。

上游依赖需要单独安装或构建时，从根目录执行：

```sh
corepack yarn upstream:install
corepack yarn upstream:build
```

## 服务端本地开发

### 准备与构建

先准备可访问的 PostgreSQL 数据库，再在 Bash / WSL 中执行：

```sh
cd server
npm --prefix webadmin ci
make build-server
```

`make build-server` 先构建管理后台，再生成 `bin/picoaide-server` 和应用编译辅助程序。单独执行 `go build` 不能代替完整的管理后台构建。

### 启动与首次管理员初始化

在本机环境设置 `PICOAI_PG_DSN` 和 `PICOAI_ADMIN_PASSWORD` 后执行：

```sh
: "${PICOAI_PG_DSN:?请先设置本机 PostgreSQL 连接串}"
: "${PICOAI_ADMIN_PASSWORD:?请先设置首次管理员密码}"
bin/picoaide-server \
  -addr :8080 \
  -data ./data \
  -db-driver pg \
  -pg-dsn "$PICOAI_PG_DSN" \
  --bootstrap-admin admin
```

`--bootstrap-admin` 与 `PICOAI_ADMIN_PASSWORD` 用于首次创建管理员，不能作为后续重置已有账号密码的方式。仓库没有适用于所有安装环境的统一默认登录密码。

| 用途 | 本机地址 |
| --- | --- |
| 管理后台 | `http://localhost:8080/admin/` |
| 健康检查 | `http://localhost:8080/healthz` |
| 客户端连接 | `http://localhost:8080` |

这些 HTTP 地址用于本机联调。部署环境的地址、证书、数据库凭据和账号应从实际部署配置获取。

### 模型接入

管理员在管理后台配置供应商、上游地址、密钥、模型 ID、支持的协议与用户权限，再检查客户端获取的模型列表。

模型 ID 必须与上游一致，网关适配协议须与模型能力匹配，账号也须有访问权限和可用额度。应通过真实请求与网关日志验证，不能仅以模型出现在下拉列表中作为接入成功的依据。

更多配置见 [服务端 README](server/README.md)、[API 文档](server/docs/03-api-reference.md)和[认证文档](server/docs/04-auth.md)。

## 注册审批与账号数据

### 自助注册

自助注册由服务端控制。启用时，在服务端进程环境中设置：

```sh
export PICOAI_SELF_REGISTRATION_ENABLED=1
```

修改环境变量后需重新启动服务端，并重新加载客户端登录页面。注册入口还要求本地账号登录可用且没有被隐藏；启用 LDAP / OIDC 不等同于开放本地账号注册。

注册流程：

1. 用户填写账号与密码，点击注册。
2. 服务端创建待审批账号。
3. 客户端显示“注册申请已提交，请联系管理员审批。审批通过后即可登录。”
4. 管理员在用户管理中审核并启用账号。
5. 用户使用注册时的账号与密码登录。

申请提交成功不代表账号已获准登录；重复注册也不会替代审批。

### 本地会话隔离

聊天历史相关数据按**服务端地址 + 用户名**分别保存。各账号使用独立的原始会话目录、存储索引与投影缓存，避免更换账号后继续显示前一个账号的历史。

目录结构示意如下，`<安装数据目录>` 由当前渠道配置与桌面启动逻辑决定：

```text
<安装数据目录>/
├── account-data.json         # 下一次启动的账号标识；不保存令牌
├── session.json              # 当前安装的登录状态
├── accounts/
│   ├── <账号身份的 SHA256>/
│   │   ├── sessions/          # 该账号的原始会话
│   │   └── storages/          # 该账号的索引与缓存
│   └── signed-out/            # 未选择账号时的存储范围
├── sessions/                 # 升级前可能保留的共享会话
└── storages/                 # 升级前可能保留的共享索引
```

切换到不同账号或服务端时，客户端先保存新登录状态，再完整关闭旧宿主并重新启动，让数据服务重新绑定到正确目录。同一账号重新登录后可继续访问自己的历史。

安装级设置与凭据不因为这次改动全部改为按账号存储；该机制也不等同于对同一操作系统用户设置文件访问权限。

旧共享会话没有可信的账号归属信息，因此不会自动把全部历史分给新账号。恢复旧记录时，应先完整备份，再结合明确的会话名称、消息时间和使用者确认归属，同时迁移原始日志及对应索引。不要只改标题，也不要直接删除旧目录。

## 客户端打包与品牌

在对应平台准备好依赖后，从根目录运行：

| 交付物 | 命令 |
| --- | --- |
| 解包运行目录 | `corepack yarn package:dir` |
| Windows x64 安装包 | `corepack yarn dist:win` |
| Windows x64 便携包 | `corepack yarn dist:win-portable` |
| macOS 发布包 | `corepack yarn dist:mac` |
| macOS 本地冒烟包 | `corepack yarn dist:mac-smoke` |
| Linux 包 | `corepack yarn dist:linux` |

产物位于 `packages/host/desktop/dist/`，文件名随版本与渠道变化。打包脚本默认执行依赖预构建、对应检查与产物校验；正式交付应保留这些步骤。macOS 发布签名与公证需要额外凭据。

当前项目现用的主 Logo、深色版与应用图标已按负责人要求公开保存于 [brands/project](brands/project/README.md)，方便协作者获取素材。此前未采用的设计预览不在其中。

官方构建的图形源文件仍在 `brands/official/`；私有渠道名称、安装器文案、默认服务端与完整渠道配置仍由本机或私有资料提供。公开 Logo 素材不等于公开渠道配置，也不会自动切换构建品牌。

渠道选择顺序为：显式的 `DSH_BUILD_CHANNEL` → 非 CI 环境的本地 `channels/.build-default` → `official`。选择客户渠道时，本机还必须存在对应的私有配置与素材；只设置环境变量不能补齐品牌资料。

PowerShell 中显式构建官方渠道的示例：

```powershell
$env:DSH_BUILD_CHANNEL = 'official'
corepack yarn dist:win
Remove-Item Env:DSH_BUILD_CHANNEL
```

本地渠道配置、派生图标与安装包按忽略规则保留在本机。项目 Logo 修改获准后，应更新 `brands/project/` 并同步到本地渠道素材，再验证桌面图标、托盘、侧边栏和安装器；设计概念预览不会自动成为发布素材。

## 测试与验证

### 常用检查

```sh
corepack yarn typecheck
corepack yarn test
corepack yarn check:fast
corepack yarn check
git diff --check
node scripts/check-no-real-domains.mjs
```

根目录 `typecheck` 和 `test` 针对 enterprise 与 desktop；`check` 是覆盖更多工作区与根守卫的完整编排。`check:fast` 按当前改动选择检查范围，不能用其结果代替未运行的全量检查。

如果原生 Windows 环境的守卫运行遇到权限或工具链问题，应在已配置的 WSL / Linux 环境中实际运行，不能直接跳过并标记通过。

### 注册与账号隔离回归

从根目录可以单独运行本次修复的相关测试：

```sh
corepack yarn workspace @picoaide/dsh-host-home test tests/account-data.spec.ts
corepack yarn workspace dsh-plugin-desktop test tests/profile-account-data.spec.ts
corepack yarn workspace @picoaide/dsh-enterprise test tests/session-service-account-data.spec.ts tests/session-service-late-401.spec.ts tests/auth-gate-session-switch.spec.ts tests/deep-link.spec.ts tests/auth-gate-registration.spec.ts
```

2026-10-06 本机验证中，上述测试共 **39 项通过**，并完成真实打包客户端的历史显示、账号切换自动重启与新会话保存验证。这只代表对应提交的相关测试，不表示所有平台或全量测试均通过。

### 服务端测试

在 `server/` 目录执行：

```sh
go test -p 1 ./internal/llmgateway ./internal/serverstore
make check
```

数据库测试需要可访问的测试 PostgreSQL，可用 `PG_DSN_TEST` 指定连接串。辅助程序会创建和清理临时数据库，测试账号需有相应权限，应使用独立测试环境。数据库不可达时，部分用例会跳过；检查输出中的 `SKIP`，不能把此类运行当作数据库逻辑已验证。

### 客户端 E2E

已有打包产物和图形环境后，可运行：

```sh
corepack yarn workspace dsh-plugin-desktop e2e:client
corepack yarn workspace dsh-plugin-desktop e2e:sidebar
corepack yarn workspace dsh-plugin-desktop e2e:terminal
```

这些脚本通常需要 Linux 显示环境 / Xvfb 与相应自动化依赖，不属于普通无界面的单元测试。真实环境脚本 `e2e:real` 使用 `REAL_SERVER`、`REAL_USER`、`REAL_PASS`；凭据仅放在本机环境，不提交到 Git。

报告、截图与运行要求见 [桌面包 README](packages/host/desktop/README.md)和[集成测试说明](integration-tests/README.md)。

## 常见问题

| 现象 | 优先检查 |
| --- | --- |
| 找不到注册按钮 | 服务端是否开放注册，本地登录是否可用 / 被隐藏，登录页是否刷新 |
| 注册完成后无法登录 | 账号是否仍待审批；先由管理员启用账号 |
| 模型不存在或不可用 | 模型 ID、启用状态、用户授权、支持的协议、额度与网关错误日志 |
| 模型在列表中但请求失败 | 上游密钥、地址、请求参数与协议适配；用真实请求验证 |
| 白天主题侧边栏仍为黑色 | 是否运行包含主题修复的新构建；对比三种主题并记录操作系统版本 |
| 切换账号后看到别人的历史 | 是否仍运行旧构建；确认宿主已重启并使用对应的 `accounts/` 目录 |
| 升级后找不到原来的历史 | 旧共享数据不会自动认领；备份后核实归属再迁移 |
| 拉取代码后界面没有更新 | 是否启动旧安装包或旧进程；重新构建 / 打包并核对运行路径 |
| 服务端修改没有生效 | 管理后台是否重建、运行的二进制是否更新、环境变量是否传入进程 |
| 提示模块或类型声明缺失 | 是否安装依赖、初始化子模块并运行 `corepack yarn prebuild` |
| Windows 路径或符号链接测试失败 | 区分代码问题与 POSIX 路径假设 / 符号链接权限问题，记录失败用例 |

反馈问题时建议提供版本或提交、操作系统、复现步骤、错误原文和脱敏日志，不要上传密码、令牌或供应商密钥。

## 部署与维护

部署、备份、升级、回滚与内网证书处理参考：

- [部署与升级执行说明](docs/deploy/AI-DEPLOY.md)
- [Ubuntu 24.04 服务端与 Windows 客户端内网部署](docs/deploy/INTRANET-UBUNTU24-WINDOWS.md)
- [服务端构建部署](server/docs/02-build-deploy.md)
- [服务端认证](server/docs/04-auth.md)
- [服务端架构](server/docs/01-architecture.md)
- [桌面插件服务架构](packages/host/desktop/docs/plugin-services.zh.md)

数据库、加密主密钥、账号资料与本地历史应独立备份。源代码提交、CI 产物、正式 Release 与实际部署是不同步骤；`git push` 不会自动更新运行中的服务端，也不会自动安装客户端。

只改 Markdown 的提交可能由 CI 判为文档变更并跳过二进制构建，查看 GitHub 时应以实际工作流结果和产物为准。

## 版本库与本地配置

公开仓保存代码、通用文档与批准的公共素材。部署数据库、登录状态、密钥、本地渠道资料、临时测试数据及未采用的设计预览不属于源码提交。提交前确认 `git status` 和暂存区内容，避免误上传私有资料。

本开发仓的推送目标是 `wll573/picoaide-harness-dev`；`origin` 等本机远端别名可能指向上游，推送前用 `git remote -v` 核对。

## 许可证与来源

许可证见 [LICENSE](LICENSE)。上游版本以 `deepseek-harness/` 子模块指针为准，第三方组件保留各自的许可证与来源说明。
