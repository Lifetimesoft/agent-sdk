# Migration Guide: env type change from Record<string, string> to Record<string, unknown>

## What Changed

The `env` property in the `Context` interface has been changed from `Record<string, string>` to `Record<string, unknown>` to support environment variables that may contain non-string values.

## Breaking Changes

### Before (v0.0.8 and earlier)
```typescript
// Environment variables were typed as strings
ctx.env.API_KEY // string | undefined
ctx.env.PORT // string | undefined
```

### After (v0.0.9+)
```typescript
// Environment variables are now typed as unknown
ctx.env.API_KEY // unknown
ctx.env.PORT // unknown
```

## Migration Steps

### Option 1: Use Type Assertions (Quick Fix)
```typescript
// Before
const port = parseInt(ctx.env.PORT || '3000')
const apiKey = ctx.env.API_KEY || 'default'

// After
const port = parseInt((ctx.env.PORT as string) || '3000')
const apiKey = (ctx.env.API_KEY as string) || 'default'
```

### Option 2: Use New Utility Functions (Recommended)
```typescript
import { getEnvString, getEnvInt, getEnvBoolean } from "@lifetimesoft/agent-sdk"

// Safe string access with defaults
const apiKey = getEnvString(ctx.env, 'API_KEY', 'default')
const host = getEnvString(ctx.env, 'HOST', 'localhost')

// Safe integer parsing with defaults
const port = getEnvInt(ctx.env, 'PORT', 3000)
const timeout = getEnvInt(ctx.env, 'TIMEOUT', 5000)

// Boolean parsing (treats 'true', '1', 'yes', 'on' as true)
const debugMode = getEnvBoolean(ctx.env, 'DEBUG', false)
const enableFeature = getEnvBoolean(ctx.env, 'ENABLE_FEATURE', true)

// Check if environment variable exists
import { hasEnv } from "@lifetimesoft/agent-sdk"
if (hasEnv(ctx.env, 'OPTIONAL_CONFIG')) {
  // Handle optional configuration
}
```

## New Utility Functions

### `getEnvString(env, key, defaultValue?)`
- Returns environment variable as string
- Converts non-string values to strings
- Returns `defaultValue` if key is missing or null

### `getEnvInt(env, key, defaultValue?)`
- Parses environment variable as integer using `parseInt()`
- Returns `defaultValue` if parsing fails or key is missing

### `getEnvNumber(env, key, defaultValue?)`
- Parses environment variable as number using `Number()`
- Returns `defaultValue` if parsing fails or key is missing

### `getEnvBoolean(env, key, defaultValue?)`
- Parses environment variable as boolean
- Treats `'true'`, `'1'`, `'yes'`, `'on'` as `true` (case insensitive)
- Everything else as `false`
- Returns `defaultValue` if key is missing

### `hasEnv(env, key)`
- Returns `true` if environment variable exists and is not null/empty
- Returns `false` otherwise

## Example Migration

### Before
```typescript
import { defineAgent } from "@lifetimesoft/agent-sdk"

export default defineAgent({
  async run(ctx) {
    // Old way - direct access assuming strings
    const redisHost = ctx.env.REDIS_HOST || 'localhost'
    const redisPort = parseInt(ctx.env.REDIS_PORT || '6379')
    const enableWorker = ctx.env.WORKER_ENABLED !== 'false'
    
    // ... rest of code
  }
})
```

### After
```typescript
import { defineAgent, getEnvString, getEnvInt, getEnvBoolean } from "@lifetimesoft/agent-sdk"

export default defineAgent({
  async run(ctx) {
    // New way - safe access with utility functions
    const redisHost = getEnvString(ctx.env, 'REDIS_HOST', 'localhost')
    const redisPort = getEnvInt(ctx.env, 'REDIS_PORT', 6379)
    const enableWorker = getEnvBoolean(ctx.env, 'WORKER_ENABLED', true)
    
    // ... rest of code
  }
})
```

## Benefits of the New Approach

1. **Type Safety**: Explicit handling of unknown types prevents runtime errors
2. **Better Defaults**: Built-in default value support
3. **Consistent Parsing**: Standardized boolean and number parsing
4. **Runtime Safety**: Graceful handling of missing or invalid values
5. **Future Proof**: Supports non-string environment values