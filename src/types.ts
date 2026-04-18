/**
 * A single message in a chat conversation.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

/**
 * AI provider interface for interacting with language models.
 */
export interface AiProvider {
  /**
   * Send a chat conversation and receive a text response.
   */
  chat(req: {
    messages: ChatMessage[]
    model?: string
    temperature?: number
  }): Promise<string>
}

/**
 * Key-value storage interface for persisting agent state.
 */
export interface StorageProvider {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * Queue interface for pushing messages/tasks.
 */
export interface QueueProvider {
  push<T = unknown>(data: T): Promise<void>
}

/**
 * Logger interface for structured agent logging.
 */
export interface Logger {
  info(...args: unknown[]): void
  error(...args: unknown[]): void
  debug(...args: unknown[]): void
}

/**
 * Runtime configuration injected by the platform into ctx.meta.
 * Contains URLs and settings the runtime needs — agent code never reads this.
 */
export interface RuntimeConfig {
  /** URL to POST heartbeat to every interval */
  heartbeat_url: string
  /** URL to POST when agent stops */
  stopped_url: string
  /** Heartbeat interval in milliseconds */
  heartbeat_interval_ms: number
}

/**
 * Metadata about the current agent run, injected by the runtime.
 */
export interface RunMeta {
  job_id?: string
  run_id: string
  timestamp: number
  /** Runtime configuration — used by the runtime wrapper, not by agent code */
  runtime?: RuntimeConfig
}

/**
 * Agent configuration, sourced from the platform or lifectl CLI.
 */
export interface AgentConfig {
  agent: string
  version: string
  interval?: number
  [key: string]: unknown
}

/**
 * The full context object injected into every agent run.
 */
export interface Context<TInput = unknown> {
  /** Arbitrary input payload passed to this run */
  input: TInput

  /** Agent configuration from the platform */
  config: AgentConfig

  /** Environment variables available to the agent */
  env: Record<string, string>

  /** AI provider abstraction */
  ai: AiProvider

  /** Key-value storage abstraction */
  storage: StorageProvider

  /** Queue abstraction */
  queue: QueueProvider

  /** Structured logger */
  log: Logger

  /** Runtime metadata for this run */
  meta: RunMeta
}

/**
 * The agent definition object passed to `defineAgent()`.
 */
export interface AgentDefinition<TInput = unknown, TOutput = unknown> {
  /**
   * Optional schema for validating the input payload.
   * The runtime will use this to validate input before calling `run()`.
   */
  inputSchema?: unknown

  /**
   * Optional schema for validating the agent config.
   * The runtime will use this to validate config before calling `run()`.
   */
  configSchema?: unknown

  /**
   * The main entry point for the agent.
   * Receives the runtime context and returns an optional output.
   */
  run(ctx: Context<TInput>): Promise<TOutput>
}

/**
 * The resolved agent object returned by `defineAgent()`.
 * This is what the `lifectl` runtime expects to receive.
 */
export interface Agent<TInput = unknown, TOutput = unknown> {
  run(ctx: Context<TInput>): Promise<TOutput>
  inputSchema?: unknown
  configSchema?: unknown
  __isAgent: true
}
