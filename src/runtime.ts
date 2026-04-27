/**
 * @lifetimesoft/agent-sdk/runtime
 *
 * Runtime bootstrap executed inside the agent process.
 * The agent's start command should invoke this file, e.g.:
 *   node node_modules/@lifetimesoft/agent-sdk/dist/runtime.js
 *
 * Responsibilities:
 * - Parse AGENT_CTX from env (injected by lifectl)
 * - Build full ctx with runtime providers (log, storage, ai, queue)
 * - Start heartbeat loop — URL comes from ctx.meta.runtime (set by SaaS)
 * - Call agent.run(ctx)
 * - Notify SaaS when agent stops
 *
 * Agent code never calls heartbeat — fully managed here.
 * Heartbeat URLs come from SaaS so changing them requires no SDK update.
 */

import fs from "fs"
import path from "path"
import WebSocket from "ws"
import type { Context, RuntimeConfig, SchedulerConfig } from "./types"
import { runWithScheduler } from "./scheduler"

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const ctxJson = process.env.AGENT_CTX
  const accessToken = process.env.AGENT_ACCESS_TOKEN

  console.log("[runtime] Starting agent runtime...")
  console.log("[runtime] AGENT_CTX present:", !!ctxJson)
  console.log("[runtime] AGENT_ACCESS_TOKEN present:", !!accessToken)

  if (!ctxJson) {
    console.error("[runtime] Missing required env var: AGENT_CTX")
    process.exit(1)
  }

  // parse ctx base (input, config, env, meta) — provided by SaaS via lifectl
  let ctxBase: Pick<Context, "input" | "config" | "env" | "meta"> | undefined
  try {
    ctxBase = JSON.parse(ctxJson) as Pick<Context, "input" | "config" | "env" | "meta">
    console.log("[runtime] Parsed AGENT_CTX successfully")
    console.log("[runtime] run_id:", ctxBase.meta?.run_id)
    console.log("[runtime] runtime config present:", !!ctxBase.meta?.runtime)
    if (ctxBase.meta?.runtime) {
      console.log("[runtime] ws_url:", ctxBase.meta.runtime.ws_url)
      console.log("[runtime] heartbeat_interval_ms:", ctxBase.meta.runtime.heartbeat_interval_ms)
    }
  } catch (e) {
    console.error("[runtime] Failed to parse AGENT_CTX — invalid JSON:", e)
    process.exit(1)
  }

  if (!ctxBase) {
    process.exit(1)
  }

  const runId = ctxBase.meta?.run_id
  const runtimeCfg: RuntimeConfig | undefined = ctxBase.meta?.runtime

  if (!runId) {
    console.error("[runtime] AGENT_CTX is missing meta.run_id")
    process.exit(1)
  }

  // build full ctx — providers injected here, agent code only sees the interface
  const makeLogger = (jobId: string) => ({
    info:  (...args: unknown[]) => console.log(`[${fmtDate()}] [job:${jobId}] [agent:info]`, ...args),
    error: (...args: unknown[]) => console.error(`[${fmtDate()}] [job:${jobId}] [agent:error]`, ...args),
    debug: (...args: unknown[]) => console.debug(`[${fmtDate()}] [job:${jobId}] [agent:debug]`, ...args),
  })

  // resolve agent entrypoint:
  // 1. agent.json "main" field
  // 2. package.json "main" field
  // 3. fallback: dist/index.js
  let entrypoint = "dist/index.js"
  try {
    const agentJsonPath = path.resolve(process.cwd(), "agent.json")
    const agentJson = JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"))
    if (agentJson.main) {
      entrypoint = agentJson.main
    } else {
      const pkgPath = path.resolve(process.cwd(), "package.json")
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
      if (pkg.main) entrypoint = pkg.main
    }
  } catch { /* use fallback */ }

  const ctx: Context = {
    ...ctxBase,
    log: makeLogger(""),
    ai: buildAiProvider(runtimeCfg, accessToken, ctxBase.env),
    storage: buildStorageProvider(runId, runtimeCfg, accessToken),
    queue: {
      push: async () => {
        throw new Error("[runtime] ctx.queue.push() is not configured in this runtime.")
      },
    },
  }

  // load agent module from cwd
  const agentEntry = path.resolve(process.cwd(), entrypoint)
  let agentModule: unknown
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    agentModule = require(agentEntry)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[runtime] Failed to load agent at ${agentEntry}: ${msg}`)
    process.exit(1)
  }

  const agent = (agentModule as { default?: unknown })?.default ?? agentModule
  if (
    !agent ||
    typeof agent !== "object" ||
    !(agent as { __isAgent?: boolean }).__isAgent ||
    typeof (agent as { run?: unknown }).run !== "function"
  ) {
    console.error("[runtime] Loaded module is not a valid agent. Make sure it uses defineAgent().")
    process.exit(1)
  }

  const agentRun = (agent as { run: (ctx: Context) => Promise<unknown> }).run

  // resolve scheduler config from ctx.config.scheduler (sourced from database by platform)
  // default to { type: "none" } if not set
  let schedulerConfig: SchedulerConfig = ctxBase.config?.scheduler ?? { type: "none" }

  // graceful shutdown via AbortController — must be declared before startSchedulerLoop
  const abortController = new AbortController()

  // for scheduler type "none": listen for trigger messages from DO via WebSocket
  // for interval/cron: scheduler loop handles execution — no trigger needed
  // all types: listen for config_updated to reload scheduler loop with new config
  let schedulerAbort = new AbortController()

  const startSchedulerLoop = (cfg: SchedulerConfig) => {
    schedulerAbort.abort()
    schedulerAbort = new AbortController()
    const combinedSignal = anySignal([abortController.signal, schedulerAbort.signal])
    runWithScheduler(
      cfg,
      (jobId: string) => {
        ctx.log = makeLogger(jobId)
        return agentRun(ctx).then(() => undefined)
      },
      combinedSignal,
      makeLogger(""),
    ).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("[runtime] scheduler threw:", msg)
    })
  }

  let onWsMessage: ((data: string) => void) | undefined
  onWsMessage = (data: string) => {
    try {
      const msg = JSON.parse(data) as { type?: string; scheduler?: unknown; config?: unknown }
      if (msg.type === "trigger" && schedulerConfig.type === "none") {
        const jobId = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")
        console.log(`[${fmtDate()}] [job:${jobId}] [agent:info] [scheduler] start job ${jobId}`)
        ctx.log = makeLogger(jobId)
        agentRun(ctx).then(() => {
          console.log(`[${fmtDate()}] [job:${jobId}] [agent:info] [scheduler] end job ${jobId}`)
          console.log(`[${fmtDate()}] [job:${jobId}] [agent:info] ----------`)
        }).catch((e: unknown) => {
          const errMsg = e instanceof Error ? e.message : String(e)
          console.error(`[${fmtDate()}] [job:${jobId}] [agent:error] agent.run() threw during trigger:`, errMsg)
        })
      } else if (msg.type === "config_updated" && msg.config) {
        console.log("[runtime] config_updated received — reloading config:", JSON.stringify(msg.config))
        // update full ctx.config with new config from platform
        ctx.config = msg.config as Context["config"]
        // update ctx.env if present in config (platform env overrides default env from version)
        if ((msg.config as { env?: Record<string, unknown> })?.env) {
          ctx.env = (msg.config as { env: Record<string, unknown> }).env
          console.log("[runtime] env updated:", JSON.stringify(ctx.env))
        }
        // extract scheduler config for scheduler loop
        schedulerConfig = (msg.config as { scheduler?: SchedulerConfig })?.scheduler ?? { type: "none" }
        startSchedulerLoop(schedulerConfig)
      }
    } catch {
      // ignore malformed messages
    }
  }

  // connect WebSocket for heartbeat — URL comes from ctx.meta.runtime
  if (!runtimeCfg) {
    console.warn("[runtime] No runtime config found in ctx.meta.runtime — WebSocket heartbeat disabled")
    console.warn("[runtime] Agent will not receive live config updates or trigger messages")
  } else {
    console.log("[runtime] Starting WebSocket heartbeat:", { ws_url: runtimeCfg.ws_url, heartbeat_interval_ms: runtimeCfg.heartbeat_interval_ms })
  }
  const wsConnection = runtimeCfg
    ? startWebSocketHeartbeat(runId, runtimeCfg, accessToken, onWsMessage)
    : null

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[runtime] ${signal} received, shutting down...`)
    abortController.abort()
    wsConnection?.close()
    await notifyStopped(runId, runtimeCfg, accessToken)
    process.exit(0)
  }
  process.on("SIGTERM", () => { void shutdown("SIGTERM") })
  process.on("SIGINT", () => { void shutdown("SIGINT") })

  // start scheduler loop — restartable via config_updated WebSocket message
  startSchedulerLoop(schedulerConfig)

  // wait until process-level abort (SIGTERM/SIGINT)
  await new Promise<void>((resolve) => {
    abortController.signal.addEventListener("abort", () => resolve(), { once: true })
  })

  // completed normally
  wsConnection?.close()
  await notifyStopped(runId, runtimeCfg, accessToken)
}

