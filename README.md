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

```js
import { defineAgent } from "@lifetimesoft/agent-sdk"

export default defineAgent({
  async run(ctx) {
    const reply = await ctx.ai.chat({
      prompt: `Say hello to the world`
    })

    ctx.log.info("AI reply:", reply)

    return {
      text: reply
    }
  }
})
```

---

## ⚙️ Context (ctx)

The `ctx` object is injected by the runtime (via `lifectl`) and provides everything your agent needs.

### Structure

```ts
type Context = {
  input: any

  config: {
    agent: string
    version: string
    interval?: number
    [key: string]: any
  }

  env: Record<string, string>

  ai: {
    chat: (req: {
      prompt: string
      model?: string
      temperature?: number
    }) => Promise<string>
  }

  storage: {
    get: (key: string) => Promise<any>
    set: (key: string, value: any, opts?: { ttl?: number }) => Promise<void>
    delete: (key: string) => Promise<void>
  }

  queue: {
    push: (data: any) => Promise<void>
  }

  log: {
    info: (...args: any[]) => void
    error: (...args: any[]) => void
    debug?: (...args: any[]) => void
  }

  meta: {
    job_id?: string
    run_id: string
    timestamp: number
  }
}
```

---

## 🔧 API

### `defineAgent()`

Wrap your agent definition.

```ts
defineAgent({
  async run(ctx) {
    // your logic here
  }
})
```

---

## 🧪 Example: Using Input + Config

```js
export default defineAgent({
  async run(ctx) {
    const { input, config } = ctx

    const reply = await ctx.ai.chat({
      prompt: `Reply in a ${config.tone} tone: ${input.text}`
    })

    return {
      text: reply
    }
  }
})
```

---

## 🗂️ Best Practices

### ✅ Do

* Use `ctx.ai` instead of calling external APIs directly
* Use `ctx.log` for logging
* Keep agent logic simple and focused
* Treat `ctx` as your only runtime interface

---

### ❌ Don’t

* Call SaaS APIs directly (`fetch(...)`)
* Implement your own heartbeat or polling
* Store sensitive logic outside `ctx.env`

---

## 🔄 Lifecycle (Handled by Runtime)

The SDK is designed to work with the `lifectl` CLI, which automatically manages:

* Heartbeat
* Config updates
* Logging (batched)
* Error handling
* Retry logic

👉 You only implement `run(ctx)`

---

## 🔮 Future Compatibility

This SDK is designed to support:

* Multi-provider AI (OpenAI, Claude, local LLM)
* Workflow chaining
* Human-in-the-loop systems
* Browser automation (Playwright)
* External data sources

---

## 🧩 Related Tools

* `lifectl` – CLI for running and managing agents
* SaaS Platform – Control plane (API, config, monitoring)

---

## 📄 License

MIT

---

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a PR.

---

## 💡 Final Note

> Agents built with this SDK are **portable, scalable, and future-proof**.

Build once, run anywhere 🚀
