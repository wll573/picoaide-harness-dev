# picoaide-harness-dev

This is the personal development repository of `wll573` for a Harness-based desktop client, server, and verification environment.

This repository is not an official upstream release repository and does not represent the upstream project. Changes are developed, tested, and reviewed on personal branches before any decision to send them upstream.

## Current branch

- Development branch: `integration/intranet-merge`
- Upstream code: the `deepseek-harness/` submodule
- Project remote: `https://github.com/wll573/picoaide-harness-dev`

## Work in this branch

- Workspace service injection for the desktop scheduled-task surface
- Automated checks for the sidebar, capability center, workspace picker, and account usage
- Real-environment checks for login, panels, and session flows
- Provider, input-token, and output-token metadata in gateway audit records
- Registration of the public base-image source in the domain guard

## Layout

| Directory | Contents |
| --- | --- |
| `packages/host/desktop` | Desktop client and desktop verification scripts |
| `packages/host/cron` | Scheduled-task plugin and tests |
| `server/internal/llmgateway` | Model gateway and streaming response handling |
| `server/internal/serverstore` | Database access, usage, and audit records |
| `deepseek-harness` | Pinned upstream submodule |

## Development setup

Use Node.js 22.19+ or 24+, Corepack, and Yarn 4.18.0. Initialize the submodule and install dependencies:

The package manifests and `yarn.lock` are currently out of sync on this branch, so `--immutable` installation fails until the lockfile is updated.

```sh
git submodule update --init --recursive
corepack yarn install --immutable
```

Common commands:

```sh
corepack yarn dev
corepack yarn check
corepack yarn test
```

Run server tests from `server/`:

```sh
go test -p 1 ./internal/llmgateway ./internal/serverstore
```

Before committing, run:

```sh
node scripts/check-no-real-domains.mjs
git diff --check
```

## Contribution workflow

Use a separate branch and focused commits. Run the relevant tests before opening a Pull Request and include the verification result.

## License and source

See [LICENSE](LICENSE). This repository is developed from the upstream code in the `deepseek-harness/` submodule; the submodule pointer records the exact upstream revision.