// ─── WebSocket Heartbeat ──────────────────────────────────────────────────────

const APP_URL = "https://app.lifetimesoft.com"

function startWebSocketHeartbeat(
  runId: string,
  cfg: RuntimeConfig,
  accessToken: string | undefined,
  onMessage?: (data: string) => void
): WebSocket {
  // track current token — may be refreshed on reconnect
  let currentToken = accessToken

  let ws: WebSocket
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let stopped = false

  const connect = async (): Promise<void> => {
    if (stopped) return

    // refresh token before connecting if we have a refresh token
    currentToken = await refreshTokenIfNeeded(currentToken) ?? currentToken

    const wsUrl = currentToken
      ? `${cfg.ws_url}?token=${encodeURIComponent(currentToken)}&run_id=${encodeURIComponent(runId)}`
      : `${cfg.ws_url}?run_id=${encodeURIComponent(runId)}`

    ws = new WebSocket(wsUrl)

    ws.addEventListener("open", () => {
      console.log("[runtime] WebSocket connected")
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "heartbeat", run_id: runId, status: 1, timestamp: Math.floor(Date.now() / 1000) }))
        }
      }, cfg.heartbeat_interval_ms)
      heartbeatTimer.unref()
    })

    ws.addEventListener("message", (event: { data: WebSocket.Data; type: string; target: WebSocket }) => {
      onMessage?.(event.data as string)
    })

    ws.addEventListener("close", (event: { wasClean: boolean; code: number; reason: string; target: WebSocket }) => {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      if (stopped) return
      // reconnect after 5s — refresh token in case it expired
      console.log(`[runtime] WebSocket closed (${event.code}), reconnecting in 5s...`)
      setTimeout(() => { void connect() }, 5_000).unref()
    })

    ws.addEventListener("error", () => {
      // error will be followed by close — reconnect handled there
    })
  }

  void connect()

  return {
    close: () => {
      stopped = true
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null }
      ws?.close()
    },
    get readyState() { return ws?.readyState ?? WebSocket.CLOSED },
  } as unknown as WebSocket
}

