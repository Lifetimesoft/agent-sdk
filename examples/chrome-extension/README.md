# Chrome Extension Example — Page Summariser

A minimal Chrome Extension (Manifest V3) that uses the `@lifetimesoft/agent-sdk` Chrome runtime to summarise the current page using AI.

## Files

```
chrome-extension/
├── manifest.json      — MV3 extension manifest
├── my-agent.ts        — The agent (portable, works with lifectl too)
├── background.ts      — Service worker: bootstraps createChromeRuntime()
├── popup.ts           — Popup UI: extracts page text, triggers agent
├── popup.html         — Popup HTML
└── README.md          — This file
```

## How It Works

```
popup.ts
  │  1. Extract page text via chrome.scripting.executeScript()
  │  2. sendMessage({ type: "set_agent_input", data: { pageText, url } })
  │  3. sendMessage({ type: "agent_trigger" })
  │
  ▼
background.ts  (service worker)
  │  createChromeRuntime(myAgent, { agentCtx, ... })
  │  runtime.start()
  │    ├── registers chrome.alarms listener (for interval/cron scheduler)
  │    ├── registers chrome.runtime.onMessage listener (for "agent_trigger")
  │    └── starts WebSocket heartbeat (if runtimeCfg provided)
  │
  ▼
my-agent.ts  (agent.run(ctx))
  │  ctx.input  = { pageText, url }
  │  ctx.ai.chat(...)  → Gemini / OpenAI
  │  ctx.storage.set("last_summary", ...)  → chrome.storage.local
  └── returns { summary, wordCount }
```

## Setup

### 1. Install dependencies

```bash
npm install @lifetimesoft/agent-sdk @types/chrome
```

### 2. Configure AI

**Option A — Agent-side AI (your own key, no platform account needed):**

Edit `background.ts` and set `gemini_api_key` in `agentCtx.env`:

```ts
env: {
  gemini_api_key: "AIzaSy...",
  ai_model: "gemini-2.0-flash",
},
```

**Option B — Platform-side AI (requires LifetimeSoft account):**

Store your access token in `chrome.storage.local` under `lifetimesoft_access_token`
and provide `runtimeCfg` in `agentCtx.meta.runtime`.

### 3. Build

```bash
# using your bundler of choice (esbuild, webpack, vite, etc.)
esbuild background.ts --bundle --outfile=background.js --format=esm
esbuild popup.ts --bundle --outfile=popup.js --format=esm
```

### 4. Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this folder

## Triggering the Agent

**From popup:** Click "Summarise this page" — the popup extracts the page text and triggers the agent.

**From content script:**
```ts
// content-script.ts
await chrome.runtime.sendMessage({
  type: "set_agent_input",
  data: { pageText: document.body.innerText, url: location.href },
})
await chrome.runtime.sendMessage({ type: "agent_trigger" })
```

**Programmatically (scheduled):**

Set `scheduler: { type: "interval", value: 3600000 }` in `agentCtx.config` to run every hour via `chrome.alarms`.

> **Note:** `chrome.alarms` enforces a minimum period of 1 minute. For sub-minute scheduling, use the Node.js runtime with `lifectl`.
