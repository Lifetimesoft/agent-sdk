/// <reference types="chrome" />
/**
 * @lifetimesoft/agent-sdk/runtime-chrome
 *
 * Chrome Extension runtime for running agents inside a browser extension.
 * Designed for Manifest V3 (MV3) service workers and background scripts.
 *
 * Differences from Node.js runtime (src/runtime.ts):
 * ┌─────────────────────┬──────────────────────────────────────────────────────┐
 * │ Feature             │ Chrome Extension approach                            │
 * ├─────────────────────┼──────────────────────────────────────────────────────┤
 * │ ctx.ai.chat/image   │ fetch() — works natively in browser                  │
 * │ ctx.ai.video        │ fetch() + WebSocket callback — works natively         │
 * │ ctx.storage         │ chrome.storage.local (replaces platform API)          │
 * │ ctx.queue           │ chrome.runtime.sendMessage (replaces queue API)       │
 * │ ctx.log             │ console.* — works natively                            │
 * │ WebSocket heartbeat │ native browser WebSocket — works natively             │
 * │ Scheduler interval  │ chrome.alarms (MV3 — setInterval not reliable in SW) │
 * │ Scheduler cron      │ chrome.alarms with periodic matching                  │
 * │ Scheduler none      │ chrome.runtime.onMessage trigger                      │
 * │ process.env         │ ❌ Not available — use ctx.env from AGENT_CTX         │
 * │ fs / path           │ ❌ Not available — no file system in browser          │
 * │ require() dynamic   │ ❌ Not available — agent must be imported directly    │
 * │ SIGTERM/SIGINT      │ chrome.runtime.onSuspend (MV3 service worker)         │
 * │ Token refresh       │ fetch() — works natively                              │
 * └─────────────────────┴──────────────────────────────────────────────────────┘
 *
 * Usage (in your extension's background service worker):
 *
 *   import { createChromeRuntime } from "@lifetimesoft/agent-sdk/runtime-chrome"
 *   import myAgent from "./my-agent"
 *
 *   const runtime = createChromeRuntime(myAgent, {
 *     agentCtx: { ... },        // equivalent of AGENT_CTX env var
 *     accessToken: "...",       // equivalent of AGENT_ACCESS_TOKEN env var
 *   })
 *
 *   runtime.start()
 */

import type { Agent, Context, RuntimeConfig, SchedulerConfig } from "./types"
import { runWithScheduler } from "./scheduler"

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Configuration passed to createChromeRuntime().
 * Mirrors the env vars used by the Node.js runtime, but passed explicitly
 * since Chrome extensions have no process.env.
 */
export interface ChromeRuntimeOptions {
  /**
   * The parsed AGENT_CTX object — equivalent to JSON.parse(process.env.AGENT_CTX).
   * Contains input, config, env, and meta fields.
   */
  agentCtx: Pick<Context, "input" | "config" | "env" | "meta">

  /**
   * Access token for authenticating with the LifetimeSoft platform.
   * Equivalent to process.env.AGENT_ACCESS_TOKEN.
   */
  accessToken?: string

  /**
   * Refresh token for obtaining new access tokens when the current one expires.
   * Equivalent to process.env.AGENT_REFRESH_TOKEN.
   * Stored in chrome.storage.local under key "lifetimesoft_refresh_token".
   */
  refreshToken?: string

  /**
   * Chrome storage area to use for ctx.storage.
   * Defaults to "local". Use "sync" for cross-device persistence (5MB limit).
   */
  storageArea?: "local" | "sync"

  /**
   * Alarm name prefix for chrome.alarms scheduler.
   * Defaults to "lifetimesoft_agent".
   * Change this if you run multiple agents in the same extension.
   */
  alarmPrefix?: string
}

/**
 * The handle returned by createChromeRuntime().
 * Call start() to begin the agent lifecycle.
 */
export interface ChromeRuntimeHandle {
  /** Start the agent runtime — registers alarms, WebSocket, and message listeners. */
  start(): Promise<void>
  /** Stop the agent runtime — clears alarms, closes WebSocket, notifies platform. */
  stop(): Promise<void>
}

