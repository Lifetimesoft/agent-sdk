import { describe, it, expect, vi } from "vitest"
import { createMockContext } from "../src/testing"

describe("createMockContext()", () => {
  it("returns a context with default values", () => {
    const ctx = createMockContext()
    expect(ctx.config.agent).toBe("mock-agent")
    expect(ctx.config.version).toBe("0.0.0")
    expect(ctx.env).toEqual({})
    expect(ctx.meta.run_id).toMatch(/^mock-run-/)
    expect(typeof ctx.meta.timestamp).toBe("number")
  })

  it("merges custom config", () => {
    const ctx = createMockContext({
      config: { agent: "my-agent", version: "1.0.0", tone: "friendly" },
    })
    expect(ctx.config.agent).toBe("my-agent")
    expect(ctx.config.version).toBe("1.0.0")
    expect(ctx.config.tone).toBe("friendly")
  })

  it("passes input through", () => {
    const ctx = createMockContext({ input: { text: "hello" } })
    expect(ctx.input).toEqual({ text: "hello" })
  })

  it("passes env through", () => {
    const ctx = createMockContext({ env: { API_KEY: "secret" } })
    expect(ctx.env.API_KEY).toBe("secret")
  })

  it("storage: get returns null for missing keys", async () => {
    const ctx = createMockContext()
    const val = await ctx.storage.get("missing")
    expect(val).toBeNull()
  })

  it("storage: set and get round-trip", async () => {
    const ctx = createMockContext()
    await ctx.storage.set("key", { count: 42 })
    const val = await ctx.storage.get<{ count: number }>("key")
    expect(val).toEqual({ count: 42 })
  })

  it("storage: delete removes a key", async () => {
    const ctx = createMockContext()
    await ctx.storage.set("key", "value")
    await ctx.storage.delete("key")
    const val = await ctx.storage.get("key")
    expect(val).toBeNull()
  })

  it("queue: push stores messages", async () => {
    const pushed: unknown[] = []
    const ctx = createMockContext({
      queue: { push: async (data) => { pushed.push(data) } },
    })
    await ctx.queue.push({ event: "test" })
    expect(pushed).toEqual([{ event: "test" }])
  })

  it("log: uses console by default", () => {
    const infoSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext()
    ctx.log.info("hello")
    expect(infoSpy).toHaveBeenCalledWith("[agent:info]", "hello")
    infoSpy.mockRestore()
  })

  it("log: can be overridden", () => {
    const mockInfo = vi.fn()
    const ctx = createMockContext({ log: { info: mockInfo } })
    ctx.log.info("test message")
    expect(mockInfo).toHaveBeenCalledWith("test message")
  })

  it("ai.chat: throws by default (not implemented)", async () => {
    const ctx = createMockContext()
    await expect(ctx.ai.chat({ prompt: "hello" })).rejects.toThrow(
      "ctx.ai.chat() is not implemented in mock context"
    )
  })

  it("ai.chat: can be overridden with mock", async () => {
    const ctx = createMockContext({
      ai: { chat: async () => "mocked response" },
    })
    const result = await ctx.ai.chat({ prompt: "hello" })
    expect(result).toBe("mocked response")
  })

  it("meta: can be partially overridden", () => {
    const ctx = createMockContext({
      meta: { run_id: "custom-run-id", job_id: "job-123" },
    })
    expect(ctx.meta.run_id).toBe("custom-run-id")
    expect(ctx.meta.job_id).toBe("job-123")
    expect(typeof ctx.meta.timestamp).toBe("number")
  })
})
