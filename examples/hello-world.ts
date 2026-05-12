/**
 * Example: Hello World Agent
 *
 * The simplest possible agent — calls AI and returns the response.
 * Works with both the Node.js runtime (lifectl) and the Chrome Extension runtime.
 *
 * Run with lifectl:
 *   lifectl ai agent run
 */
import { defineAgent } from "../src"

export default defineAgent<unknown, { text: string }>({
  async run(ctx) {
    const reply = await ctx.ai.chat({
      messages: [{ role: "user", content: "Say hello to the world in one sentence." }],
      model: "gemini-2.0-flash",
    })

    ctx.log.info("AI reply:", reply)

    return { text: reply }
  },
})
