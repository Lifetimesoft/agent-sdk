# @lifetimesoft/agent-sdk

Lightweight SDK for building portable AI agents that run on the LifetimeSoft platform.

---

## 🚀 Overview

`@lifetimesoft/agent-sdk` is a minimal runtime SDK that helps developers build **AI agents** with a consistent interface and lifecycle.

It provides:

* A standard `defineAgent()` API
* Typed `ctx` (context) object
* Abstraction for AI, storage, logging, and more
* Compatibility with `lifectl` CLI runtime

---

## 🧠 Philosophy

* **Portable** → Agent runs anywhere (local, SaaS, server)
* **Simple** → Write only business logic
* **Decoupled** → No direct dependency on SaaS APIs
* **Extensible** → Future-ready for plugins, workflows, etc.

---

## 📦 Installation

```bash
npm install @lifetimesoft/agent-sdk
```

---

## ✨ Quick Example

```ts
import { defineAgent, getEnvString } from "@lifetimesoft/agent-sdk"

export default defineAgent<{ text: string }, { reply: string }>({
  async run(ctx) {
    // Safe environment variable access
    const model = getEnvString(ctx.env, 'AI_MODEL', 'gpt-4')
    
    const reply = await ctx.ai.chat({
      messages: [{ role: "user", content: `Say hello to: ${ctx.input.text}` }],
      model,
    })

    ctx.log.info("AI reply:", reply)

    return { reply }
  },
})
```

> Running an agent built with this SDK via `lifectl`:

![lifectl ai agent demo](assets/lifectl-ai-agent-01.gif)

---

## ⚙️ Context (ctx)

The `ctx` object is injected by the runtime (via `lifectl`) and provides everything your agent needs.

### Structure

```ts
type Context = {
  input: unknown

  config: {
    agent: string
    version: string
    scheduler?: SchedulerConfig
    [key: string]: unknown
  }

  env: Record<string, unknown>

  ai: {
    chat: (req: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
      model?: string
      temperature?: number
    }) => Promise<string>
  }

  storage: {
    get: <T>(key: string) => Promise<T | null>
    set: <T>(key: string, value: T, opts?: { ttl?: number }) => Promise<void>
    delete: (key: string) => Promise<void>
  }

  queue: {
    push: <T>(data: T) => Promise<void>
  }

  log: {
    info: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
    debug: (...args: unknown[]) => void
  }

  meta: {
    job_id?: string
    run_id: string
    timestamp: number
  }
}
```

---

## 🤖 AI Provider (ctx.ai)

The SDK provides a unified AI interface that supports **hybrid mode** — you can choose between Platform-side AI (using platform API keys) or Agent-side AI (using your own API keys).

### Platform-side AI (Default)

Uses API keys managed by the platform. No configuration needed in your agent.

```ts
export default defineAgent({
  async run(ctx) {
    const reply = await ctx.ai.chat({
      messages: [
        { role: "system", content: "You are a helpful assistant" },
        { role: "user", content: "Hello!" }
      ],
      model: "gemini-2.0-flash-exp",  // optional, defaults to gemini-2.0-flash-exp
      temperature: 0.7                 // optional, defaults to 0.7
    })
    
    return { reply }
  }
})
```

**Supported Models:**
- **Gemini** (default): `gemini-2.0-flash-exp`, `gemini-1.5-pro`, `gemini-1.5-flash`
- **OpenAI**: `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`

The provider is auto-detected from the model name (models starting with `gpt-` use OpenAI, others use Gemini).

### Agent-side AI

Use your own API keys for full control over AI costs and model selection.

```json
// agent.json
{
  "env": {
    "gemini_api_key": "AIzaSy...",
    "ai_provider": "gemini"  // optional, auto-detected from model
  }
}
```

Or for OpenAI:

```json
{
  "env": {
    "openai_api_key": "sk-...",
    "ai_provider": "openai"  // optional
  }
}
```

**Benefits:**
- ✅ Full control over API costs
- ✅ Use any model you have access to
- ✅ Works even if platform AI is unavailable
- ✅ Direct API calls (no platform proxy)

**Trade-offs:**
- ⚠️ You manage your own API keys
- ⚠️ You pay for your own usage
- ⚠️ Keys stored in agent configuration

### Choosing Between Modes

| Feature | Platform-side | Agent-side |
|---------|--------------|------------|
| Setup | None | Add API key to env |
| Cost | Platform pays | You pay |
| Security | Keys on platform | Keys in agent config |
| Flexibility | Platform models only | Any model you have |
| Best for | Most users | Power users, custom models |

---

## 🌍 Environment Variables

Environment variables are available via `ctx.env` as `Record<string, unknown>`. Use the provided utility functions for safe type conversion:

### Utility Functions

