/**
 * Example: Hello World Agent
 *
 * The simplest possible agent — calls AI and returns the response.
 *
 * Run with lifectl:
 *   lifectl run examples/hello-world.ts
 */
import { defineAgent } from "../src"

export default defineAgent({
  async run(ctx) {
    const reply = await ctx.ai.chat({
      prompt: "Say hello to the world in one sentence.",
    })

    ctx.log.info("AI reply:", reply)

    return { text: reply }
  },
})
