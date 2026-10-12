# Native deploy notes

## Audience

Operators installing the Intranet AI server on Ubuntu with systemd (not Docker Compose). For the Docker/AI playbook see repository `docs/deploy/AI-DEPLOY.md` — that document remains Docker-oriented; native steps live only under `packaging/intranet-deploy/`.

## Prerequisites

- Ubuntu with systemd
- PostgreSQL reachable over the network (or localhost)
- Built `picoaide-server` and `picoaide-app-compile` for linux (same directory)
- Optional: `bubblewrap` for WASM compile isolation
- Intranet access over **HTTP** (default listen `127.0.0.1:8080`; put a reverse proxy in front if needed)

## Directory roles

| Path | Env | Purpose |
| --- | --- | --- |
| `/opt/picoaide/data` | `-data` | App data; contains `master.key` after first start — **must back up** |
| `/opt/picoaide/channel` | `PICOAI_CHANNEL_DIR` | Channel assets placeholder; inject privately |
| `/opt/picoaide/client` | `PICOAI_CLIENT_RELEASE_DIR` | Client installers / release manifest |
| `/opt/picoaide/skills` | `PICOAI_SKILL_SEED_DIR` | Builtin skill seed tree |
| `/opt/picoaide/bin` | — | `picoaide-server` + `picoaide-app-compile` |
| `/opt/picoaide/server.env` | `EnvironmentFile=` | Secrets and knobs; never put DSN passwords on `ExecStart` |

## Install flow

1. Prepare `server.env` from `server.env.example` (replace every `change-me-*`).
2. `sudo BIN_SRC=... ENV_SRC=... ./install.sh`
3. Confirm `curl -fsS http://127.0.0.1:8080/healthz`
4. Place channel / client / skills content into the directories above (or rebuild a bundle with `CHANNEL_SRC` / `CLIENT_SRC` / `SKILLS_SRC`).

## Upgrade / rollback

- `upgrade.sh` copies `bin/` (and `server.env`) under `backups/<stamp>/`, replaces binaries, probes `/healthz`, and calls `rollback.sh` on failure.
- `rollback.sh` restores binaries only. **Database migrations are not reversed.** If a release applied incompatible migrations, restore the PostgreSQL dump taken before upgrade together with `data/` (including `master.key`).

## Security reminders

- Keep `server.env` mode `640`, owned root:`picoaide`.
- Do not commit real passwords, API keys, or `master.key` into git or the bundle.
- Channel brand materials stay outside this neutral tree (private channel injection).
