import type {
  AiProvider,
  AgentConfig,
  Context,
  Logger,
  QueueProvider,
  RunMeta,
  SchedulerConfig,
  StorageProvider,
} from "./types"

/**
 * Options for creating a mock context in tests.
 */
export interface MockContextOptions<TInput = unknown> {
  input?: TInput
  config?: Partial<AgentConfig>
  env?: Record<string, unknown>
  ai?: Partial<AiProvider>
  storage?: Partial<StorageProvider>
  queue?: Partial<QueueProvider>
  log?: Partial<Logger>
  meta?: Partial<RunMeta>
}

/**
 * Extended storage provider with inspection helpers for testing.
 */
export interface MockStorageProvider extends StorageProvider {
  /** Returns a snapshot of all stored key-value pairs. */
  _getStore(): Record<string, unknown>
}

/**
 * Extended queue provider with inspection helpers for testing.
 */
export interface MockQueueProvider extends QueueProvider {
  /** Returns all messages that have been pushed to the queue. */
  _getMessages(): unknown[]
}

/**
 * In-memory storage implementation for testing.
 * Supports TTL — expired entries are evicted on read.
 */
function createMockStorage(): MockStorageProvider {
  const _store = new Map<string, unknown>()
  const _expiry = new Map<string, number>()

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const exp = _expiry.get(key)
      if (exp !== undefined && Date.now() > exp) {
        _store.delete(key)
        _expiry.delete(key)
        return null
      }
      return (_store.get(key) as T) ?? null
    },
    async set<T = unknown>(key: string, value: T, opts?: { ttl?: number }): Promise<void> {
      _store.set(key, value)
      if (opts?.ttl !== undefined) {
        _expiry.set(key, Date.now() + opts.ttl * 1000)
      } else {
        _expiry.delete(key)
      }
    },
    async delete(key: string): Promise<void> {
      _store.delete(key)
      _expiry.delete(key)
    },
    _getStore(): Record<string, unknown> {
      return Object.fromEntries(_store)
    },
  }
}

/**
 * In-memory queue implementation for testing.
 */
function createMockQueue(): MockQueueProvider {
  const _messages: unknown[] = []
  return {
    async push<T = unknown>(data: T): Promise<void> {
      _messages.push(data)
    },
    _getMessages(): unknown[] {
      return [..._messages]
    },
  }
}

/**
 * Create a mock context for testing agents locally without the lifectl runtime.
 *
 * The returned `ctx.storage` and `ctx.queue` include inspection helpers:
 * - `ctx.storage._getStore()` — returns all stored key-value pairs
 * - `ctx.queue._getMessages()` — returns all pushed messages
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
): Context<TInput> & { storage: MockStorageProvider; queue: MockQueueProvider } {
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
    scheduler: { type: "none" } as SchedulerConfig,
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
    image: async () => {
      throw new Error(
        "[agent-sdk] ctx.ai.image() is not implemented in mock context. " +
          "Pass a custom `ai` option to createMockContext()."
      )
    },
    ...ai,
  }

  const mockStorage = createMockStorage()
  const mockQueue = createMockQueue()

  return {
    input,
    config: defaultConfig,
    env,
    ai: defaultAi,
    storage: { ...mockStorage, ...storage } as MockStorageProvider,
    queue: { ...mockQueue, ...queue } as MockQueueProvider,
    log: defaultLog,
    meta: defaultMeta,
  }
}
