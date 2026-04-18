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

import path from "path"
import type { Context, RuntimeConfig } from "./types"

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const ctxJson = process.env.AGENT_CTX
  const accessToken = process.env.AGENT_ACCESS_TOKEN

  if (!ctxJson) {
    console.error("[runtime] Missing required env var: AGENT_CTX")
    process.exit(1)
  }

  // parse ctx base (input, config, env, meta) — provided by SaaS via lifectl
  let ctxBase: Pick<Context, "input" | "config" | "env" | "meta"> | undefined
  try {
    ctxBase = JSON.parse(ctxJson) as Pick<Context, "input" | "config" | "env" | "meta">
  } catch {
    console.error("[runtime] Failed to parse AGENT_CTX — invalid JSON")
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
  const ctx: Context = {
    ...ctxBase,
    log: {
      info: (...args: unknown[]) => console.log("[agent:info]", ...args),
      error: (...args: unknown[]) => console.error("[agent:error]", ...args),
      debug: (...args: unknown[]) => console.debug("[agent:debug]", ...args),
    },
    ai: {
      chat: async () => {
        throw new Error("[runtime] ctx.ai.chat() is not configured in this runtime.")
      },
    },
    storage: buildStorageProvider(runId, runtimeCfg, accessToken),
    queue: {
      push: async () => {
        throw new Error("[runtime] ctx.queue.push() is not configured in this runtime.")
      },
    },
  }

  // load agent module from cwd (dist/index.js)
  const agentEntry = path.resolve(process.cwd(), "dist", "index.js")
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

  // start heartbeat — URL comes from ctx.meta.runtime, not hardcoded
  const heartbeatTimer = runtimeCfg
    ? startHeartbeat(runId, runtimeCfg, accessToken)
    : null

  // graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[runtime] ${signal} received, shutting down...`)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    await notifyStopped(runId, runtimeCfg, accessToken)
    process.exit(0)
  }
  process.on("SIGTERM", () => { void shutdown("SIGTERM") })
  process.on("SIGINT", () => { void shutdown("SIGINT") })

  // run the agent — heartbeat runs in background via setInterval
  try {
    await agentRun(ctx)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error("[runtime] agent.run() threw:", msg)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    await notifyStopped(runId, runtimeCfg, accessToken, msg)
    process.exit(1)
  }

  // run() completed normally
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  await notifyStopped(runId, runtimeCfg, accessToken)
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

function startHeartbeat(
  runId: string,
  cfg: RuntimeConfig,
  accessToken: string | undefined
): ReturnType<typeof setInterval> {
  const interval = setInterval(() => {
    void post(cfg.heartbeat_url, { run_id: runId, status: 1 }, accessToken).catch(() => {
      // heartbeat failure is non-fatal — agent keeps running
    })
  }, cfg.heartbeat_interval_ms)

  // do not keep process alive just for heartbeat
  interval.unref()
  return interval
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
  // derive storage base URL from heartbeat_url
  // e.g. .../agents/heartbeat → .../agents
  const base = cfg?.heartbeat_url
    ? cfg.heartbeat_url.replace(/\/heartbeat$/, "")
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

void main()
