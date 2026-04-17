import { describe, it, expect, vi } from "vitest"
import { defineAgent } from "../src/defineAgent"
import { createMockContext } from "../src/testing"

describe("defineAgent()", () => {
  it("returns an agent object with __isAgent flag", () => {
    const agent = defineAgent({ async run() {} })
    expect(agent.__isAgent).toBe(true)
  })

  it("returns an agent with a run function", () => {
    const agent = defineAgent({ async run() {} })
    expect(typeof agent.run).toBe("function")
  })

  it("throws if run is not a function", () => {
    expect(() =>
      // @ts-expect-error intentional bad input
      defineAgent({ run: "not-a-function" })
    ).toThrow("[agent-sdk] defineAgent() requires a `run` function")
  })

  it("calls run with the provided context", async () => {
    const runFn = vi.fn(async () => ({ ok: true }))
    const agent = defineAgent({ run: runFn })
    const ctx = createMockContext()

    await agent.run(ctx)

    expect(runFn).toHaveBeenCalledOnce()
    expect(runFn).toHaveBeenCalledWith(ctx)
  })

  it("returns the value from run()", async () => {
    const agent = defineAgent({
      async run() {
        return { text: "hello" }
      },
    })
    const ctx = createMockContext()
    const result = await agent.run(ctx)
    expect(result).toEqual({ text: "hello" })
  })

  it("propagates errors thrown inside run()", async () => {
    const agent = defineAgent({
      async run() {
        throw new Error("agent error")
      },
    })
    const ctx = createMockContext()
    await expect(agent.run(ctx)).rejects.toThrow("agent error")
  })

  it("preserves inputSchema on the returned agent", () => {
    const schema = { type: "object", properties: { text: { type: "string" } } }
    const agent = defineAgent({ inputSchema: schema, async run() {} })
    expect(agent.inputSchema).toBe(schema)
  })

  it("preserves configSchema on the returned agent", () => {
    const schema = { type: "object", properties: { tone: { type: "string" } } }
    const agent = defineAgent({ configSchema: schema, async run() {} })
    expect(agent.configSchema).toBe(schema)
  })

  it("inputSchema and configSchema are undefined when not provided", () => {
    const agent = defineAgent({ async run() {} })
    expect(agent.inputSchema).toBeUndefined()
    expect(agent.configSchema).toBeUndefined()
  })
})
