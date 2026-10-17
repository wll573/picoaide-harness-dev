# Pack-Windows（神机内网关闭包）

- Tip：`c428c13b216235bdae259ed3261c6e17d47cbdb7`
- 分支：`boss/shenji/intranet`
- 渠道：`DSH_BUILD_CHANNEL=shenji` / `packaging/intranet-channel/shenji`（HTTP-only 内网）
- 全绿 CI：https://github.com/wll573/picoaide-harness-dev/actions/runs/38777494364
- 校验清单：`验收/pack-windows/SHA256SUMS`（仅摘要；大二进制不入库）

神机交付客户端仅 Windows x64；CI 另有 Linux/macOS desktop 产物，内网介质不发。

## 产物表

| 角色 | CI artifact | 介质内文件 | 约大小 | SHA256（见 SUMS） |
| --- | --- | --- | --- | --- |
| Windows 客户端安装包 | `desktop-Windows-installer` | `shenji/shenji-2.8.3-beta.1-x64-Setup.exe` | ~432 MiB | `8d48a715…acdb6d79` |
| Ubuntu 服务端二进制 | `picoaide-server-linux-amd64` | `picoaide-server` | ~56 MiB | `12ef68ee…6e78e7f5` |

重新拉取（不提交二进制）：

```bash
gh run download 38777494364 -R wll573/picoaide-harness-dev -n desktop-Windows-installer -D media/win
gh run download 38777494364 -R wll573/picoaide-harness-dev -n picoaide-server-linux-amd64 -D media/server
./验收/pack-windows/regen-sha256sums.sh media
```

### 原生 systemd 路径（`packaging/intranet-deploy`）

用 CI 的 `picoaide-server` 作主二进制；同目录还需 `picoaide-app-compile`（`make -C server` 在同源 tip 上构建，或离线构建机产出）。组装：

```bash
# BIN_SRC 目录需含可执行 picoaide-server + picoaide-app-compile
BIN_SRC=./out-bin \
  CHANNEL_SRC=packaging/intranet-channel/shenji \
  OUT=./out/pack-windows-c428c13/native-bundle \
  ./packaging/intranet-deploy/make-bundle.sh
sudo BIN_SRC=./out-bin ENV_SRC=/tmp/server.env \
  CHANNEL_SRC=packaging/intranet-channel/shenji \
  ./packaging/intranet-deploy/install.sh
```

手册：`packaging/intranet-deploy/README.md`（勿与 Docker 路径混用同一 data 目录）。

### Docker 离线路径（`packaging/offline`）

联网准备机 → 介质 → 内网：`prepare-connected.sh` / `prepare-docker-images.sh` → `build-server-offline.sh`（默认 `CHANNEL=shenji`）→ `export-server-image.sh` → 部署机 `import-docker-images.sh` + `import-server-image.sh`。Windows NSIS 须在 Windows 原生机产出后经 `WINDOWS_INSTALLER=` 注入；本 Linux 盒不编 NSIS，直接用上表 CI Setup.exe。手册：`packaging/offline/README.md`。

## 校验

```bash
# Linux / 介质机（文件名与 SUMS 一致时）
cd media && sha256sum -c ../验收/pack-windows/SHA256SUMS

# Windows PowerShell
Get-FileHash .\shenji-2.8.3-beta.1-x64-Setup.exe -Algorithm SHA256
# 对照 验收/pack-windows/SHA256SUMS 中 Setup.exe 一行
```

## 内网最短步骤（HTTP）

**Ubuntu 服务端（二选一）**

1. **原生**：按上节 `install.sh`；`curl -fsS http://<host>:8080/healthz`
2. **Docker 离线**：导入镜像后按现有 compose/运维手册起服务；同样 `curl http://<host>:<port>/healthz`

**Windows 客户端**

1. 安装 `shenji-2.8.3-beta.1-x64-Setup.exe`
2. 登录页填写 **HTTP** 服务端 Base URL（勿启用 HTTPS 要求）
3. 账号登录；侧栏可见 Token 用量（非 ¥ 余额）

## 验收勾项

### （a）三模型网关

- [ ] OpenAI-compatible Base URL 为 **HTTP** 内网地址（可连通）
- [ ] 管理后台已登记 **≥3** 个模型，客户端可选切换
- [ ] 同一入口配置 **多 Key**，请求能 round-robin 轮转到不同 Key
- [ ] 隐藏模型 / SSE heartbeat 行为与 tip 一致（有则测通；无则勾「N/A」并注明）
- [ ] 账户卡展示 **Token 用量**，不出现 ¥ / 账户余额主数字

### （b）审计 A/B

- [ ] webadmin 可查看审计日志（列表可见）
- [ ] 审计可按 **session** 分组浏览
- [ ] **AuditPlain**：明文可接受；**不要求**审计强制加密（故意偏离）
- [ ] 角色 **auditor** 不能调用员工侧业务 API（只读审计面）
- [ ] 若文档有链/校验（hash chain / verify）冒烟步骤则跑通；无则勾 N/A

## 索引

- `packaging/offline/README.md` — Docker 离线全流程
- `packaging/intranet-deploy/README.md` — 原生 systemd
- `验收/pack-windows/SHA256SUMS` + `regen-sha256sums.sh`
- `验收/Gap-CI-Green-20.md` — 本 tip 全绿复核
