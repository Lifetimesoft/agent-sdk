# Changelog

All notable changes to `@lifetimesoft/agent-sdk` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.0.1] - 2026-04-18

### Added

- `defineAgent()` — core API for wrapping agent definitions with runtime validation
- Full TypeScript type definitions: `Context`, `AiProvider`, `StorageProvider`, `QueueProvider`, `Logger`, `RunMeta`, `AgentConfig`
- Generic type support for `TInput` and `TOutput` on `defineAgent()`, `Context`, `Agent`, and `AgentDefinition`
- `createMockContext()` in `@lifetimesoft/agent-sdk/testing` for local development and unit testing
- In-memory mock implementations for `StorageProvider` and `QueueProvider`
- Dual CJS + ESM build output via `tsup`
- TypeScript declaration files (`.d.ts`) included in build
- Example agents: `hello-world`, `input-and-config`, `storage-counter`
- Unit tests with Vitest
- ESLint config with `typescript-eslint`
- GitHub Actions CI workflow (typecheck, lint, test)