/**
 * Create a Chrome Extension runtime for the given agent.
 *
 * @example
 * ```ts
 * // background.ts (MV3 service worker)
 * import { createChromeRuntime } from "@lifetimesoft/agent-sdk/runtime-chrome"
 * import myAgent from "./my-agent"
 *
 * chrome.runtime.onInstalled.addListener(async () => {
 *   const runtime = createChromeRuntime(myAgent, {
 *     agentCtx: await loadAgentCtx(),
 *     accessToken: await loadAccessToken(),
 *   })
 *   await runtime.start()
 * })
 * ```
 */
export function createChromeRuntime<TInput = unknown, TOutput = unknown>(
  agent: Agent<TInput, TOutput>,
  options: ChromeRuntimeOptions
): ChromeRuntimeHandle {
  const {
    agentCtx,
    accessToken: initialAccessToken,
    refreshToken: initialRefreshToken,
    storageArea = "local",
    alarmPrefix = "lifetimesoft_agent",
  } = options

  // mutable token state — updated on refresh
  let currentAccessToken = initialAccessToken
  let currentRefreshToken = initialRefreshToken

  const runId = agentCtx.meta?.run_id
  const runtimeCfg: RuntimeConfig | undefined = agentCtx.meta?.runtime

  if (!runId) {
    throw new Error("[runtime-chrome] agentCtx.meta.run_id is required")
  }

  if (
    !agent ||
    typeof agent !== "object" ||
    !agent.__isAgent ||
    typeof agent.run !== "function"
  ) {
    throw new Error("[runtime-chrome] Provided module is not a valid agent. Make sure it uses defineAgent().")
  }

  // pending async job promises — keyed by job_id
  // resolved when platform sends image_ready / video_ready via WebSocket
  const pendingImageJobs = new Map<string, {
    resolve: (url: string) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  const pendingVideoJobs = new Map<string, {
    resolve: (url: string) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  // build the full context — same shape as Node.js runtime
  const ctx: Context<TInput> = {
    ...agentCtx,
    log: makeLogger(""),
    ai: buildAiProvider(runtimeCfg, agentCtx.env, runId, pendingImageJobs, pendingVideoJobs, getToken),
    storage: buildChromeStorageProvider(storageArea),
    queue: buildChromeQueueProvider(),
  } as Context<TInput>

  let schedulerConfig: SchedulerConfig = agentCtx.config?.scheduler ?? { type: "none" }
  let wsConnection: ChromeWebSocketHandle | null = null
  let stopped = false
  let schedulerAbort = new AbortController()
  const runtimeAbort = new AbortController()

  // ─── Token helpers ──────────────────────────────────────────────────────────

  function getToken(): string | undefined {
    return currentAccessToken
  }

  async function refreshTokenIfNeeded(): Promise<string | undefined> {
    if (!currentRefreshToken || !currentAccessToken) return currentAccessToken

    // check JWT expiry
    try {
      const payload = JSON.parse(atob(currentAccessToken.split(".")[1]))
      const isExpired = Math.floor(Date.now() / 1000) >= payload.exp
      if (!isExpired) return currentAccessToken
    } catch {
      // can't parse — try refresh anyway
    }

    try {
      const res = await fetch(`${APP_URL}/cli-login/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "lifectl-cli",
        },
        body: JSON.stringify({
          access_token: currentAccessToken,
          refresh_token: currentRefreshToken,
        }),
      })

      if (!res.ok) {
        console.error("[runtime-chrome] Token refresh failed:", res.status)
        return currentAccessToken
      }

      const data = await res.json() as { access_token?: string; refresh_token?: string }
      if (data.access_token) {
        console.log("[runtime-chrome] Token refreshed successfully")
        currentAccessToken = data.access_token
        if (data.refresh_token) currentRefreshToken = data.refresh_token
        // persist to chrome.storage.local so the extension survives service worker restarts
        await persistTokensToStorage(data.access_token, data.refresh_token)
        return data.access_token
      }
    } catch (e) {
      console.error("[runtime-chrome] Token refresh error:", e)
    }

    return currentAccessToken
  }

  async function persistTokensToStorage(accessToken: string, refreshToken?: string): Promise<void> {
    try {
      const data: Record<string, string> = { lifetimesoft_access_token: accessToken }
      if (refreshToken) data.lifetimesoft_refresh_token = refreshToken
      await chrome.storage[storageArea].set(data)
    } catch (e) {
      console.error("[runtime-chrome] Failed to persist tokens to chrome.storage:", e)
    }
  }

  // ─── Scheduler ──────────────────────────────────────────────────────────────

  const alarmName = `${alarmPrefix}_scheduler`

  function startSchedulerLoop(cfg: SchedulerConfig): void {
    schedulerAbort.abort()
    schedulerAbort = new AbortController()
    const combinedSignal = anySignal([runtimeAbort.signal, schedulerAbort.signal])

    const runJob = async (jobId: string): Promise<void> => {
      ctx.log = makeLogger(jobId)
      await agent.run(ctx)
    }

    if (cfg.type === "interval" || cfg.type === "cron") {
      // MV3 service workers are terminated when idle — use chrome.alarms for reliable scheduling
      // chrome.alarms minimum period is 1 minute (60000ms) per Chrome policy
      setupChromeAlarm(cfg, alarmName)
    }

    // runWithScheduler handles the in-process loop for "none" type
    // For interval/cron in Chrome, the alarm listener triggers runJob directly
    if (cfg.type === "none") {
      runWithScheduler(
        cfg,
        (jobId: string) => runJob(jobId),
        combinedSignal,
        makeLogger(""),
      ).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        console.error("[runtime-chrome] scheduler threw:", msg)
      })
    }
  }

  // ─── Chrome Alarm listener ──────────────────────────────────────────────────

  function onAlarmFired(alarm: chrome.alarms.Alarm): void {
    if (alarm.name !== alarmName) return
    if (stopped) return

    const jobId = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")
    console.log(`[${fmtDate()}] [job:${jobId}] [agent:info] [alarm] triggered`)
    ctx.log = makeLogger(jobId)

    agent.run(ctx).then(() => {
      console.log(`[${fmtDate()}] [job:${jobId}] [agent:info] [alarm] completed`)
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[${fmtDate()}] [job:${jobId}] [agent:error] agent.run() threw:`, msg)
    })
  }

  // ─── WebSocket message handler ───────────────────────────────────────────────

  function onWsMessage(data: string): void {
    try {
      const msg = JSON.parse(data) as {
        type?: string
        scheduler?: unknown
        config?: unknown
        job_id?: string
        image_url?: string | null
        success?: boolean
        message?: string | null
      }

      if (msg.type === "trigger" && schedulerConfig.type === "none") {
        const jobId = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")
        console.log(`[${fmtDate()}] [job:${jobId}] [agent:info] [scheduler] trigger received`)
        ctx.log = makeLogger(jobId)

        agent.run(ctx).then(() => {
          console.log(`[${fmtDate()}] [job:${jobId}] [agent:info] [scheduler] end job ${jobId}`)
        }).catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e)
          console.error(`[${fmtDate()}] [job:${jobId}] [agent:error] agent.run() threw during trigger:`, msg)
        })

      } else if (msg.type === "config_updated" && msg.config) {
        console.log("[runtime-chrome] config_updated received — reloading scheduler")
        ctx.config = msg.config as Context["config"]
        if ((msg.config as { env?: Record<string, unknown> })?.env) {
          ctx.env = (msg.config as { env: Record<string, unknown> }).env
        }
        schedulerConfig = (msg.config as { scheduler?: SchedulerConfig })?.scheduler ?? { type: "none" }
        // clear old alarm before starting new loop
        chrome.alarms.clear(alarmName).catch(() => { /* best-effort */ })
        startSchedulerLoop(schedulerConfig)

      } else if (msg.type === "image_ready" && msg.job_id) {
        const pending = pendingImageJobs.get(msg.job_id)
        if (pending) {
          clearTimeout(pending.timer)
          pendingImageJobs.delete(msg.job_id)
          if (msg.success && msg.image_url) {
            pending.resolve(msg.image_url)
          } else {
            pending.reject(new Error(`[runtime-chrome] Image generation failed: ${msg.message || "unknown error"}`))
          }
        }

      } else if (msg.type === "video_ready" && msg.job_id) {
        const pending = pendingVideoJobs.get(msg.job_id)
        if (pending) {
          clearTimeout(pending.timer)
          pendingVideoJobs.delete(msg.job_id)
          if (msg.success && msg.image_url) {
            pending.resolve(msg.image_url)
          } else {
            pending.reject(new Error(`[runtime-chrome] Video generation failed: ${msg.message || "unknown error"}`))
          }
        }
      }
    } catch {
      // ignore malformed messages
    }
  }

  // ─── Runtime handle ──────────────────────────────────────────────────────────

  return {
    async start(): Promise<void> {
      console.log("[runtime-chrome] Starting Chrome extension agent runtime...")
      console.log("[runtime-chrome] run_id:", runId)

      // load persisted tokens from chrome.storage (survive service worker restarts)
      try {
        const stored = await chrome.storage[storageArea].get([
          "lifetimesoft_access_token",
          "lifetimesoft_refresh_token",
        ])
        if (stored.lifetimesoft_access_token) currentAccessToken = stored.lifetimesoft_access_token as string
        if (stored.lifetimesoft_refresh_token) currentRefreshToken = stored.lifetimesoft_refresh_token as string
      } catch {
        // storage may not be available — continue with provided tokens
      }

      // refresh token if needed before starting
      currentAccessToken = await refreshTokenIfNeeded()

      // register chrome.alarms listener
      chrome.alarms.onAlarm.addListener(onAlarmFired)

      // register chrome.runtime.onMessage listener for manual triggers
      // (alternative to WebSocket trigger for extensions that don't use WS)
      chrome.runtime.onMessage.addListener(onExtensionMessage)

      // register chrome.runtime.onSuspend for graceful shutdown (MV3 service worker)
      chrome.runtime.onSuspend.addListener(onSuspend)

      // start WebSocket heartbeat if runtime config is available
      if (runtimeCfg) {
        console.log("[runtime-chrome] Starting WebSocket heartbeat:", runtimeCfg.ws_url)
        wsConnection = startWebSocketHeartbeat(runId, runtimeCfg, getToken, refreshTokenIfNeeded, onWsMessage)
      } else {
        console.warn("[runtime-chrome] No runtime config — WebSocket heartbeat disabled")
      }

      // start scheduler loop
      startSchedulerLoop(schedulerConfig)

      console.log("[runtime-chrome] Runtime started. scheduler:", schedulerConfig.type)
    },

    async stop(): Promise<void> {
      if (stopped) return
      stopped = true
      console.log("[runtime-chrome] Stopping runtime...")
      runtimeAbort.abort()
      schedulerAbort.abort()
      chrome.alarms.onAlarm.removeListener(onAlarmFired)
      chrome.runtime.onMessage.removeListener(onExtensionMessage)
      chrome.runtime.onSuspend.removeListener(onSuspend)
      await chrome.alarms.clear(alarmName).catch(() => { /* best-effort */ })
      wsConnection?.close()
      await notifyStopped(runId, runtimeCfg, getToken)
      console.log("[runtime-chrome] Runtime stopped.")
    },
  }

  // ─── Extension message listener ──────────────────────────────────────────────

  function onExtensionMessage(
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean | undefined {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { type?: string }).type === "agent_trigger"
    ) {
      const jobId = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")
      console.log(`[${fmtDate()}] [job:${jobId}] [agent:info] [extension] trigger received`)
      ctx.log = makeLogger(jobId)

      agent.run(ctx).then((result) => {
        sendResponse({ success: true, result })
      }).catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[${fmtDate()}] [job:${jobId}] [agent:error] agent.run() threw:`, msg)
        sendResponse({ success: false, error: msg })
      })

      return true // keep message channel open for async response
    }
    return undefined
  }

  // ─── Suspend handler ─────────────────────────────────────────────────────────

  function onSuspend(): void {
    console.log("[runtime-chrome] Service worker suspending — notifying platform...")
    // best-effort sync notification before SW is terminated
    // Note: async operations may not complete before suspension
    void notifyStopped(runId, runtimeCfg, getToken)
  }
}

// ─── WebSocket Heartbeat (browser-native) ─────────────────────────────────────

const APP_URL = "https://app.lifetimesoft.com"

interface ChromeWebSocketHandle {
  close(): void
}

function startWebSocketHeartbeat(
  runId: string,
  cfg: RuntimeConfig,
  getToken: () => string | undefined,
  refreshToken: () => Promise<string | undefined>,
  onMessage?: (data: string) => void
): ChromeWebSocketHandle {
  let ws: WebSocket | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const connect = async (): Promise<void> => {
    if (stopped) return

    // refresh token before connecting
    const token = await refreshToken()
    const wsUrl = token
      ? `${cfg.ws_url}?token=${encodeURIComponent(token)}&run_id=${encodeURIComponent(runId)}`
      : `${cfg.ws_url}?run_id=${encodeURIComponent(runId)}`

    ws = new WebSocket(wsUrl)

    ws.addEventListener("open", () => {
      console.log("[runtime-chrome] WebSocket connected")
      heartbeatTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "heartbeat",
            run_id: runId,
            status: 1,
            timestamp: Math.floor(Date.now() / 1000),
          }))
        }
      }, cfg.heartbeat_interval_ms)
    })

    ws.addEventListener("message", (event: MessageEvent) => {
      onMessage?.(event.data as string)
    })

    ws.addEventListener("close", (event: CloseEvent) => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      if (stopped) return
      console.log(`[runtime-chrome] WebSocket closed (${event.code}), reconnecting in 5s...`)
      setTimeout(() => { void connect() }, 5_000)
    })

    ws.addEventListener("error", () => {
      // error will be followed by close — reconnect handled there
    })
  }

  void connect()

  return {
    close(): void {
      stopped = true
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      ws?.close()
    },
  }
}

// ─── Chrome Storage Provider ──────────────────────────────────────────────────

/**
 * ctx.storage backed by chrome.storage.local (or .sync).
 * Replaces the platform API-based storage from the Node.js runtime.
 *
 * Key format: "lifetimesoft_storage_{key}"
 * TTL is stored alongside the value as metadata.
 */
function buildChromeStorageProvider(area: "local" | "sync") {
  const prefix = "lifetimesoft_storage_"

  return {
    get: async <T = unknown>(key: string): Promise<T | null> => {
      const storageKey = prefix + key
      const result = await chrome.storage[area].get(storageKey)
      const entry = result[storageKey] as { value: T; exp?: number } | undefined
      if (!entry) return null
      // check TTL
      if (entry.exp !== undefined && Date.now() > entry.exp) {
        await chrome.storage[area].remove(storageKey)
        return null
      }
      return entry.value
    },

    set: async <T = unknown>(key: string, value: T, opts?: { ttl?: number }): Promise<void> => {
      const storageKey = prefix + key
      const entry: { value: T; exp?: number } = { value }
      if (opts?.ttl !== undefined) {
        entry.exp = Date.now() + opts.ttl * 1000
      }
      await chrome.storage[area].set({ [storageKey]: entry })
    },

    delete: async (key: string): Promise<void> => {
      await chrome.storage[area].remove(prefix + key)
    },
  }
}

// ─── Chrome Queue Provider ────────────────────────────────────────────────────

/**
 * ctx.queue backed by chrome.runtime.sendMessage.
 * Messages are dispatched to other parts of the extension (popup, content scripts, etc.)
 * via the standard Chrome extension messaging system.
 *
 * Message format: { type: "agent_queue_message", data: T }
 */
function buildChromeQueueProvider() {
  return {
    push: async <T = unknown>(data: T): Promise<void> => {
      try {
        await chrome.runtime.sendMessage({
          type: "agent_queue_message",
          data,
        })
      } catch (e) {
        // sendMessage throws if no listener is registered — treat as best-effort
        console.warn("[runtime-chrome] ctx.queue.push(): no message listener registered:", e)
      }
    },
  }
}

// ─── AI Provider ──────────────────────────────────────────────────────────────

/**
 * AI provider — identical logic to Node.js runtime but uses browser fetch().
 * Agent-side AI (gemini_api_key / openai_api_key in ctx.env) works the same way.
 * Platform-side AI uses the platform API endpoint with token auth.
 */
function buildAiProvider(
  cfg: RuntimeConfig | undefined,
  env: Record<string, unknown>,
  runId: string,
  pendingImageJobs: Map<string, {
    resolve: (url: string) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>,
  pendingVideoJobs: Map<string, {
    resolve: (url: string) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>,
  getToken: () => string | undefined
) {
  return {
    chat: async (req: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
      model?: string
      temperature?: number
    }): Promise<string> => {
      const geminiApiKey = env.gemini_api_key as string | undefined
      const openaiApiKey = env.openai_api_key as string | undefined
      const agentProvider = env.ai_provider as string | undefined

      if (geminiApiKey || openaiApiKey || agentProvider) {
        return callAgentSideAi(req, geminiApiKey, openaiApiKey, agentProvider)
      }
      return callPlatformSideAi(req, cfg, getToken)
    },

    image: async (req: {
      prompt: string
      model?: string
      size?: string
      quality?: string
      style?: string
      n?: number
      image_url?: string
    }): Promise<string> => {
      const geminiApiKey = env.gemini_api_key as string | undefined
      const openaiApiKey = env.openai_api_key as string | undefined
      const agentProvider = env.ai_provider as string | undefined

      if (geminiApiKey || openaiApiKey || agentProvider) {
        return callAgentSideImage(req, geminiApiKey, openaiApiKey, agentProvider)
      }
      return callPlatformSideImage(req, cfg, runId, pendingImageJobs, getToken)
    },

    video: async (req: {
      before_url: string
      after_url: string
      prompt?: string
      aspect_ratio?: string
      duration?: number
    }): Promise<string> => {
      return callPlatformSideVideo(req, cfg, runId, pendingVideoJobs, getToken)
    },
  }
}

// ─── Platform-side AI ─────────────────────────────────────────────────────────

async function callPlatformSideAi(
  req: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
    model?: string
    temperature?: number
  },
  cfg: RuntimeConfig | undefined,
  getToken: () => string | undefined
): Promise<string> {
  const aiUrl = cfg?.ai_url || `${APP_URL}/cli/ai-account-management/ai/chat`
  const token = getToken()
  if (!token) throw new Error("[runtime-chrome] Platform-side AI requires authentication (missing access token)")

  const res = await fetch(aiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ messages: req.messages, model: req.model, temperature: req.temperature }),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error")
    throw new Error(`[runtime-chrome] Platform-side AI failed (${res.status}): ${errorText}`)
  }

  const data = await res.json() as { success: boolean; response?: string; message?: string }
  if (!data.success || !data.response) {
    throw new Error(`[runtime-chrome] Platform-side AI failed: ${data.message || "no response"}`)
  }
  return data.response
}

async function callPlatformSideImage(
  req: {
    prompt: string
    model?: string
    size?: string
    quality?: string
    style?: string
    n?: number
    image_url?: string
  },
  cfg: RuntimeConfig | undefined,
  runId: string,
  pendingImageJobs: Map<string, {
    resolve: (url: string) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>,
  getToken: () => string | undefined
): Promise<string> {
  const imageUrl = cfg?.ai_url
    ? cfg.ai_url.replace(/\/chat$/, "/image")
    : `${APP_URL}/cli/ai-account-management/ai/image`

  const token = getToken()
  if (!token) throw new Error("[runtime-chrome] Platform-side AI image requires authentication (missing access token)")

  const res = await fetch(imageUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ ...req, run_id: runId }),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error")
    throw new Error(`[runtime-chrome] Platform-side AI image failed (${res.status}): ${errorText}`)
  }

  const data = await res.json() as { success: boolean; job_id?: string; message?: string }
  if (!data.success || !data.job_id) {
    throw new Error(`[runtime-chrome] Platform-side AI image failed: ${data.message || "no job_id"}`)
  }

  const IMAGE_READY_TIMEOUT_MS = 120_000 // 2 minutes
  console.log(`[runtime-chrome] Image job ${data.job_id} submitted — waiting for image_ready...`)

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingImageJobs.delete(data.job_id!)
      reject(new Error(`[runtime-chrome] Image job ${data.job_id} timed out after ${IMAGE_READY_TIMEOUT_MS}ms`))
    }, IMAGE_READY_TIMEOUT_MS)

    pendingImageJobs.set(data.job_id!, { resolve, reject, timer })
  })
}

async function callPlatformSideVideo(
  req: {
    before_url: string
    after_url: string
    prompt?: string
    aspect_ratio?: string
    duration?: number
  },
  cfg: RuntimeConfig | undefined,
  runId: string,
  pendingVideoJobs: Map<string, {
    resolve: (url: string) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>,
  getToken: () => string | undefined
): Promise<string> {
  const videoUrl = cfg?.ai_url
    ? cfg.ai_url.replace(/\/chat$/, "/video")
    : `${APP_URL}/cli/ai-account-management/ai/video`

  const token = getToken()
  if (!token) throw new Error("[runtime-chrome] Platform-side AI video requires authentication (missing access token)")

  const res = await fetch(videoUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ ...req, run_id: runId }),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error")
    throw new Error(`[runtime-chrome] Platform-side AI video failed (${res.status}): ${errorText}`)
  }

  const data = await res.json() as { success: boolean; job_id?: string; message?: string }
  if (!data.success || !data.job_id) {
    throw new Error(`[runtime-chrome] Platform-side AI video failed: ${data.message || "no job_id"}`)
  }

  const VIDEO_READY_TIMEOUT_MS = 300_000 // 5 minutes
  console.log(`[runtime-chrome] Video job ${data.job_id} submitted — waiting for video_ready...`)

  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingVideoJobs.delete(data.job_id!)
      reject(new Error(`[runtime-chrome] Video job ${data.job_id} timed out after ${VIDEO_READY_TIMEOUT_MS}ms`))
    }, VIDEO_READY_TIMEOUT_MS)

    pendingVideoJobs.set(data.job_id!, { resolve, reject, timer })
  })
}

// ─── Agent-side AI (direct API calls) ────────────────────────────────────────

async function callAgentSideAi(
  req: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
    model?: string
    temperature?: number
  },
  geminiApiKey: string | undefined,
  openaiApiKey: string | undefined,
  provider: string | undefined
): Promise<string> {
  const isOpenAI = req.model?.startsWith("gpt-") || provider === "openai"

  if (isOpenAI) {
    if (!openaiApiKey) throw new Error("[runtime-chrome] Agent-side AI: openai_api_key not found in agent env")
    return callOpenAIDirect(req, openaiApiKey)
  } else {
    if (!geminiApiKey) throw new Error("[runtime-chrome] Agent-side AI: gemini_api_key not found in agent env")
    return callGeminiDirect(req, geminiApiKey)
  }
}

async function callAgentSideImage(
  req: {
    prompt: string
    model?: string
    size?: string
    quality?: string
    style?: string
    n?: number
    image_url?: string
  },
  geminiApiKey: string | undefined,
  openaiApiKey: string | undefined,
  provider: string | undefined
): Promise<string> {
  const isOpenAI = req.model?.startsWith("dall-e") || provider === "openai" || !geminiApiKey
  if (isOpenAI) {
    if (!openaiApiKey) throw new Error("[runtime-chrome] Agent-side image: openai_api_key not found in agent env")
    return callOpenAIImageDirect(req, openaiApiKey)
  }
  throw new Error("[runtime-chrome] Agent-side image generation requires openai_api_key (DALL-E)")
}

async function callGeminiDirect(
  req: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
    model?: string
    temperature?: number
  },
  apiKey: string
): Promise<string> {
  const model = req.model || "gemini-2.0-flash"
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  // convert messages to Gemini format
  const systemMsg = req.messages.find((m) => m.role === "system")
  const conversationMsgs = req.messages.filter((m) => m.role !== "system")

  const body: Record<string, unknown> = {
    contents: conversationMsgs.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: req.temperature !== undefined ? { temperature: req.temperature } : undefined,
  }
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] }
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error")
    throw new Error(`[runtime-chrome] Gemini API failed (${res.status}): ${errorText}`)
  }

  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error("[runtime-chrome] Gemini API returned no text")
  return text
}

async function callOpenAIDirect(
  req: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
    model?: string
    temperature?: number
  },
  apiKey: string
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model || "gpt-4o-mini",
      messages: req.messages,
      temperature: req.temperature,
    }),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error")
    throw new Error(`[runtime-chrome] OpenAI API failed (${res.status}): ${errorText}`)
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const text = data.choices?.[0]?.message?.content
  if (!text) throw new Error("[runtime-chrome] OpenAI API returned no text")
  return text
}

async function callOpenAIImageDirect(
  req: {
    prompt: string
    model?: string
    size?: string
    quality?: string
    style?: string
    n?: number
  },
  apiKey: string
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: req.model || "dall-e-3",
      prompt: req.prompt,
      size: req.size || "1024x1024",
      quality: req.quality || "standard",
      style: req.style,
      n: req.n || 1,
      response_format: "url",
    }),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error")
    throw new Error(`[runtime-chrome] OpenAI image API failed (${res.status}): ${errorText}`)
  }

  const data = await res.json() as { data?: Array<{ url?: string }> }
  const url = data.data?.[0]?.url
  if (!url) throw new Error("[runtime-chrome] OpenAI image API returned no URL")
  return url
}

// ─── Notify stopped ───────────────────────────────────────────────────────────

async function notifyStopped(
  runId: string,
  cfg: RuntimeConfig | undefined,
  getToken: () => string | undefined
): Promise<void> {
  if (!cfg?.stopped_url) return
  const token = getToken()
  try {
    await fetch(cfg.stopped_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: token } : {}),
      },
      body: JSON.stringify({ run_id: runId, last_error: null }),
    })
  } catch {
    // best-effort
  }
}

// ─── Chrome Alarm setup ───────────────────────────────────────────────────────

/**
 * Set up a chrome.alarms entry for the given scheduler config.
 *
 * Limitations vs Node.js runtime:
 * - chrome.alarms minimum period is 1 minute (Chrome enforces this for MV3)
 * - Cron expressions are approximated: only the first matching minute is used
 *   as the alarm period. For precise cron scheduling, use the Node.js runtime.
 */
function setupChromeAlarm(cfg: SchedulerConfig, alarmName: string): void {
  if (cfg.type === "interval") {
    // chrome.alarms uses minutes — convert from ms
    const periodInMinutes = Math.max(1, cfg.value / 60_000)
    chrome.alarms.create(alarmName, {
      delayInMinutes: periodInMinutes,
      periodInMinutes,
    })
    console.log(`[runtime-chrome] Alarm created: interval every ${periodInMinutes} min`)

  } else if (cfg.type === "cron") {
    // Approximate cron with chrome.alarms:
    // Parse the cron expression to find the smallest interval in minutes.
    // For exact cron matching, the alarm fires every minute and the handler
    // checks if the current time matches the cron expression.
    chrome.alarms.create(alarmName, {
      delayInMinutes: 1,
      periodInMinutes: 1, // fire every minute, handler checks cron match
    })
    console.log(`[runtime-chrome] Alarm created: cron "${cfg.value}" (checked every 1 min)`)
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function fmtDate(): string {
  return new Date().toISOString()
}

function makeLogger(jobId: string) {
  const tag = jobId ? `[job:${jobId}]` : ""
  return {
    info:  (...args: unknown[]) => console.log(`[${fmtDate()}]${tag} [agent:info]`, ...args),
    error: (...args: unknown[]) => console.error(`[${fmtDate()}]${tag} [agent:error]`, ...args),
    debug: (...args: unknown[]) => console.debug(`[${fmtDate()}]${tag} [agent:debug]`, ...args),
  }
}

/**
 * Returns an AbortSignal that aborts when ANY of the provided signals abort.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true })
  }
  return controller.signal
}