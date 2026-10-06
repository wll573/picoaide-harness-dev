# picoaide-harness-dev

This is `wll573`'s personal development repository for a DeepSeek Harness-based desktop client, server, model gateway, and verification environment. It is independent of the upstream release repository and does not represent the upstream project.

The development branch is **`integration/intranet-merge`**. Upstream code remains in the pinned **`deepseek-harness/` submodule**. This page summarizes the current branch; the [Chinese README](README.md) provides the detailed change tables, source locations, setup commands, and troubleshooting guide.

## Updates relative to the original project

The fixed comparison baseline is **`8757735dd`**, the common ancestor with the original `picoaide-harness` repository. The following changes are based on the actual `8757735dd..HEAD` diff, rather than a list of every inherited project feature.

| Area | Changes in this branch |
| --- | --- |
| Sidebar navigation | Compact individual rows replace the More menu for tasks, capabilities, connectors, browser, and app center; retain collapsed icons, active states, and attention indicators. |
| Panel behavior | Synchronize navigation selection, focus handoff, and state cleanup when panels close. |
| Account usage | Emphasize input, output, total, daily, and monthly Tokens, distinguishing missing data from zero usage. |
| Light theme | Paint the sidebar using the resolved theme background, fixing black sidebars in light mode on some computers. |
| Account isolation | Scope conversation records, indexes, and projection caches by server URL and username; restart the host before loading another identity's data. |
| Login and registration | Remember the last server address; follow server registration availability; show an approval notice after successful registration instead of immediately attempting login. |
| Approval and tasks | Include the tool-approval panel, set the desktop's default access level to full access while retaining tool permissions, and explicitly inject the task surface's workspace UI dependency. |
| Wording | Update client, administration, and portal language for navigation, organization terminology, and usage. |
| Model adapters | Add Qwen, GLM, MiniMax, and Hunyuan compatibility and discovery; convert provider-specific reasoning parameters and remove conflicting fields. |
| Model reasoning UI | Resolve model-level `_thinking_adapter` settings, including alternate levels, default-only / hidden selectors, and context-window extraction. |
| Provider Key pools | Add encrypted Keys, labels, enablement, priority, rotation, retries, cooldown, reset, deletion, and migration from legacy single-Key storage. |
| Key statistics | Record usage / success / failure statistics and display success rates; show no data when there are no samples. |
| Model hiding | Add an administrator-controlled hidden flag independent of catalog synchronization and filter hidden models from client lists. |
| Provider policy | Add timeout, maximum Key attempts, and Chat Completions / Responses enablement settings, applied during forwarding. |
| Streaming | Send SSE keepalives during silent upstream periods. |
| Full auditing | Capture gateway request / response transcripts, store streamed responses in encrypted chunks, and schedule retention. |
| Audit details | Record actual provider, model, Token counts, duration, streaming state, session / workspace tags, and errors. |
| Audit integrity | Distinguish pending, complete, incomplete, and local-write failures, including truncated streams returning HTTP 200. |
| Audit presentation | Extract readable Chat Completions, Anthropic, and Responses JSON / SSE text while keeping raw data; add filtering, pagination, detail views, CSV export, and permissions. |
| Audit accounting | Propagate actual providers and final input / output Token measurements; separate transcript views from sensitive-operation logs. |
| Administration usage | Update overview, member, department, model, log, report, and account pages to emphasize Tokens. Underlying billing and balance ledgers remain. |
| Managed clients | Add per-user settings, Skill policy, device synchronization reports, and an administration page. |
| Managed defaults | Apply default models and reasoning levels on the client, with compatibility handling for older servers. |
| Managed Skills | Enforce required, allowed, and blocked policies with version / checksum checks, installation or removal, and status reporting. |
| API and RBAC | Update routes, navigation, API contracts, and permissions for the new surfaces. |
| Intranet HTTP | Add Caddy / Compose HTTP deployment and the required client connection, Skill, download, and update URL handling. |
| Updates | Add release notes to client metadata and adjust update configuration and download integration. |
| Offline delivery | Add connected preparation, platform-specific caches / toolchains, server and Windows installer builds, image import / export, installer registration, and SHA256 verification. |
| Local workflows | Extend the build matrix and Windows / WSL synchronization scripts; machine-specific paths require configuration. |
| Build channels | Support a private local default channel while explicit `DSH_BUILD_CHANNEL` takes precedence. |
| Logo assets | Publish the unchanged main SVG, dark-theme SVG, and application icon under [brands/project](brands/project/README.md); rejected concepts are excluded. |
| Database | Add migrations **0083–0089** for transcripts / chunks, Keys, managed policy / devices, transcript details, Key statistics, model hiding, and provider policy. |
| Documentation | Add illustrated usage, intranet deployment, offline build, and plugin-inventory guides; remove unused AI-tool / prompt materials, the unimplemented self-improvement proposal, and collaboration guides. |
| Verification | Add or revise gateway, Key-pool, reasoning, transcript, keepalive, administration, registration, account-isolation, navigation, and theme tests; align E2E / real-environment scripts with current UI and mocks. |
| Merge corrections | Fix build / type gaps, cross-platform assertions, migration-range handling, route contracts, test fixtures, and public package / base-image domain registrations. |

