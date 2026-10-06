# picoaide-harness-dev

这是 `wll573` 的个人开发仓，用于维护一个基于 Harness 的桌面客户端、服务端和自动化验证环境。

本仓库不是上游项目的官方发布仓，也不代表上游项目。代码会在个人分支中先完成开发、测试和审查，再决定是否提交回上游。

## 当前分支

- 开发分支：`integration/intranet-merge`
- 上游代码：`deepseek-harness/` 子模块
- 项目远端：`https://github.com/wll573/picoaide-harness-dev`

## 本分支包含的工作

- 桌面端定时任务入口和工作区服务注入
- 客户端侧边栏、能力中心、工作区选择器和账户用量的自动化验证
- 真实环境验证脚本的登录、面板和会话流程
- 网关审计记录中的供应商、输入 Token 和输出 Token
- 域名扫描守卫对公开基础镜像源的登记

## 目录

| 目录 | 内容 |
| --- | --- |
| `packages/host/desktop` | 桌面客户端和桌面端验证脚本 |
| `packages/host/cron` | 定时任务插件及测试 |
| `server/internal/llmgateway` | 模型网关和流式响应处理 |
| `server/internal/serverstore` | 数据库访问、用量和审计记录 |
| `deepseek-harness` | 固定版本的上游子模块 |

## 开发环境

需要 Node.js 22.19+ 或 24+、Corepack 和 Yarn 4.18.0。初始化子模块并安装依赖：

当前分支的包清单与 `yarn.lock` 尚未同步，`--immutable` 安装会失败；同步锁文件后再执行安装。

```sh
git submodule update --init --recursive
corepack yarn install --immutable
```

常用命令：

```sh
corepack yarn dev
corepack yarn check
corepack yarn test
```

服务端测试在 `server/` 目录执行：

```sh
go test -p 1 ./internal/llmgateway ./internal/serverstore
```

提交前请运行：

```sh
node scripts/check-no-real-domains.mjs
git diff --check
```

## 贡献方式

改动请使用独立分支和小提交，提交前跑相关测试，并在 Pull Request 中说明验证结果。

## 许可证与来源

许可证见 [LICENSE](LICENSE)。本仓库基于 `deepseek-harness/` 子模块中的上游代码进行个人开发，具体上游版本以子模块指针为准。
