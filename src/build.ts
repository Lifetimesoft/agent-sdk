#!/usr/bin/env node
/**
 * agent-build — zero-config build tool for @lifetimesoft/agent-sdk agents.
 *
 * Usage (in agent's package.json):
 *   "build": "agent-build"
 *   "build": "agent-build --external:playwright"
 *   "dev":   "agent-build --watch"
 *
 * Defaults (read from agent.json in cwd):
 *   entry:    src/index.ts
 *   outfile:  dist/index.js  (or agent.json "main" field)
 *   format:   cjs
 *   bundle:   true
 *   platform: neutral  (works on both Node and Chrome sandbox)
 *
 * Override platform via --platform=node when agent uses Node built-ins (fs, path, etc.)
 */

import { build, context } from "esbuild"
import fs from "fs"
import path from "path"

// ─── Read agent.json ──────────────────────────────────────────────────────────

function readAgentJson(): Record<string, unknown> {
  const agentJsonPath = path.resolve(process.cwd(), "agent.json")
  if (!fs.existsSync(agentJsonPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(agentJsonPath, "utf-8"))
  } catch {
    return {}
  }
}

// ─── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const isWatch = args.includes("--watch")

// pass-through flags to esbuild (e.g. --external:playwright, --platform=node)
const passthroughFlags = args.filter(a => a !== "--watch")

// extract --platform override if provided
const platformArg = passthroughFlags.find(a => a.startsWith("--platform="))
const platform = platformArg
  ? (platformArg.split("=")[1] as "node" | "browser" | "neutral")
  : "neutral"

// extract --external:* flags
const externalFlags = passthroughFlags
  .filter(a => a.startsWith("--external:"))
  .map(a => a.replace("--external:", ""))

// ─── Resolve entry and outfile ────────────────────────────────────────────────

const agentJson = readAgentJson()
const outfile = path.resolve(process.cwd(), (agentJson.main as string | undefined) ?? "dist/index.js")
const entry   = path.resolve(process.cwd(), "src/index.ts")

if (!fs.existsSync(entry)) {
  console.error(`[agent-build] Entry point not found: ${entry}`)
  process.exit(1)
}

// ─── esbuild options ──────────────────────────────────────────────────────────

const options = {
  entryPoints: [entry],
  outfile,
  bundle:    true,
  format:    "cjs" as const,
  platform,
  external:  externalFlags,
  logLevel:  "info" as const,
}

// ─── Build or watch ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (isWatch) {
    const ctx = await context(options)
    await ctx.watch()
    console.log(`[agent-build] Watching ${entry}...`)
  } else {
    await build(options)
  }
}

main().catch((e) => {
  console.error("[agent-build]", e instanceof Error ? e.message : String(e))
  process.exit(1)
})
