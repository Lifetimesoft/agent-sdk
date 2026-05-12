/**
 * Example: Chrome Extension Agent
 *
 * A simple agent that summarises the current page's text.
 * Receives the page content via ctx.input, sent from the popup or content script.
 *
 * This agent is portable — the same file works with the Node.js runtime (lifectl)
 * and the Chrome Extension runtime without any changes.
 */
import { defineAgent, getEnvString } from "../../src"

interface Input {
  /** Raw text content of the page to summarise */
  pageText: string
  /** URL of the page (for logging) */
  url?: string
}

interface Output {
  summary: string
  wordCount: number
}

export default defineAgent<Input, Output>({
  async run(ctx) {
    const { pageText, url } = ctx.input

    if (!pageText?.trim()) {
      ctx.log.error("No page text provided")
      return { summary: "No content to summarise.", wordCount: 0 }
    }

    const model = getEnvString(ctx.env, "ai_model", "gemini-2.0-flash")
    const maxWords = 100

    ctx.log.info(`Summarising page: ${url ?? "(unknown)"}`)

    const summary = await ctx.ai.chat({
      messages: [
        {
          role: "system",
          content: `You are a concise summariser. Summarise the given text in at most ${maxWords} words. Return only the summary, no preamble.`,
        },
        {
          role: "user",
          content: pageText.slice(0, 8000), // trim to avoid token limits
        },
      ],
      model,
      temperature: 0.3,
    })

    // persist the last summary so the popup can read it without re-running
    await ctx.storage.set("last_summary", { summary, url, timestamp: Date.now() })

    ctx.log.info("Summary complete:", summary.slice(0, 80) + "...")

    return {
      summary,
      wordCount: summary.split(/\s+/).length,
    }
  },
})
