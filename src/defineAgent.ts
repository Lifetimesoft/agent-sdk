import type { Agent, AgentDefinition } from "./types"

/**
 * Define an AI agent with a standard lifecycle interface.
 *
 * The returned object is recognized by the `lifectl` runtime and will have
 * its `run()` method called on each scheduled or triggered execution.
 *
 * @example
 * ```ts
 * import { defineAgent } from "@lifetimesoft/agent-sdk"
 *
 * export default defineAgent({
 *   async run(ctx) {
 *     const reply = await ctx.ai.chat({ prompt: "Say hello to the world" })
 *     ctx.log.info("AI reply:", reply)
 *     return { text: reply }
 *   }
 * })
 * ```
 */
export function defineAgent<TInput = unknown, TOutput = unknown>(
  definition: AgentDefinition<TInput, TOutput>
): Agent<TInput, TOutput> {
  if (typeof definition.run !== "function") {
    throw new Error(
      "[agent-sdk] defineAgent() requires a `run` function in the definition object."
    )
  }

  return {
    run: definition.run,
    __isAgent: true,
  }
}
