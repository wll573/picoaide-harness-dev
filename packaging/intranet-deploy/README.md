# Native Ubuntu deploy (`packaging/intranet-deploy`)

Neutral scripts for running the PicoAide server as a **host binary + systemd** unit on Ubuntu (intranet **HTTP**).

## When to use this vs `packaging/offline` (Docker)

| Path | Use when |
| --- | --- |
| **`packaging/offline/`** | You want the existing **Docker offline** delivery (image + Compose/Caddy/PostgreSQL containers). Best for isolated, reproducible image import on hosts that already run Docker. See `docs/deploy/AI-DEPLOY.md` for the AI/ops Docker playbook — do not mix those Docker-only steps into these native scripts. |
| **`packaging/intranet-deploy/` (this tree)** | The host is Ubuntu with **systemd**, PostgreSQL is installed (or reachable) on the network, and you deliver **binaries** instead of a container image. |

Both paths are supported and **coexist**. Pick one per environment; do not run Docker Compose and this systemd unit against the same data directory.

## Layout after install

Default prefix: `/opt/picoaide`

```
/opt/picoaide/
  bin/picoaide-server
  bin/picoaide-app-compile          # must sit beside the server binary
  data/                             # app data; backup master.key with PG dumps
  channel/                          # channel assets (inject via CHANNEL_DIR / CHANNEL_SRC)
  client/                           # client release assets (PICOAI_CLIENT_RELEASE_DIR)
  skills/                           # builtin skill seed (PICOAI_SKILL_SEED_DIR)
  backups/                          # binary backups created by upgrade.sh
  server.env                        # EnvironmentFile (secrets; mode 640)
```

Channel id / brand assets are **not** hardcoded here. Set `CHANNEL`, `CHANNEL_DIR`, or `PICOAI_CHANNEL_DIR` / inject via `CHANNEL_SRC` when assembling a bundle.

## Scripts

| Script | Role |
| --- | --- |
| `install.sh` | Create system user, directories, install binaries + unit, seed `server.env` |
| `upgrade.sh` | Backup current `bin/` (+ env), swap binaries, health-check `/healthz`, auto-rollback on failure |
| `rollback.sh` | Restore last (or `BACKUP_DIR=`) binary backup; **does not** undo DB migrations |
| `uninstall.sh` | Disable/remove unit; keeps data unless `REMOVE_DATA=1` |
| `make-bundle.sh` | Assemble a bundle tree; without `BIN_SRC` runs **dry-run** placeholders only |

## Quick start (outline)

```bash
# 1) Build or obtain linux binaries into ./out-bin/
# 2) Edit env example, copy secrets offline
cp packaging/intranet-deploy/server.env.example /tmp/server.env
# edit PICOAI_PG_DSN and change-me-* — use HTTP intranet URLs only

sudo BIN_SRC=./out-bin ENV_SRC=/tmp/server.env \
  ./packaging/intranet-deploy/install.sh

curl -fsS http://127.0.0.1:8080/healthz
```

Upgrade:

```bash
sudo BIN_SRC=./out-bin-new ./packaging/intranet-deploy/upgrade.sh
```

## Requirements / notes

- PostgreSQL reachable via `PICOAI_PG_DSN` (server reads env when `-pg-dsn` is empty).
- For WASM compile isolation, install `bubblewrap` (`bwrap`) and keep `PICOAI_COMPILE_ISOLATION=auto` or `require`.
- Before upgrades: dump PostgreSQL **and** copy `data/master.key`. Binary rollback cannot reverse applied migrations — restore the DB backup if schema moved forward.
- This tree is **brand-neutral**. Do not commit customer channel names into these files.

## Related docs

- `docs/deploy.md` — install layout and HTTP notes
- `docs/backup-restore.md` — backup / restore / migration caveats
- `../offline/README.md` — Docker offline path (Gap-P1B coexistence)
