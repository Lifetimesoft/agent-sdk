import type {
  AiProvider,
  AgentConfig,
  Context,
  Logger,
  QueueProvider,
  RunMeta,
  StorageProvider,
} from "./types"

/**
 * Options for creating a mock context in tests.
 */
export interface MockContextOptions<TInput = unknown> {
  input?: TInput
  config?: Partial<AgentConfig>
  env?: Record<string, string>
  ai?: Partial<AiProvider>
  storage?: Partial<StorageProvider>
  queue?: Partial<QueueProvider>
  log?: Partial<Logger>
  meta?: Partial<RunMeta>
}

/**
 * In-memory storage implementation for testing.
 */
function createMockStorage(): StorageProvider {
  const _store = new Map<string, unknown>()
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      return (_store.get(key) as T) ?? null
    },
    async set<T = unknown>(key: string, value: T): Promise<void> {
      _store.set(key, value)
    },
    async delete(key: string): Promise<void> {
      _store.delete(key)
    },
  }
}

/**
 * In-memory queue implementation for testing.
 */
function createMockQueue(): QueueProvider {
  const _messages: unknown[] = []
  return {
    async push<T = unknown>(data: T): Promise<void> {
      _messages.push(data)
    },
  }
}

/**
 * Create a mock context for testing agents locally without the lifectl runtime.
 *
 * @example
 * ```ts
 * import { createMockContext } from "@lifetimesoft/agent-sdk/testing"
 * import myAgent from "./my-agent"
 *
 * const ctx = createMockContext({
 *   input: { text: "hello" },
 *   ai: {
 *     chat: async () => "mocked AI response"
 *   }
 * })
 *
 * const result = await myAgent.run(ctx)
 * console.log(result)
 * ```
 */
export function createMockContext<TInput = unknown>(
  options: MockContextOptions<TInput> = {}
): Context<TInput> {
  const {
    input = undefined as unknown as TInput,
    config,
    env = {},
    ai,
    storage,
    queue,
    log,
    meta,
  } = options

  const defaultConfig: AgentConfig = {
    agent: "mock-agent",
    version: "0.0.0",
    ...config,
  }

  const defaultMeta: RunMeta = {
    run_id: `mock-run-${Date.now()}`,
    timestamp: Date.now(),
    ...meta,
  }

  const defaultLog: Logger = {
    info: (...args: unknown[]) => console.log("[agent:info]", ...args),
    error: (...args: unknown[]) => console.error("[agent:error]", ...args),
    debug: (...args: unknown[]) => console.debug("[agent:debug]", ...args),
    ...log,
  }

  const defaultAi: AiProvider = {
    chat: async () => {
      throw new Error(
        "[agent-sdk] ctx.ai.chat() is not implemented in mock context. " +
          "Pass a custom `ai` option to createMockContext()."
      )
    },
    ...ai,
  }

  return {
    input,
    config: defaultConfig,
    env,
    ai: defaultAi,
    storage: { ...createMockStorage(), ...storage },
    queue: { ...createMockQueue(), ...queue },
    log: defaultLog,
    meta: defaultMeta,
  }
}
