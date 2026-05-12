# Changelog

All notable changes to `@lifetimesoft/agent-sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.21] - 2026-05-13

### Added

- **`src/runtime-chrome.ts`** — new Chrome Extension runtime for running agents inside MV3 service workers
- **`createChromeRuntime(agent, options)`** — factory function that returns a `{ start(), stop() }` handle
  ```ts
  import { createChromeRuntime } from "@lifetimesoft/agent-sdk/runtime-chrome"
  import myAgent from "./my-agent"

  const runtime = createChromeRuntime(myAgent, {
    agentCtx: { input: {}, config: { agent: "my-agent", version: "1.0.0" }, env: {}, meta: { run_id: "ext-001", timestamp: Date.now() } },
    accessToken: "...",
  })
  await runtime.start()
  ```
- **`@lifetimesoft/agent-sdk/runtime-chrome`** — new package export path (CJS + ESM + `.d.ts`)
- **`ChromeRuntimeOptions`** — exported interface for `createChromeRuntime()` options (`agentCtx`, `accessToken`, `refreshToken`, `storageArea`, `alarmPrefix`)
- **`ChromeRuntimeHandle`** — exported interface with `start()` and `stop()` methods
- **`chrome.storage` provider** — `ctx.storage` backed by `chrome.storage.local` (or `.sync`) with TTL support via stored expiry metadata. Keys namespaced as `lifetimesoft_storage_{key}`
- **`chrome.runtime.sendMessage` queue** — `ctx.queue.push(data)` dispatches `{ type: "agent_queue_message", data }` to other extension contexts
- **`chrome.alarms` scheduler** — interval and cron scheduler modes use `chrome.alarms` (MV3-safe, survives service worker termination). Minimum period: 1 minute per Chrome policy
- **`chrome.runtime.onMessage` trigger** — scheduler `none` mode listens for `{ type: "agent_trigger" }` messages in addition to WebSocket triggers
- **`chrome.runtime.onSuspend` shutdown** — graceful shutdown hook for MV3 service worker suspension, calls `notifyStopped` best-effort
- **Token persistence** — access/refresh tokens persisted to `chrome.storage.local` under `lifetimesoft_access_token` / `lifetimesoft_refresh_token`, surviving service worker restarts
- **Native browser WebSocket** — heartbeat uses the browser's built-in `WebSocket` (no `ws` package dependency in Chrome builds)
- **`examples/chrome-extension/`** — new example: Page Summariser extension
  - `my-agent.ts` — portable agent that summarises page text (works with both `lifectl` and Chrome runtime)
  - `background.ts` — MV3 service worker bootstrapping `createChromeRuntime()`
  - `popup.ts` — popup UI that extracts page text, sets agent input, and triggers a run
  - `popup.html` — popup HTML
  - `manifest.json` — MV3 manifest with required permissions
  - `README.md` — setup and usage guide

### Changed

- **`tsup.config.ts`** — added `"runtime-chrome": "src/runtime-chrome.ts"` entry point
- **`package.json` exports** — added `"./runtime-chrome"` export path
- **`package.json` devDependencies** — added `@types/chrome@^0.1.42`
- **`examples/hello-world.ts`** — added explicit generic types and `model: "gemini-2.0-flash"`
- **`examples/input-and-config.ts`** — uses `getEnvString` for model selection, explicit return type, removed redundant `Config` interface cast
- **`examples/storage-counter.ts`** — added explicit generic return type

### Feature Compatibility (Chrome vs Node.js)

| Feature | Node.js Runtime | Chrome Runtime |
|---|---|---|
| `ctx.ai.chat/image/video` | `fetch()` via Node | `fetch()` native ✅ |
| `ctx.storage` | Platform API | `chrome.storage.local` ✅ |
| `ctx.queue` | Platform queue | `chrome.runtime.sendMessage` ✅ |
| WebSocket heartbeat | `ws` package | Native `WebSocket` ✅ |
| Scheduler `none` | WS trigger | WS + `onMessage` ✅ |
| Scheduler `interval/cron` | `setInterval` / cron loop | `chrome.alarms` ⚠️ min 1 min |
| Token refresh | `process.env` + file | `chrome.storage` ✅ |
| `process.env` / `fs` | ✅ | ❌ — not available in browser |

---

## [0.0.18] - 2026-05-11

### Added

- **`ctx.ai.video()`** — new method on `AiProvider` for generating timelapse videos from a before/after image pair
  ```ts
  const videoUrl = await ctx.ai.video({
      before_url: "https://...",   // "before" image URL
      after_url:  "https://...",   // "after" image URL
      prompt?: string,             // optional scene/style guidance
      aspect_ratio?: string,       // "9:16" | "16:9" | "1:1" (default: "9:16")
      duration?: number,           // seconds (default: 5)
  })
  ```
- **`video_ready` WebSocket message handling** — runtime resolves the pending `ctx.ai.video()` promise when DO sends `video_ready` via WebSocket (same pattern as `image_ready`)
- **`callPlatformSideVideo()`** — internal runtime function, mirrors `callPlatformSideImage()`. Fires request to platform video endpoint, waits up to 5 minutes for `video_ready` notification
- **`pendingVideoJobs` map** — tracks in-flight video generation promises, keyed by `job_id`
- **`video()` default in `createMockContext()`** — mock context now includes a default `video` implementation that throws a descriptive error, consistent with `chat` and `image`

### Changed

- **`AiProvider` interface** — added `video()` method (non-breaking: existing agents unaffected)
- **`buildAiProvider()`** — accepts `pendingVideoJobs` map as additional parameter

---

## [0.0.17] - 2026-05-09

### Added

- **`InputRef` type** — new exported type representing an external input source reference, stored in `config.input.input_ref` by the platform
  ```ts
  export type InputRef =
      | { type: "dataset"; value: string }
      // future: | { type: "api"; url: string }
  ```
- **`resolveInputRef()` in runtime** — runtime automatically resolves `input_ref` before calling `agent.run()`. Agent code only sees the resolved `ctx.input` and never needs to know the source
- **Dataset input support** — when `input_ref.type === "dataset"`, the runtime atomically claims the next pending item from the platform (`GET /cli/.../agents/dataset/:id/next-item`) and sets it as `ctx.input`
- **1 tick = 1 item** — each scheduler tick or manual trigger processes exactly one dataset item. If no pending items remain, the run is skipped silently

### Changed

- **`ctx.input` for dataset type** — no longer pre-fetched at agent startup. Items are claimed per-run to prevent holding a `processing` lock without a worker
- **`config_updated` handling** — non-dataset `input_ref` types are re-resolved when config changes. Dataset type is intentionally skipped (items are always claimed fresh at run time)
- **Trigger handler** — unified: any `input_ref` type is resolved per trigger, replacing the previous separate code paths

### Design

The `input_ref` resolution follows the same pattern as `ctx.ai.image` — the runtime handles the source transparently, and agent code only interacts with the resolved value:

```ts
export default defineAgent({
  async run(ctx) {
    // ctx.input is already resolved — agent doesn't know it came from a dataset
    const item = ctx.input as { id: number; data_path: string; status: string }
    if (!item) return  // no pending items

    ctx.log.info("Processing item:", item.id)
    // ... process item ...
    // mark item completed/error via platform API
  }
})
```

---



## [0.0.12] - 2026-05-01

### Changed
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