/**
 * Attempt to refresh the access token using the refresh token stored in AGENT_REFRESH_TOKEN env.
 * Returns the new access token if successful, or undefined if refresh is not possible.
 */
async function refreshTokenIfNeeded(currentToken: string | undefined): Promise<string | undefined> {
  const refreshToken = process.env.AGENT_REFRESH_TOKEN
  if (!refreshToken || !currentToken) return currentToken

  // check if token is expired (JWT payload.exp)
  try {
    const payload = JSON.parse(Buffer.from(currentToken.split(".")[1], "base64url").toString())
    const isExpired = Math.floor(Date.now() / 1000) >= payload.exp
    if (!isExpired) return currentToken // still valid, no need to refresh
  } catch {
    // can't parse token — try refresh anyway
  }

  try {
    const res = await fetch(`${APP_URL}/cli-login/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "lifectl-cli",
      },
      body: JSON.stringify({
        access_token: currentToken,
        refresh_token: refreshToken,
      }),
    })

    if (!res.ok) {
      console.error("[runtime] Token refresh failed:", res.status)
      return currentToken
    }

    const data = await res.json() as { access_token?: string; refresh_token?: string }
    if (data.access_token) {
      console.log("[runtime] Token refreshed successfully")
      // update env vars so future reconnects use the new tokens
      process.env.AGENT_ACCESS_TOKEN = data.access_token
      if (data.refresh_token) process.env.AGENT_REFRESH_TOKEN = data.refresh_token
      return data.access_token
    }
  } catch (e) {
    console.error("[runtime] Token refresh error:", e)
  }

  return currentToken
}

async function notifyStopped(
  runId: string,
  cfg: RuntimeConfig | undefined,
  accessToken: string | undefined,
  lastError?: string
): Promise<void> {
  if (!cfg?.stopped_url) return
  await post(cfg.stopped_url, { run_id: runId, last_error: lastError ?? null }, accessToken).catch(() => {
    // best-effort
  })
}

// ─── Storage provider ─────────────────────────────────────────────────────────

function buildStorageProvider(
  runId: string,
  cfg: RuntimeConfig | undefined,
  accessToken: string | undefined
) {
  // derive storage base URL from stopped_url
  // e.g. .../agents/stopped → .../agents
  const base = cfg?.stopped_url
    ? cfg.stopped_url.replace(/\/stopped$/, "")
    : null

  return {
    get: async <T = unknown>(key: string): Promise<T | null> => {
      if (!base) throw new Error("[runtime] storage is not configured (no runtime config in ctx.meta)")
      const res = await post(`${base}/storage/get`, { run_id: runId, key }, accessToken) as { value?: T }
      return res?.value ?? null
    },
    set: async <T = unknown>(key: string, value: T, opts?: { ttl?: number }): Promise<void> => {
      if (!base) throw new Error("[runtime] storage is not configured (no runtime config in ctx.meta)")
      await post(`${base}/storage/set`, { run_id: runId, key, value, ttl: opts?.ttl }, accessToken)
    },
    delete: async (key: string): Promise<void> => {
      if (!base) throw new Error("[runtime] storage is not configured (no runtime config in ctx.meta)")
      await post(`${base}/storage/delete`, { run_id: runId, key }, accessToken)
    },
  }
}

// ─── AI provider ──────────────────────────────────────────────────────────────

function buildAiProvider(
  cfg: RuntimeConfig | undefined,
  accessToken: string | undefined,
  env: Record<string, unknown>
) {
  return {
    chat: async (req: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
      model?: string
      temperature?: number
    }): Promise<string> => {
      // Check for agent-side AI configuration
      const geminiApiKey = env.gemini_api_key as string | undefined
      const openaiApiKey = env.openai_api_key as string | undefined
      const agentProvider = env.ai_provider as string | undefined

      if (geminiApiKey || openaiApiKey || agentProvider) {
        // Agent-side mode: call AI provider directly from agent
        return callAgentSideAi(req, geminiApiKey, openaiApiKey, agentProvider)
      }

      // Platform-side mode: call platform API endpoint
      return callPlatformSideAi(req, cfg, accessToken)
    },
  }
}

/**
 * Agent-side AI: Agent calls AI provider directly using its own API key
 */
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
  // Auto-detect provider from model name or explicit provider setting
  const isOpenAI = req.model?.startsWith("gpt-") || provider === "openai"
  const selectedProvider = isOpenAI ? "openai" : "gemini"

  if (selectedProvider === "gemini") {
    if (!geminiApiKey) {
      throw new Error("[runtime] Agent-side AI: gemini_api_key not found in agent env")
    }
    return callGeminiDirect(req, geminiApiKey)
  } else {
    if (!openaiApiKey) {
      throw new Error("[runtime] Agent-side AI: openai_api_key not found in agent env")
    }
    return callOpenAIDirect(req, openaiApiKey)
  }
}

/**
 * Platform-side AI: Agent calls platform API endpoint
 */
async function callPlatformSideAi(
  req: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
    model?: string
    temperature?: number
  },
  cfg: RuntimeConfig | undefined,
  accessToken: string | undefined
): Promise<string> {
  const aiUrl = cfg?.ai_url || "https://app.lifetimesoft.com/cli/ai-account-management/ai/chat"

  if (!accessToken) {
    throw new Error("[runtime] Platform-side AI requires authentication (missing access token)")
  }

  const res = await fetch(aiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: accessToken,
    },
    body: JSON.stringify({
      messages: req.messages,
      model: req.model,
      temperature: req.temperature,
    }),
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error")
    throw new Error(`[runtime] Platform-side AI failed (${res.status}): ${errorText}`)
  }

  const data = await res.json() as { success: boolean; response?: string; message?: string }

  if (!data.success || !data.response) {
    throw new Error(`[runtime] Platform-side AI failed: ${data.message || "no response"}`)
  }

  return data.response
}

/**
 * Call Gemini API directly (Agent-side)
 */
async function callGeminiDirect(
  req: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
    model?: string
    temperature?: number
  },
  apiKey: string
): Promise<string> {
  const model = req.model || "gemini-2.0-flash-exp"

  // Convert messages to Gemini format
  const contents = req.messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }))

  const systemInstruction = req.messages.find(m => m.role === "system")?.content

  const requestBody: any = {
    contents,
    generationConfig: {
      temperature: req.temperature ?? 0.7,
    }
  }

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction }]
    }
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    }
  )

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error")
    throw new Error(`[runtime] Gemini API error (${res.status}): ${errorText}`)
  }

  const data = await res.json() as any

  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error("[runtime] Invalid response from Gemini API")
  }

  return data.candidates[0].content.parts[0].text
}

/**
 * Call OpenAI API directly (Agent-side)
 */
async function callOpenAIDirect(
  req: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
    model?: string
    temperature?: number
  },
  apiKey: string
): Promise<string> {
  const model = req.model || "gpt-4o-mini"

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
    })
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error")
    throw new Error(`[runtime] OpenAI API error (${res.status}): ${errorText}`)
  }

  const data = await res.json() as any

  if (!data.choices?.[0]?.message?.content) {
    throw new Error("[runtime] Invalid response from OpenAI API")
  }

  return data.choices[0].message.content
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function post(url: string, body: unknown, accessToken: string | undefined): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: accessToken } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`POST ${url} returned ${res.status}`)
  return res.json()
}

// ─── Entry ────────────────────────────────────────────────────────────────────

/** Format current time as "YYYY-MM-DD HH:MM:SS" (no ms, space instead of T) */
function fmtDate(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19)
}

/**
 * Combine multiple AbortSignals — aborts when any one of them aborts.
 */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) { controller.abort(); break }
    signal.addEventListener("abort", () => controller.abort(), { once: true })
  }
  return controller.signal
}

void main()