```ts
import { 
  getEnvString, 
  getEnvInt, 
  getEnvNumber, 
  getEnvBoolean, 
  hasEnv 
} from "@lifetimesoft/agent-sdk"

export default defineAgent({
  async run(ctx) {
    // String values with defaults
    const apiKey = getEnvString(ctx.env, 'API_KEY', 'default-key')
    const host = getEnvString(ctx.env, 'HOST', 'localhost')
    
    // Integer parsing with defaults
    const port = getEnvInt(ctx.env, 'PORT', 3000)
    const timeout = getEnvInt(ctx.env, 'TIMEOUT_MS', 5000)
    
    // Boolean parsing (supports 'true', '1', 'yes', 'on' as true)
    const debugMode = getEnvBoolean(ctx.env, 'DEBUG', false)
    const enableFeature = getEnvBoolean(ctx.env, 'ENABLE_FEATURE', true)
    
    // Check if environment variable exists
    if (hasEnv(ctx.env, 'OPTIONAL_CONFIG')) {
      const value = getEnvString(ctx.env, 'OPTIONAL_CONFIG')
      ctx.log.info(`Optional config: ${value}`)
    }
  }
})
```

### Available Functions

| Function | Description | Example |
|----------|-------------|---------|
| `getEnvString(env, key, default?)` | Get string value with optional default | `getEnvString(ctx.env, 'API_KEY', 'default')` |
| `getEnvInt(env, key, default?)` | Parse as integer with optional default | `getEnvInt(ctx.env, 'PORT', 3000)` |
| `getEnvNumber(env, key, default?)` | Parse as number with optional default | `getEnvNumber(ctx.env, 'RATE', 1.5)` |
| `getEnvBoolean(env, key, default?)` | Parse as boolean (true/1/yes/on = true) | `getEnvBoolean(ctx.env, 'DEBUG', false)` |
| `hasEnv(env, key)` | Check if variable exists and is not empty | `hasEnv(ctx.env, 'OPTIONAL_VAR')` |

### Alternative: Type Assertions

For quick migration, you can use type assertions:

```ts
const port = parseInt((ctx.env.PORT as string) || '3000')
const apiKey = (ctx.env.API_KEY as string) || 'default'
```

---

## 🔧 API

### `defineAgent()`

Wrap your agent definition.
You can pass generic types for input and output: `defineAgent<TInput, TOutput>({...})`.

```ts
defineAgent({
  // Optional: schema for validating input before run() is called
  inputSchema: { /* your schema */ },

  // Optional: schema for validating agent config before run() is called
  configSchema: { /* your schema */ },

  async run(ctx) {
    // your logic here
  },
})
```

---

## 🧪 Example: Using Input + Config

```ts
import { defineAgent, getEnvString, getEnvNumber } from "@lifetimesoft/agent-sdk"

export default defineAgent({
  async run(ctx) {
    const { input, config } = ctx
    const tone = (config.tone as string) ?? "neutral"
    
    // Use environment variables safely
    const model = getEnvString(ctx.env, 'AI_MODEL', 'gpt-4')
    const temperature = getEnvNumber(ctx.env, 'AI_TEMPERATURE', 0.7)

    const reply = await ctx.ai.chat({
      messages: [
        { role: "system", content: `You reply in a ${tone} tone.` },
        { role: "user", content: (input as { text: string }).text },
      ],
      model,
      temperature,
    })

    return { text: reply }
  },
})
```

---

## 📋 Changelog

### v0.0.10 (Latest)

**🤖 AI Provider - Hybrid Mode**
- **NEW:** `ctx.ai.chat()` now fully implemented with hybrid mode support
- **Platform-side AI:** Uses platform API keys (Gemini + OpenAI)
- **Agent-side AI:** Use your own API keys via environment variables
- Auto-detects provider from model name or explicit `ai_provider` env variable
- Direct API calls to Gemini/OpenAI when using agent-side mode

### v0.0.9 (Breaking Changes)

**🔄 Environment Variables Type Change**
- **BREAKING:** Changed `ctx.env` from `Record<string, string>` to `Record<string, unknown>`
- **NEW:** Added utility functions for safe environment variable access:
  - `getEnvString()`, `getEnvInt()`, `getEnvNumber()`, `getEnvBoolean()`, `hasEnv()`
- **MIGRATION:** Use utility functions or type assertions. See [Migration Guide](MIGRATION.md)

---

## 🧪 Testing

Use `createMockContext()` from `@lifetimesoft/agent-sdk/testing` to test agents locally without the `lifectl` runtime.

```ts
import { createMockContext } from "@lifetimesoft/agent-sdk/testing"
import myAgent from "./my-agent"

const ctx = createMockContext({
  input: { text: "hello" },
  ai: {
    chat: async () => "mocked AI response",
  },
})

const result = await myAgent.run(ctx)
console.log(result)
```

The mock context also exposes inspection helpers:

```ts
// Inspect storage state after run
const store = ctx.storage._getStore()

// Inspect all messages pushed to the queue
const messages = ctx.queue._getMessages()
```

---

## 🗂️ Best Practices

### ✅ Do

* Use `ctx.ai` instead of calling external APIs directly
* Use `ctx.log` for logging
* Use environment variable utilities (`getEnvString`, `getEnvInt`, etc.) for type safety
* Keep agent logic simple and focused
* Treat `ctx` as your only runtime interface
* Use Platform-side AI for most cases (simpler, no key management)
* Use Agent-side AI when you need custom models or cost control

