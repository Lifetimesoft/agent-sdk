# Changelog

All notable changes to `@lifetimesoft/agent-sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.12] - 2026-04-28

### Changed

- **Environment variable schema** — `agent.json` env field now uses array of objects format with full schema definition
- **Documentation** — updated all examples and documentation to reflect correct env schema format

### Environment Variable Schema

The `env` field in `agent.json` is now an array of objects with the following structure:

```json
{
  "env": [
    {
      "name": "variable_name",
      "type": "string" | "boolean" | "number" | "password",
      "label": "Human-readable label",
      "description": "Detailed description",
      "default": "default_value",
      "required": true | false
    }
  ]
}
```

### Benefits

- **Type Safety**: Platform validates values based on declared type
- **UI Generation**: Web UI automatically generates appropriate form fields
- **Self-Documenting**: Labels and descriptions help users understand each variable
- **Password Security**: Type `"password"` hides sensitive values in UI
- **Default Values**: Clear declaration of default values for each variable

### Migration from v0.0.11

If you have an `agent.json` with the old format:

```json
{
  "env": {
    "mode": "normal",
    "enable_feature": true
  }
}
```

Update to the new format:

```json
{
  "env": [
    {
      "name": "mode",
      "type": "string",
      "label": "Operation Mode",
      "description": "Agent operation mode",
      "default": "normal",
      "required": false
    },
    {
      "name": "enable_feature",
      "type": "boolean",
      "label": "Enable Feature",
      "description": "Enable or disable the feature",
      "default": true,
      "required": false
    }
  ]
}
```

---

## [0.0.11] - 2026-04-28

### Changed

- **Environment variable flow** — clarified that default env comes from database (`lts_app_ai_agent_versions.env`), not from reading `agent.json` at runtime
- **Runtime behavior** — agent runtime receives env via `AGENT_CTX` from platform, does NOT read `agent.json` for env values
- **Documentation** — updated README to reflect correct env flow

### How It Works

1. **Agent Push**: When agent is pushed, `agent.json` env is stored in `lts_app_ai_agent_versions.env` (JSON string)
2. **Agent Run**: Platform queries `lts_app_ai_agent_versions.env`, parses it, and includes in `agentConfig.env`
3. **Agent Runtime**: Receives env via `AGENT_CTX` environment variable (no need to read `agent.json`)
4. **Immediate Execution**: Agent can run immediately with default env from database
5. **User Override**: User can override env via Web UI, which updates `config_json` and sends `config_updated` via WebSocket

---

## [0.0.8] - 2026-04-23

### Added

- **6-field cron support** — scheduler now accepts both 5-field and 6-field cron expressions
  - 5-field: `minute hour day-of-month month day-of-week` (standard)
  - 6-field: `second minute hour day-of-month month day-of-week` (seconds field ignored)
- **Enhanced cron parsing** — improved step syntax parsing for expressions like `*/5` (every 5 units)

### Fixed

- **Cron validation** — fixed parsing of step expressions (`*/5`, `1-10/2`) in scheduler
- **WebSocket dependencies** — added missing `ws` and `@types/ws` packages for WebSocket functionality

### Changed

- **Cron parser** — more robust field parsing using `indexOf()` instead of regex for better compatibility
- **Error messages** — improved cron validation error messages to be more descriptive

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
