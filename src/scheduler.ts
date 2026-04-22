/**
 * @lifetimesoft/agent-sdk — scheduler
 *
 * Handles the agent run loop based on SchedulerConfig from the database.
 * Agent code never calls this directly — the runtime manages it.
 *
 * Supported modes:
 * - `none`     — run once, exit
 * - `interval` — repeat every N milliseconds
 * - `cron`     — repeat on a cron expression schedule (pure implementation, no deps)
 */

import type { SchedulerConfig } from "./types"

/**
 * Parse a cron expression into its 5 fields.
 * Supports: * / , - for each field.
 * Fields: minute hour day-of-month month day-of-week
 */
function parseCronField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>()

  for (const part of field.split(",")) {
    // */step or min-max/step
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/")
      const step = parseInt(stepStr, 10)
      if (isNaN(step) || step <= 0) throw new Error(`[scheduler] Invalid cron step: ${part}`)
      const [rangeMin, rangeMax] =
        range === "*"
          ? [min, max]
          : range.split("-").map((v) => parseInt(v, 10))
      for (let i = rangeMin; i <= rangeMax; i += step) result.add(i)
    } else if (part.includes("-")) {
      // min-max range
      const [lo, hi] = part.split("-").map((v) => parseInt(v, 10))
      for (let i = lo; i <= hi; i++) result.add(i)
    } else if (part === "*") {
      for (let i = min; i <= max; i++) result.add(i)
    } else {
      const n = parseInt(part, 10)
      if (isNaN(n)) throw new Error(`[scheduler] Invalid cron value: ${part}`)
      result.add(n)
    }
  }

  return result
}

interface ParsedCron {
  minutes: Set<number>
  hours: Set<number>
  daysOfMonth: Set<number>
  months: Set<number>
  daysOfWeek: Set<number>
}

function parseCron(expr: string): ParsedCron {
  const parts = expr.trim().split(/\s+/)
  
  // Support both 5-field and 6-field cron expressions
  // 5 fields: minute hour day-of-month month day-of-week
  // 6 fields: second minute hour day-of-month month day-of-week
  if (parts.length === 6) {
    // 6-field format: ignore seconds (first field), use remaining 5 fields
    return {
      minutes:     parseCronField(parts[1], 0, 59),
      hours:       parseCronField(parts[2], 0, 23),
      daysOfMonth: parseCronField(parts[3], 1, 31),
      months:      parseCronField(parts[4], 1, 12),
      daysOfWeek:  parseCronField(parts[5], 0, 6),
    }
  } else if (parts.length === 5) {
    // 5-field format: standard cron
    return {
      minutes:     parseCronField(parts[0], 0, 59),
      hours:       parseCronField(parts[1], 0, 23),
      daysOfMonth: parseCronField(parts[2], 1, 31),
      months:      parseCronField(parts[3], 1, 12),
      daysOfWeek:  parseCronField(parts[4], 0, 6),
    }
  } else {
    throw new Error(`[scheduler] Cron expression must have 5 or 6 fields, got ${parts.length}: "${expr}"`)
  }
}

/**
 * Returns the number of milliseconds until the next cron tick from `now`.
 * Searches up to 366 days ahead before giving up.
 */
function msUntilNextCron(cron: ParsedCron, now: Date): number {
  // advance to the next full minute
  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1)

  const limit = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000)

  while (next < limit) {
    const month = next.getMonth() + 1 // 1-12
    const dom   = next.getDate()       // 1-31
    const dow   = next.getDay()        // 0-6
    const hour  = next.getHours()
    const min   = next.getMinutes()

    if (
      cron.months.has(month) &&
      cron.daysOfMonth.has(dom) &&
      cron.daysOfWeek.has(dow) &&
      cron.hours.has(hour) &&
      cron.minutes.has(min)
    ) {
      return next.getTime() - now.getTime()
    }

    next.setMinutes(next.getMinutes() + 1)
  }

  throw new Error("[scheduler] Could not find next cron tick within 366 days")
}

/**
 * Run the agent function in a loop according to the scheduler config.
 *
 * - `none`     — calls `runOnce()` once and returns
 * - `interval` — calls `runOnce()` repeatedly every `value` ms (waits first, then runs)
 * - `cron`     — calls `runOnce()` at each matching cron tick (waits for first tick, then runs)
 *
 * The loop runs until `signal` is aborted (SIGTERM/SIGINT).
 */
export async function runWithScheduler(
  config: SchedulerConfig,
  runOnce: (jobId: string) => Promise<void>,
  signal: AbortSignal,
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void }
): Promise<void> {
  log.info(`[scheduler] Starting with config:`, JSON.stringify(config))
  
  if (config.type === "none") {
    log.info(`[scheduler] Type is "none" — waiting for manual trigger via WebSocket`)
    // wait indefinitely — agent is triggered manually via WebSocket message
    // the loop exits only when signal is aborted (SIGTERM/SIGINT)
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => {
        log.info(`[scheduler] Received abort signal, exiting`)
        resolve()
      }, { once: true })
    })
    return
  }

  if (config.type === "interval") {
    const ms = config.value
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new Error(`[scheduler] interval value must be a positive number, got: ${ms}`)
    }
    log.info(`[scheduler] Starting interval loop every ${ms}ms`)

    while (!signal.aborted) {
      log.info(`[scheduler] Waiting ${ms}ms until next run`)
      await sleep(ms, signal)
      if (signal.aborted) break

      const jobId = genJobId()
      log.info(`[scheduler] start job ${jobId}`)
      try {
        await runOnce(jobId)
      } catch (e) {
        log.error("[scheduler] agent.run() threw during interval loop:", e)
      }
      log.info(`[scheduler] end job ${jobId}`)
      log.info("----------")
    }
    return
  }

  if (config.type === "cron") {
    const parsed = parseCron(config.value)
    log.info(`[scheduler] Starting cron loop: "${config.value}"`)

    while (!signal.aborted) {
      const delay = msUntilNextCron(parsed, new Date())
      log.info(`[scheduler] Next cron tick in ${Math.round(delay / 1000)}s`)
      await sleep(delay, signal)
      if (signal.aborted) break

      const jobId = genJobId()
      log.info(`[scheduler] start job ${jobId}`)
      try {
        await runOnce(jobId)
      } catch (e) {
        log.error("[scheduler] agent.run() threw during cron loop:", e)
      }
      log.info(`[scheduler] end job ${jobId}`)
      log.info("----------")
    }
    return
  }

  // exhaustive check
  const _: never = config
  throw new Error(`[scheduler] Unknown scheduler type: ${(_ as SchedulerConfig).type}`)
}

/** Generate a short random job ID (6 hex chars) */
function genJobId(): string {
  return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")
}

/**
 * Sleep for `ms` milliseconds, resolving early if `signal` is aborted.
 */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) { resolve(); return }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve() }, { once: true })
  })
}
