# Changelog

All notable changes to `@lifetimesoft/agent-sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.4] - 2026-04-21

### Added

- **Scheduler support** — `SchedulerConfig` type (`none` | `interval` | `cron`) added to `AgentConfig` and exported from the main entry point
- **`src/scheduler.ts`** — pure scheduler implementation with no runtime dependencies
  - `none` — process stays alive, waiting for manual trigger
  - `interval` — waits `value` ms then runs, repeats until aborted
  - `cron` — waits until next matching tick then runs, repeats until aborted (pure 5-field cron parser, no deps)
- **Manual trigger** (`none` mode) — runtime listens for `{ type: "trigger" }` WebSocket messages from the platform and calls `run()` on demand
- **Config hot-reload** — runtime listens for `{ type: "config_updated", scheduler }` WebSocket messages and restarts the scheduler loop immediately without process restart
- **`anySignal()` helper** — combines multiple `AbortSignal`s, used internally to allow per-loop cancellation while preserving process-level SIGTERM/SIGINT handling

### Changed

- `AgentConfig.interval?: number` replaced by `AgentConfig.scheduler?: SchedulerConfig`
- `runtime.ts` — scheduler loop is now restartable: each `config_updated` message aborts the current loop and starts a new one with the updated config
- `runtime.ts` — process now waits for SIGTERM/SIGINT instead of exiting after a single `run()` call, enabling persistent agent processes for all scheduler types
- `testing.ts` — `createMockContext()` now defaults `config.scheduler` to `{ type: "none" }`

---

## [0.0.3] - 2026-04-20

### Added

- `runtime.ts` — WebSocket heartbeat connection for persistent agent lifecycle management
- `runtime.ts` — automatic token refresh using `AGENT_REFRESH_TOKEN` env var before WebSocket reconnect
- `runtime.ts` — storage provider backed by SaaS API (`/storage/get`, `/storage/set`, `/storage/delete`)
- `runtime.ts` — graceful shutdown on `SIGTERM` / `SIGINT` with `notifyStopped` callback to SaaS
- `runtime.ts` — agent entrypoint resolution: `agent.json` → `package.json` → `dist/index.js` fallback

---

## [0.0.2] - 2026-04-19

### Changed

- Replaced `require("fs")` with a top-level `import fs from "fs"` in `runtime.ts` to fix `@typescript-eslint/consistent-type-imports` lint error

### Removed

- GitHub Actions CI workflow (`.github/workflows/ci.yml`)

---

## [0.0.1] - 2026-04-18

### Added

- `defineAgent()` — core API for wrapping agent definitions with runtime validation
- Full TypeScript type definitions: `Context`, `AiProvider`, `StorageProvider`, `QueueProvider`, `Logger`, `RunMeta`, `AgentConfig`
- Generic type support for `TInput` and `TOutput` on `defineAgent()`, `Context`, `Agent`, and `AgentDefinition`
- `createMockContext()` in `@lifetimesoft/agent-sdk/testing` for local development and unit testing
- In-memory mock implementations for `StorageProvider` and `QueueProvider`
- Dual CJS + ESM build output via `tsup`
- TypeScript declaration files (`.d.ts`) included in build
- Example agents: `hello-world`, `input-and-config`, `storage-counter`
- Unit tests with Vitest
- ESLint config with `typescript-eslint`
- GitHub Actions CI workflow (typecheck, lint, test)
