# Intranet default channel pack (tracked)

`channels/` stays gitignored and is filled at build/CI time from the private
channels checkout when available. This tree holds the **神机** default pack for
the intranet fork so Gate / local `yarn build` can resolve brand assets without
tracking anything under `channels/`.

`resolveChannelBuildContext` prefers `channels/<id>/` when present, otherwise
falls back here for the same id.
