# Release Notes: v0.0.12

## 📋 Environment Variable Schema Update

Version 0.0.12 introduces a new structured format for environment variables in `agent.json`.

---

## 🎯 What Changed

### Old Format (v0.0.11 and earlier)

```json
{
  "name": "my-agent",
  "version": "1.0.0",
  "env": {
    "mode": "normal",
    "enable_feature": true,
    "max_tasks": 10
  }
}
```

### New Format (v0.0.12)

```json
{
  "name": "my-agent",
  "version": "1.0.0",
  "env": [
    {
      "name": "mode",
      "type": "string",
      "label": "Operation Mode",
      "description": "Agent operation mode",
      "default": "normal",
      "required": false
    },
    {
      "name": "enable_feature",
      "type": "boolean",
      "label": "Enable Feature",
      "description": "Enable or disable the feature",
      "default": true,
      "required": false
    },
    {
      "name": "max_tasks",
      "type": "number",
      "label": "Max Tasks",
      "description": "Maximum number of tasks to process",
      "default": 10,
      "required": false
    }
  ]
}
```

---

## ✨ Benefits

### 1. **Type Safety**
Platform validates values based on declared type:
- `"string"` - text values
- `"boolean"` - true/false
- `"number"` - numeric values
- `"password"` - sensitive values (hidden in UI)

### 2. **Automatic UI Generation**
Web UI automatically generates appropriate form fields:
- Text inputs for strings
- Checkboxes for booleans
- Number inputs for numbers
- Password inputs for sensitive data

### 3. **Self-Documenting**
Each variable includes:
- **label**: Human-readable name shown in UI
- **description**: Detailed explanation of the variable's purpose
- **required**: Whether the variable must be set

### 4. **Better User Experience**
- Users see helpful labels and descriptions
- Required fields are clearly marked
- Password fields are automatically hidden
- Default values are pre-filled

---

## 🔄 Migration Guide

### Step 1: Update `agent.json`

Convert your env object to an array of schema objects:

**Before:**
```json
{
  "env": {
    "api_key": "default-key",
    "timeout": 30,
    "debug": false
  }
}
```

**After:**
```json
{
  "env": [
    {
      "name": "api_key",
      "type": "password",
      "label": "API Key",
      "description": "API authentication key",
      "required": true
    },
    {
      "name": "timeout",
      "type": "number",
      "label": "Timeout (seconds)",
      "description": "Request timeout in seconds",
      "default": 30,
      "required": false
    },
    {
      "name": "debug",
      "type": "boolean",
      "label": "Debug Mode",
      "description": "Enable debug logging",
      "default": false,
      "required": false
    }
  ]
}
```

### Step 2: Update Agent SDK

```bash
npm install @lifetimesoft/agent-sdk@0.0.12
```

### Step 3: Rebuild and Push

```bash
npm run build
lifectl ai agent push
```

---

## 📝 Schema Reference

### Environment Variable Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✅ Yes | Variable name (use lowercase_snake_case) |
| `type` | string | ✅ Yes | Data type: `"string"`, `"boolean"`, `"number"`, or `"password"` |
| `label` | string | ✅ Yes | Human-readable label for Web UI |
| `description` | string | ✅ Yes | Detailed description of the variable |
| `default` | any | ❌ No | Default value (optional) |
| `required` | boolean | ✅ Yes | Whether the variable is required |

### Type Mapping

| Type | UI Input | Example Value |
|------|----------|---------------|
| `"string"` | Text input | `"production"` |
| `"boolean"` | Checkbox | `true` or `false` |
| `"number"` | Number input | `42` |
| `"password"` | Password input | `"secret123"` (hidden) |

---

## 🎯 Complete Example

```json
{
  "name": "my-agent",
  "version": "1.0.0",
  "description": "My awesome agent",
  "runtime": "node20",
  "main": "dist/index.js",
  "public": false,
  "input": {
    "type": "none"
  },
  "output": {
    "type": "none"
  },
  "capabilities": {
    "ai": {
      "required": true,
      "features": ["chat"]
    }
  },
  "env": [
    {
      "name": "mode",
      "type": "string",
      "label": "Operation Mode",
      "description": "Agent operation mode: development, staging, or production",
      "default": "development",
      "required": false
    },
    {
      "name": "enable_logging",
      "type": "boolean",
      "label": "Enable Logging",
      "description": "Enable or disable detailed logging",
      "default": true,
      "required": false
    },
    {
      "name": "max_retries",
      "type": "number",
      "label": "Max Retries",
      "description": "Maximum number of retry attempts for failed operations",
      "default": 3,
      "required": false
    },
    {
      "name": "api_key",
      "type": "password",
      "label": "API Key",
      "description": "API authentication key (sensitive)",
      "required": true
    }
  ],
  "keywords": ["example", "demo"]
}
```

---

## ⚠️ Breaking Changes

**None!** This is a documentation and format update. The agent runtime behavior remains the same:

- ✅ Agent runtime still receives env as `Record<string, unknown>` via `ctx.env`
- ✅ Use the same utility functions: `getEnvString()`, `getEnvInt()`, `getEnvBoolean()`
- ✅ No code changes needed in your agent implementation

The only change is in `agent.json` format for better platform integration.

---

## 🚀 Next Steps

1. Update your `agent.json` to use the new env schema format
2. Update to `@lifetimesoft/agent-sdk@0.0.12`
3. Rebuild and push your agent
4. Enjoy automatic UI generation and better user experience!

---

## 📚 Resources

- [Full Changelog](CHANGELOG.md)
- [README](README.md)
- [Migration Guide](MIGRATION.md)
- [Example agent.json](examples/agent.json)

---

## 💬 Questions?

If you have any questions or issues, please:
- Open an issue on GitHub
- Contact support at admin@lifetimesoft.com

Happy coding! 🎉
