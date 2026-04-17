/**
 * Example: Input + Config Agent
 *
 * Demonstrates how to use ctx.input and ctx.config together.
 * The agent reads a tone from config and applies it to the user's input.
 *
 * Expected input:  { text: string }
 * Expected config: { tone: string }
 */
import { defineAgent } from "../src"

interface Input {
  text: string
}

interface Config {
  agent: string
  version: string
  tone: string
}

export default defineAgent<Input>({
  async run(ctx) {
    const { input } = ctx
    const config = ctx.config as Config

    if (!input?.text) {
      ctx.log.error("Missing input.text")
      return { error: "input.text is required" }
    }

    const tone = config.tone ?? "neutral"

    const reply = await ctx.ai.chat({
      messages: [
        { role: "system", content: `You reply in a ${tone} tone.` },
        { role: "user", content: input.text },
      ],
    })

    ctx.log.info("Replied with tone:", config.tone)

    return { text: reply }
  },
})
