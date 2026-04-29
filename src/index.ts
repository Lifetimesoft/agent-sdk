/**
 * @lifetimesoft/agent-sdk
 *
 * Lightweight SDK for building portable AI agents that run on the LifetimeSoft platform.
 */

export { defineAgent } from "./defineAgent"

export {
  getEnvString,
  getEnvNumber,
  getEnvInt,
  getEnvBoolean,
  hasEnv,
} from "./env"

export type {
  Agent,
  AgentDefinition,
  AgentConfig,
  SchedulerConfig,
  ChatMessage,
  Context,
  AiProvider,
  StorageProvider,
  QueueProvider,
  Logger,
  RunMeta,
  RuntimeConfig,
} from "./types"

// Testing utilities — also available via @lifetimesoft/agent-sdk/testing
export { createMockContext } from "./testing"
export type { MockContextOptions, MockStorageProvider, MockQueueProvider } from "./testing"