### 📚 Migration

* **Upgrading from v0.0.8 or earlier?** See the [Migration Guide](MIGRATION.md) for environment variable changes

---

### ❌ Don't

* Call SaaS APIs directly (`fetch(...)`)
* Implement your own heartbeat or polling
* Store sensitive logic outside `ctx.env`
* Hardcode API keys in your code (use environment variables)

---

## 🔄 Lifecycle (Handled by Runtime)

The SDK is designed to work with the `lifectl` CLI, which automatically manages:

* **WebSocket heartbeat** — persistent connection to SaaS, hibernates between messages (no polling overhead)
* **Offline detection** — immediate when connection drops, no polling delay
* **Scheduler loop** — runs `run()` on schedule, restartable without process restart
* **Config hot-reload** — when scheduler config changes in the dashboard, the runtime receives a `config_updated` message and restarts the scheduler loop automatically — no agent restart needed
* **Manual trigger** — when scheduler is `none`, the runtime listens for `trigger` messages and calls `run()` on demand
* Error handling
* Retry logic with automatic WebSocket reconnect

👉 You only implement `run(ctx)`

---

## 🕐 Scheduler

The scheduler is **fully managed by the platform** — agents never configure it directly.

The platform reads the scheduler config from the database and injects it into `ctx.config.scheduler`. The runtime then handles the loop automatically before calling `run()`.

### Scheduler Config Format

```ts
type SchedulerConfig =
  | { type: "none" }
  | { type: "interval"; value: number }   // value = milliseconds
  | { type: "cron";     value: string }   // value = cron expression (5 fields)
```

### Behavior

| type | behavior |
|---|---|
| `none` | manual trigger only — process stays alive, `run()` called each time a trigger is received |
| `interval` | wait `value` ms → run → wait `value` ms → run → ... |
| `cron` | wait until next matching tick → run → wait → run → ... |

> Both `interval` and `cron` **wait first**, then run. The agent does not run immediately on startup.

### Manual Trigger (`none`)

When scheduler is `none`, the agent process stays alive and waits for a trigger signal from the platform. Each trigger causes `run(ctx)` to be called once.

Triggers are sent from the platform dashboard (Trigger button on the instance detail page) or via the API. The agent does not need any special code to handle this — the runtime manages it automatically via the existing WebSocket connection.

```ts
export default defineAgent({
  async run(ctx) {
    // called each time a manual trigger is received
    ctx.log.info("Triggered!")
  },
})
```

The process exits cleanly on `SIGTERM` or `SIGINT`.

### Cron Expression Format

Supports both standard 5-field and extended 6-field cron expressions:

**5-field (standard):** `minute hour day-of-month month day-of-week`

```
┌─────────── minute      (0–59)
│ ┌───────── hour        (0–23)
│ │ ┌─────── day-of-month (1–31)
│ │ │ ┌───── month       (1–12)
│ │ │ │ ┌─── day-of-week  (0–6, Sunday=0)
│ │ │ │ │
* * * * *
```

**6-field (extended):** `second minute hour day-of-month month day-of-week`

```
┌───────────── second      (0–59, ignored by scheduler)
│ ┌─────────── minute      (0–59)
│ │ ┌───────── hour        (0–23)
│ │ │ ┌─────── day-of-month (1–31)
│ │ │ │ ┌───── month       (1–12)
│ │ │ │ │ ┌─── day-of-week  (0–6, Sunday=0)
│ │ │ │ │ │
* * * * * *
```

> **Note:** When using 6-field format, the seconds field is ignored by the scheduler. The agent will still run at minute-level precision.

Supports `*`, ranges (`1-5`), steps (`*/15`), and lists (`1,3,5`).

**Examples:**

```
0 9 * * 1-5      every weekday at 09:00 (5-field)
0 */5 * * * *    every 5 hours (6-field)
*/30 * * * *     every 30 minutes (5-field)
0 0 1 * *        first day of every month at midnight (5-field)
0 0 */6 * * *    every 6 hours (6-field)
```

### Agent Code

Agents don't need to do anything special — just write `run(ctx)` as normal. The runtime handles all scheduling and trigger logic automatically:

```ts
export default defineAgent({
  async run(ctx) {
    // called by scheduler (interval/cron) or manual trigger (none)
    ctx.log.info("Running...")
  },
})
```

---

## 🔮 Future Compatibility

This SDK is designed to support:

* Multi-provider AI (OpenAI, Claude, local LLM) ✅ **Implemented**
* Workflow chaining
* Human-in-the-loop systems
* Browser automation (Playwright)
* External data sources

---

## 🧩 Related Tools

* [`lifectl`](https://www.npmjs.com/package/@lifetimesoft/lifectl) – CLI for running and managing agents
* SaaS Platform – Control plane (API, config, monitoring)

---

## 📄 License

Apache-2.0 license

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a PR.

---

## 💡 Final Note

> Agents built with this SDK are **portable, scalable, and future-proof**.

Build once, run anywhere 🚀
