# AGENTS.md (tiny-chat)

Tiny Chat is one chat app — web, desktop, mobile, and CLI. Agentic coding should be state of the art, but the same
surfaces, tools, and data model must stay equally good for a non-coding conversation. Do not add a "code mode", a
separate coding agent or prompt, or features that only make sense inside a repo.

## Packages

pnpm workspace. Imports are deep paths with `.ts` / `.tsx` suffixes (`#core/...`, `#client/...`,
`#server/...`).

| Package           | Role                                                                             | May import                |
| ----------------- | -------------------------------------------------------------------------------- | ------------------------- |
| `packages/core`   | Domain: types, providers, agent loop, tools. No React, HTTP, or database client. | nothing in the monorepo   |
| `packages/server` | Node HTTP: tRPC, better-auth, Prisma, virtual FS, scheduled-action worker.       | core                      |
| `packages/client` | Shared React runtime for app + CLI: `createClient`, tRPC/Query, stores, hooks.   | core, server _types_ only |
| `packages/gui`    | Vite + React + Mantine UI (web, and the desktop and mobile webviews).            | client, core              |
| `packages/tui`    | Ink terminal UI over the same client.                                            | client, core              |
| `apps/cli`        | Bun shell (CLI).                                                                 | client, core, tui         |
| `apps/web`        | Static host of the app build.                                                    | —                         |
| `apps/desktop`    | Electrobun shell (macOS / Windows / Linux): Bun main process + the GUI.          | client, core, gui         |
| `apps/mobile`     | Capacitor shell (iOS / Android) around the GUI.                                  | core, gui                 |

If both app and CLI need a behavior, it belongs in `client` or `core`. If only one runtime can do it, it belongs in that
runtime's `client.ts` adapter (passed to `createClient`) or its own `features/`. The GUI reaches its host through a
`ClientRuntime` (`packages/gui/src/core/types/runtime.ts`), read with `useRuntime()`: `packages/gui/src/client-runtime.ts`
is the web's, and `apps/desktop` / `apps/mobile` build the GUI with their own `src/client-runtime.ts` in its place,
which falls back to the web's (`RuntimeUtils.web`) outside its host, so their dev servers still work in a browser. Prefer
asking the runtime for a capability over checking its `platform`. The desktop's main process does the native work over
Electrobun RPC (`apps/desktop/src/core/types/rpc.ts`).

Never import `@mantine/*` from `client`
or `ink` from `gui`.

Code lives in `src/features/<domain>/{components,hooks,services,stores,utils,types,routes}`, with `src/core/` for
cross-cutting infra. Match existing feature names; don't invent a parallel tree. Services and utils are
`export const FooService = { ... } as const`; Zod schemas are `zFoo`.

## How it fits together

Interactive chats generate **on the client**: the UI persists messages over tRPC (`/@/api`, composed in
`packages/server/src/core/utils/ApiRouter.ts`), then `ClientAgentService` runs `AgentService.generate` in-process. Only
scheduled actions generate on the server, via the worker, using the same `AgentService` with server capabilities.

Agent code has three layers — keep them separate:

1. **Capability** — host-facing interface in `packages/core/src/core/types/capability.ts`, implemented by both
   `packages/client/src/core/capabilities/` and `packages/server/src/core/capabilities/`.
2. **Tool** — model-facing definition + `execute` in `packages/core/src/features/tool/`. Depends on capabilities only.
3. **Toolset** — named group from `ToolService.getTools`, enabled per message via `config.toolsets`.

Keep related edits in lockstep: route ↔ `ApiRouter` ↔ client call; capability interface ↔ both implementations ↔ tools;
`contract.prisma` model ↔ core type in `features/data/types/`.

## Data

Prisma Next (contract-first, see the `prisma-8` skill). Contract: `packages/core/prisma/contract.prisma`; runtime `db`
from `packages/server/src/db.ts`, which loads the repo-root `.env`. Parse JSON columns with their Zod schemas at trust
boundaries rather than passing raw JSON around.

## Testing

Dev servers and Postgres are usually already running (`VITE_SERVER_PORT` / `VITE_WEB_PORT` in `.env`). Test against them
— don't mock them or start a second database.

- **Scratchpad / smoke tests:** use the real client provider: `createClient` wrapped in `QueryClientProvider` +
  `ClientContext`, as `packages/gui/src/main.tsx` does (in Vitest, `create()` from `packages/client/src/tests.ts`). It
  signs in a real anonymous test user against the live server. Don't spend time building a custom harness, fake
  client, or seeded user unless this genuinely can't cover the case. For server-only data, use the real `db`.
- **Test model:** with no API key, `test-generate` replies with a greeting. `%bench [text|code|table|tools|tasks|thought|mixed] [words] [~ms]`
  in a message streams deterministic content of that kind instead, and `%sub` calls `spawn_subagent`.
- **Unit:** Vitest (`*.test.ts`), only for logic that is actually pure.
- **App UI:** drive it with Playwright (installed at the root, Chromium included) against `http://localhost:$VITE_WEB_PORT`.
- **CLI:** always pass `--no-keyring` when testing so the CLI stores its session token in a plain-text OS temp file
  instead of touching the system keyring. Run it in a detached `tmux` session and drive it with `send-keys` /
  `capture-pane`:

  ```bash
  tmux new-session -d -s cli -x 120 -y 40 'pnpm dev:cli --no-keyring'
  tmux send-keys -t cli 'hello' M-Enter
  tmux capture-pane -p -t cli
  ```

**Return inserts a newline in both editors — it does not send.** Hold a modifier with Return to send:

- App: Cmd/Ctrl + Return (Playwright: `page.keyboard.press("ControlOrMeta+Enter")`).
- CLI: Alt/Option, Meta, or Ctrl + Return (tmux: `M-Enter`).

## Commands

All root scripts load the repo-root `.env`.

| Task                 | Command                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| Web (Vite + server)  | `pnpm dev:web`                                                          |
| Server only          | `pnpm dev:server`                                                       |
| CLI                  | `pnpm dev:cli`                                                          |
| Desktop / mobile     | `pnpm dev:desktop`, `dev:ios`, `dev:android` (HMR; `:dist` loads a build) |
| Builds               | `pnpm build:desktop`, `build:ios`, `build:android`, `build:cli` (unsigned) |
| Lint / types / tests | `pnpm lint`, `pnpm typecheck`, `pnpm test`                              |

TypeScript is strict with `.ts` import extensions; Biome uses tabs and double quotes. `ink`, `@alcalzone/ansi-tokenize` and
`native-run` are pnpm-patched (`patches/`) — don't edit them in `node_modules`.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
