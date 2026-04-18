/**
 * @lifetimesoft/agent-sdk/runtime
 *
 * Runtime entry point executed by the lifectl CLI.
 * Loads the agent, builds the context from environment variables,
 * calls agent.run(ctx), and manages the heartbeat loop.
 *
 * Agent code never needs to know about heartbeat or runtime internals.
 *
 * Usage (injected by lifectl as the start command):
 *   node node_modules/@lifetimesoft/agent-sdk/dist/runtime.js
 */

import path from "path"
import { createRequire } from "module"
import type { Context } from "./types"

// ─── Constants ────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 20_000 // 20s
const SAAS_BASE_URL = "https://app.lifetimesoft.com/cli/ai-account-management"

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const runId = process.env.AGENT_RUN_ID
  const agentName = process.env.AGENT_NAME
  const agentVersion = process.env.AGENT_VERSION
  const ctxJson = process.env.AGENT_CTX
  const accessToken = process.env.AGENT_ACCESS_TOKEN

  if (!runId || !agentName || !agentVersion || !ctxJson) {
    console.error("[runtime] Missing required env vars: AGENT_RUN_ID, AGENT_NAME, AGENT_VERSION, AGENT_CTX")
    process.exit(1)
  }

  // parse ctx from env (config, meta, env from SaaS)
  let ctxBase: Pick<Context, "input" | "config" | "env" | "meta">
  try {
    ctxBase = JSON.parse(ctxJson)
  } catch {
    console.error("[runtime] Failed to parse AGENT_CTX")
    process.exit(1)
  }

  // build full ctx with runtime providers
  const ctx: Context = {
    ...ctxBase,
    ai: {
      chat: async () => {
        throw new Error("[runtime] ctx.ai.chat() is not configured in this runtime.")
      },
    },
    storage: buildStorageProvider(runId, accessToken),
    queue: {
      push: async () => {
        throw new Error("[runtime] ctx.queue.push() is not configured in this runtime.")
      },
    },
    log: buildLogger(),
  }

  // load agent module — entry point is dist/index.js relative to cwd
  const agentPath = path.resolve(process.cwd(), "dist", "index.js")
  const require = createRequire(import.meta.url)
  let agentModule: any
  try {
    agentModule = require(agentPath)
  } catch (e: any) {
    console.error(`[runtime] Failed to load agent at ${agentPath}: ${e.message}`)
    process.exit(1)
  }

  const agent = agentModule?.default ?? agentModule
  if (!agent?.__isAgent || typeof agent.run !== "function") {
    console.error("[runtime] Loaded module is not a valid agent. Make sure it uses defineAgent().")
    process.exit(1)
  }

  // start heartbeat loop before running agent
  const heartbeat = startHeartbeat(runId, accessToken)

  // handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[runtime] Received ${signal}, shutting down...`)
    clearInterval(heartbeat)
    await notifyStopped(runId, accessToken)
    process.exit(0)
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"))
  process.on("SIGINT", () => shutdown("SIGINT"))

  // run the agent
  try {
    await agent.run(ctx)
  } catch (e: any) {
    console.error("[runtime] Agent run() threw an error:", e.message)
    clearInterval(heartbeat)
    await notifyStopped(runId, accessToken, e.message)
    process.exit(1)
  }

  // agent run() completed normally
  clearInterval(heartbeat)
  await notifyStopped(runId, accessToken)
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

function startHeartbeat(runId: string, accessToken: string | undefined): ReturnType<typeof setInterval> {
  const interval = setInterval(async () => {
    try {
      await saasPost("/agents/heartbeat", { run_id: runId, status: 1 }, accessToken)
    } catch {
      // heartbeat failure is non-fatal — agent keeps running
    }
  }, HEARTBEAT_INTERVAL_MS)

  // do not keep process alive just for heartbeat
  interval.unref()
  return interval
}

async function notifyStopped(runId: string, accessToken: string | undefined, lastError?: string): Promise<void> {
  try {
    await saasPost("/agents/stopped", { run_id: runId, last_error: lastError ?? null }, accessToken)
  } catch {
    // best-effort
  }
}

// ─── Providers ────────────────────────────────────────────────────────────────

function buildLogger() {
  return {
    info: (...args: unknown[]) => console.log("[agent:info]", ...args),
    error: (...args: unknown[]) => console.error("[agent:error]", ...args),
    debug: (...args: unknown[]) => console.debug("[agent:debug]", ...args),
  }
}

function buildStorageProvider(runId: string, accessToken: string | undefined) {
  return {
    get: async <T = unknown>(key: string): Promise<T | null> => {
      const res = await saasPost("/agents/storage/get", { run_id: runId, key }, accessToken)
      return (res?.value as T) ?? null
    },
    set: async <T = unknown>(key: string, value: T, opts?: { ttl?: number }): Promise<void> => {
      await saasPost("/agents/storage/set", { run_id: runId, key, value, ttl: opts?.ttl }, accessToken)
    },
    delete: async (key: string): Promise<void> => {
      await saasPost("/agents/storage/delete", { run_id: runId, key }, accessToken)
    },
  }
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function saasPost(path: string, body: unknown, accessToken: string | undefined): Promise<any> {
  const res = await fetch(`${SAAS_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: accessToken } : {}),
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`SaaS ${path} returned ${res.status}`)
  return res.json()
}

// ─── Entry ────────────────────────────────────────────────────────────────────

main()
