# picoaide-harness-dev

<img src="brands/project/logo.svg" alt="项目现用 Logo" width="80" />

这是 `wll573` 的个人开发仓，用于维护基于 DeepSeek Harness 的桌面客户端、服务端、模型网关和自动化验证环境。

桌面端负责会话、工作区、工具与交互；服务端负责账号认证、模型接入、组织管理、用量审计和共享能力。客户端连接服务端后获取可用模型与能力配置，模型供应商密钥由服务端管理。

本仓库不是上游项目的官方发布仓，也不代表上游项目。当前开发分支为 **`integration/intranet-merge`**；上游代码通过 **`deepseek-harness/` 固定版本子模块**接入。功能与安装包以对应分支、提交和验证记录为准。

## 快速导航

| 需要做什么 | 入口 |
| --- | --- |
| 学习客户端操作 | [客户端图文教程](docs/client-guide.md) |
| 加入协作开发 | [协作开发指南](CONTRIBUTING.md) |
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

## 最近完成的改进

| 内容 | 变化 | 对应提交 |
| --- | --- | --- |
| 本地账号数据隔离 | 会话原始记录、索引和投影缓存按服务端与账号分别保存；切换账号时完整重启宿主 | `7583a21a4` |
| 注册成功提示 | 注册后提示联系管理员审批，不再立即尝试登录 | `7df219b05` |
| 白天主题侧边栏 | 根据解析后的主题设置背景，避免部分电脑在白天主题下显示黑色 | `a8eee098b` |
| 本地渠道构建 | 支持私有的本地默认渠道，减少重复打包时的渠道选择错误 | `bd20b5eb6` |
| 客户端图文教程 | 补充登录、工作区、对话、设置、能力中心与账户等操作说明 | `cd589392a` |

本分支还包含定时任务入口、工作区服务注入、客户端面板自动化验证，以及网关供应商和输入 / 输出 Token 的审计记录等改进。

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

## 提交与贡献

准备加入项目请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)：其中说明邀请协作者、Fork、创建功能分支、验证与提交 PR 的完整流程。

功能改动使用小而清晰的提交，完成相关验证后推送到开发仓。Pull Request 应说明最终行为、验证结果和未验证范围。

公开仓保存代码、通用文档与批准的公共素材。部署数据库、登录状态、密钥、本地渠道资料、临时测试数据及未采用的设计预览不属于源码提交。提交前确认 `git status` 和暂存区内容，避免误上传私有资料。

本开发仓的推送目标是 `wll573/picoaide-harness-dev`；`origin` 等本机远端别名可能指向上游，推送前用 `git remote -v` 核对。

## 许可证与来源

许可证见 [LICENSE](LICENSE)。上游版本以 `deepseek-harness/` 子模块指针为准，第三方组件保留各自的许可证与来源说明。
