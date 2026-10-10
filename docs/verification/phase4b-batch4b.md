# Phase4-Batch4B：离线资源播种复现与探针

本批只覆盖服务端资源播种：三个 WASM 演示应用及 `demos.json`、`server/skills/` 内置技能、双 Logo。它不构建客户端安装包、镜像或整套离线介质。

在仓库根目录执行：

```bash
rm -rf /tmp/picoaide-seeded
CHANNEL_ID=official scripts/offline/seed-server-assets.sh /tmp/picoaide-seeded
node scripts/offline/check-seeded-assets.mjs /tmp/picoaide-seeded
```

私有渠道上下文只通过环境变量传入，不写入仓库：

```bash
CHANNEL_ID="${CHANNEL_ID}" CHANNEL_CONTEXT="${CHANNEL_CONTEXT}" \
  scripts/offline/seed-server-assets.sh /tmp/picoaide-seeded
```

探针清单：

- `server/scripts/build-demo-apps.sh --out-dir …` 产出 `showcase.wasm`、`forum.wasm`、`board.wasm` 与 `demos.json`。
- 每个清单条目的 `wasm` 文件存在且非空。
- 每个播种的技能目录含非空 `SKILL.md`。
- `channel/logo.svg` 与 `channel/logo-dark.svg` 均存在且非空。
- 播种通过临时目录完成，目标目录只在全部检查通过后替换。
- 构建使用 `GOPROXY=off`；不读取或生成真实密钥。

回滚：`git revert <本批 commit>`。
