/**
 * Example: Storage Counter Agent
 *
 * Demonstrates persistent state using ctx.storage.
 * Increments a counter on every run and logs the total.
 *
 * Works with both the Node.js runtime (lifectl) and the Chrome Extension runtime.
 * In Chrome, storage is backed by chrome.storage.local instead of the platform API.
 */
import { defineAgent } from "../src"

export default defineAgent<unknown, { count: number }>({
  async run(ctx) {
    const key = "run_count"
    const current = await ctx.storage.get<number>(key)
    const count = (current ?? 0) + 1

    await ctx.storage.set(key, count)

    ctx.log.info(`This agent has run ${count} time(s).`)

    return { count }
  },
})
