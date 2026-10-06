# 协作开发指南

本项目的开发仓是 `wll573/picoaide-harness-dev`，当前默认开发分支为 `integration/intranet-merge`。环境准备、构建与运行说明见 [README](README.md)。

## 1. 加入项目

长期协作者可以由仓库负责人在 GitHub 的 **Settings → Collaborators → Add people** 中邀请，接受邀请后获得协作者访问权限。

公开仓也可以采用 Fork 协作：从本仓 Fork 到个人账号，在自己的分支修改后向本仓提交 Pull Request，无需直接写入本仓。

GitHub 操作说明见 [邀请个人仓库协作者](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)。

## 2. 从开发分支开始

有本仓写权限的协作者可执行：

```sh
git clone --branch integration/intranet-merge --recurse-submodules https://github.com/wll573/picoaide-harness-dev.git
cd picoaide-harness-dev
git switch -c feat/your-feature
corepack yarn install --immutable
corepack yarn prebuild
```

后续新任务从更新后的开发分支建立独立分支：

```sh
git switch integration/intranet-merge
git pull --ff-only origin integration/intranet-merge
git switch -c fix/your-fix
```

上面的 `origin` 是从本开发仓克隆后得到的远端名。已有本地检出的远端可能不同，先用 `git remote -v` 确认，避免向上游仓误推送。

使用 Fork 时，先从本仓最新的 `integration/intranet-merge` 分支同步，再在 Fork 中创建功能分支。向本仓发起 PR 时，目标分支选择 `integration/intranet-merge`。

## 3. 约定改动范围

- 开始任务前在 Issue 或任务描述中写清问题、改动范围与预期结果。
- 使用 `feat/...`、`fix/...`、`docs/...` 等独立分支，每个分支尽量处理一个问题。
- `deepseek-harness/` 是固定版本上游子模块，普通客户端功能开发不直接修改其中的文件。
- 功能、文档与必要测试一起提交；不要夹带无关格式化、版本更新或数据库修改。
- 当前项目 Logo 在 [brands/project](brands/project/README.md)，正式采用的图形变更应由项目负责人确认。

## 4. 验证并提交 PR

先运行与改动有关的测试；常用入口如下：

```sh
corepack yarn check:fast
git diff --check
node scripts/check-no-real-domains.mjs
```

涉及服务端时按 [README 的测试说明](README.md#测试与验证)运行 Go / 数据库测试。涉及客户端界面、账号切换或打包时，还应验证真实界面及相应平台产物。记录未运行或跳过的检查，不能以部分测试通过代替全量结论。

提交前检查暂存内容，只加入本任务的文件：

```sh
git status
git add <本次改动的文件>
git diff --cached --check
git diff --cached
git commit -m "fix: describe the change"
git push -u origin HEAD
```

在 GitHub 新建 Pull Request，base 选择本仓的 `integration/intranet-merge`，compare 选择本次功能分支。PR 说明应包含：

- 用户遇到的具体问题，以及修改后的行为。
- 运行的测试或构建检查与结果。
- 界面变化的脱敏截图，或复现步骤。
- 未验证范围和需要 reviewer 注意的限制。

默认协作流程为审核 PR 后合并。请勿自行强推开发分支、改写他人的历史，或直接发布新版本。合并后再更新本地开发分支并开始下一个任务。

代码变更正式合并前，还应完成 `corepack yarn check` 的完整门禁并检查 CI 结果。提交信息沿用 conventional commits，例如 `fix(desktop): ...`、`docs: ...`。修改生产依赖时，运行 `corepack yarn workspace dsh-plugin-desktop verify:notices`，核对并提交必要的第三方许可清单更新。

构建、类型检查、单元测试与无界面冒烟应保持 headless-safe；启动图形应用要作为明确的独立操作。上游版本更新使用独立的子模块 pin 提交，不与桌面行为改动混在一起。

## 5. 配置与公开信息

开发优先使用本机测试服务端、测试账号和模拟数据。实际部署的密码、令牌、模型密钥、数据库内容、客户地址与私有渠道配置不提交到公开仓。

本仓只包含负责人明确授权公开的项目 Logo 图形；这不代表整个本地渠道目录获准公开。文档与测试中的部署地址使用 `harness.example.com` 等占位符，运行时凭据通过本机环境提供。

发布安装包、部署生产服务和邀请协作者是独立操作，由项目负责人安排；推送代码不代表这些操作已完成。

## 6. 其他参与方式

不提交代码也可以参与：在本开发仓的 [Issues](https://github.com/wll573/picoaide-harness-dev/issues) 中提供脱敏的复现步骤、提出功能建议，或完善教程与翻译。

插件作者可阅读 [插件开发说明](docs/plugin-development.md)、[插件生态倡议](docs/plugin-ecosystem.md)和 [Community Fabric Draft](community/fabric/README.zh.md)。其中 Community Fabric 当前是文档草案，尚不是可加载的插件。

协作中保持友善与尊重、就事论事；[行为准则](CODE_OF_CONDUCT.md)适用于项目讨论与贡献。
