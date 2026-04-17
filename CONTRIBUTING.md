# Contributing to @lifetimesoft/agent-sdk

Thanks for your interest in contributing! Here's how to get started.

---

## Development Setup

```bash
# Clone the repo
git clone https://github.com/Lifetimesoft/agent-sdk.git
cd agent-sdk

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Lint
npm run lint
```

---

## Project Structure

```
src/
  index.ts        ← public entry point
  defineAgent.ts  ← defineAgent() implementation
  types.ts        ← all TypeScript interfaces
  testing.ts      ← createMockContext() for tests
tests/
  defineAgent.test.ts
  createMockContext.test.ts
examples/
  hello-world.ts
  input-and-config.ts
  storage-counter.ts
```

---

## Guidelines

- Keep the SDK minimal — avoid adding runtime dependencies
- All public APIs must be fully typed
- Add or update tests for any changed behavior
- Run `npm run typecheck && npm run lint && npm test` before submitting a PR
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages

---

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Ensure all checks pass (`typecheck`, `lint`, `test`)
4. Open a PR with a clear description of what changed and why
5. A maintainer will review and merge

---

## Reporting Issues

Please use [GitHub Issues](https://github.com/Lifetimesoft/agent-sdk/issues) to report bugs or request features.
