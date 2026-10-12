# Backup and restore (native)

## What to back up

1. **PostgreSQL** — logical dump (`pg_dump`) of the application database referenced by `PICOAI_PG_DSN`.
2. **Data directory** — entire `/opt/picoaide/data` (or your `DEPLOY_DIR/data`), especially `master.key`. Losing `master.key` can make encrypted upstream secrets unrecoverable.
3. **Optional** — `server.env` (protect as secret), `channel/`, `client/`, `skills/`, and the active `bin/` tree.

Take these backups **before** every upgrade.

## Binary rollback vs data restore

| Action | Restores code | Restores DB schema/data | Restores master.key |
| --- | --- | --- | --- |
| `upgrade.sh` auto / `rollback.sh` | Yes (`bin/`) | No | No |
| Restore `pg_dump` + `data/` | No | Yes | Yes (if included) |

Applied migrations are **forward-only**. Rolling back only the binary after a migrating upgrade can leave the process unable to start. In that case restore the pre-upgrade database dump and data directory, then start the matching older binary.

## Suggested backup commands (examples)

Replace placeholders; do not embed real passwords in scripts checked into git.

```bash
# PostgreSQL (example — supply credentials via ~/.pgpass or env, not argv if possible)
pg_dump --format=custom --file=/secure/backup/picoaide-$(date +%Y%m%d).dump "$PICOAI_PG_DSN"

# Data directory
tar -C /opt/picoaide -czf /secure/backup/picoaide-data-$(date +%Y%m%d).tar.gz data
```

Store backups on protected media separate from the app host.

## Restore outline

1. Stop `picoaide-server.service`.
2. Restore PostgreSQL from the dump.
3. Restore `data/` (including `master.key`) to the deploy data path.
4. Ensure `bin/` matches the backup generation (or reinstall that version).
5. Start the service; check `http://127.0.0.1:8080/healthz` and `/readyz`.

Practice restores in a non-production environment before relying on them.