Actual model availability depends on deployment configuration, upstream capabilities, and authorization. Database settings, model Keys, and user permissions are not distributed by pushing source code.

Inspect all modified paths and commits using the fixed baseline:

```sh
git diff --stat 8757735dd..HEAD
git diff --name-status 8757735dd..HEAD
git log --reverse --oneline 8757735dd..HEAD
```

## Development and packaging

Use Node.js **`^22.19.0` or `>=24.0.0`**, Corepack, and root Yarn **`4.18.0`**. The Go module requires Go **`1.26.6` or a compatible newer version**, PostgreSQL, npm, and make. Production deployments use PostgreSQL 18.

```sh
git submodule update --init --recursive
corepack yarn install --immutable
corepack yarn prebuild
corepack yarn dev
```

If immutable installation reports lockfile drift, reconcile manifests and lockfiles first. The root workspace uses Yarn; the upstream submodule retains pnpm; `server/webadmin/` has its own npm lockfile.

From `server/`, run `npm --prefix webadmin ci` and `make build-server`. Configure `PICOAI_PG_DSN` and the initial `PICOAI_ADMIN_PASSWORD` locally before launching. There is no universal installation password. Local administration is at `http://localhost:8080/admin/`, health is at `/healthz`, and clients connect to the server base address without `/admin/`.

Self-registration requires `PICOAI_SELF_REGISTRATION_ENABLED=1` and visible local authentication. Restart the server after changing its environment. New registrations require administrator approval before login.

Use `corepack yarn dist:win`, `dist:win-portable`, `dist:mac`, `dist:mac-smoke`, or `dist:linux` for platform packages. Outputs are under `packages/host/desktop/dist/`; macOS release signing / notarization requires separate credentials. Publishing Logo assets does not automatically select a build channel or publish private configuration.

## Validation and operations

```sh
corepack yarn typecheck
corepack yarn test
corepack yarn check:fast
corepack yarn check
git diff --check
node scripts/check-no-real-domains.mjs
```

Root `test` / `typecheck` target enterprise and desktop; `check` orchestrates more workspaces and guards. Relevant registration / account-isolation tests passed **39 cases** in the 2026-10-06 local validation, alongside real packaged-client identity-switch and persistence checks. This does not claim an all-platform or full-suite pass.

Database test coverage requires an accessible test PostgreSQL through `PG_DSN_TEST`; inspect skipped cases. Client E2E requires packaged artifacts and a display / Xvfb environment. See the [desktop documentation](packages/host/desktop/README.md) and [integration-test documentation](integration-tests/README.md).

Old shared conversations have no trusted owner and are not automatically assigned to new accounts. Back up and confirm ownership before migrating records and indexes together. Scoped history does not create operating-system permissions or make all installation settings account-specific.

See the [illustrated client guide](docs/client-guide.md), [intranet deployment guide](docs/deploy/INTRANET-UBUNTU24-WINDOWS.md), [offline build guide](packaging/offline/README.md), and [deployment / upgrade instructions](docs/deploy/AI-DEPLOY.md).

Back up the database and encryption master key before upgrades. Git pushes update source code, not running services or installed clients; documentation-only CI may skip binary artifacts. Deployment data, credentials, model Keys, and private channel configuration remain local. Public examples use placeholder hosts such as `harness.example.com`.

## License and provenance

See [LICENSE](LICENSE). The upstream version is recorded by the `deepseek-harness/` submodule pointer; third-party components retain their licenses and provenance notices.
