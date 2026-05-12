/**
 * Example: Input + Config Agent
 *
 * Demonstrates how to use ctx.input and ctx.config together.
 * The agent reads a tone from config and applies it to the user's input.
 *
 * Expected input:  { text: string }
 * Expected config: { tone?: string }
 */
import { defineAgent, getEnvString } from "../src"

interface Input {
  text: string
}

export default defineAgent<Input, { text: string }>({
  async run(ctx) {
    const { input } = ctx

    if (!input?.text) {
      ctx.log.error("Missing input.text")
      return { text: "Error: input.text is required" }
    }

    // config fields beyond agent/version are typed as unknown — cast as needed
    const tone = (ctx.config.tone as string | undefined) ?? "neutral"
    const model = getEnvString(ctx.env, "ai_model", "gemini-2.0-flash")

    const reply = await ctx.ai.chat({
      messages: [
        { role: "system", content: `You reply in a ${tone} tone.` },
        { role: "user", content: input.text },
      ],
      model,
    })

    ctx.log.info(`Replied with tone="${tone}" model="${model}"`)

    return { text: reply }
  },
})
