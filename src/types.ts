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

    /**
     * Generate an image from a text prompt.
     * Returns a public URL of the generated image.
     */
    image(req: {
        prompt: string
        model?: string
        size?: string       // e.g. "1024x1024", "1024x1792" (portrait 9:16)
        quality?: string    // e.g. "standard", "hd"
        style?: string      // e.g. "vivid", "natural" (OpenAI only)
        n?: number          // number of images (default: 1)
        image_url?: string  // reference image URL — passed to n8n for img2img style generation
    }): Promise<string>     // returns public image URL

    /**
     * Generate a timelapse video from a before/after image pair.
     * Returns a public URL of the generated video.
     * Uses the same async callback pattern as image generation.
     */
    video(req: {
        before_url: string     // URL of the "before" image
        after_url: string      // URL of the "after" image
        prompt?: string        // optional guidance for style, transition, or scene description
        aspect_ratio?: string  // e.g. "9:16" (portrait), "16:9" (landscape), "1:1" (default: "9:16")
        duration?: number      // seconds (default: 5)
    }): Promise<string>     // returns public video URL
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
    /** WebSocket URL for heartbeat connection */
    ws_url: string
    /** URL to POST when agent stops */
    stopped_url: string
    /** Heartbeat interval in milliseconds */
    heartbeat_interval_ms: number
    /** AI chat endpoint URL (optional, defaults to platform endpoint) */
    ai_url?: string
}

/**
 * Metadata about the current agent run, injected by the runtime.
 */
export interface RunMeta {
    run_id: string
    timestamp: number
    /** Runtime configuration — used by the runtime wrapper, not by agent code */
    runtime?: RuntimeConfig
}

/**
 * Scheduler configuration for the agent, sourced from the database via the platform.
 * The agent never configures this directly — it is injected into ctx.config.scheduler.
 *
 * - `none`     — run once, no repeat
 * - `interval` — repeat every `value` milliseconds
 * - `cron`     — repeat on a cron expression schedule
 */
export type SchedulerConfig =
    | { type: "none" }
    | { type: "interval"; value: number }
    | { type: "cron"; value: string }

/**
 * Agent configuration, sourced from the platform or lifectl CLI.
 */
export interface AgentConfig {
    agent: string
    version: string
    /** Scheduler config injected from the database — agent code reads this via ctx.config.scheduler */
    scheduler?: SchedulerConfig
    [key: string]: unknown
}

/**
 * Reference to an external input source, resolved by the runtime before agent.run().
 * Agent code never sees this — it only receives the resolved value via ctx.input.
 *
 * Designed to be extensible: future input sources (api, file, queue, etc.)
 * can be added here without changing agent code.
 *
 * Stored inside config.input.input_ref in the platform database.
 */
export type InputRef =
    | { type: "dataset"; value: string }   // dataset id — resolved to array of dataset items
    // future: | { type: "api"; url: string }
    // future: | { type: "file"; path: string }

/**
 * The full context object injected into every agent run.
 */
export interface Context<TInput = unknown> {
    /** Arbitrary input payload passed to this run */
    input: TInput

    /** Agent configuration from the platform */
    config: AgentConfig

    /** Environment variables available to the agent */
    env: Record<string, unknown>

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
