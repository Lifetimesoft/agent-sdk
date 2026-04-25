/**
 * Example: Environment Variable Usage
 *
 * Demonstrates how to safely access environment variables with the new
 * Record<string, unknown> type using utility functions.
 */
import { defineAgent, getEnvString, getEnvInt, getEnvBoolean, hasEnv } from "../src"

export default defineAgent({
  async run(ctx) {
    ctx.log.info("Environment Variable Usage Example")

    // String values with defaults
    const apiKey = getEnvString(ctx.env, 'API_KEY', 'default-key')
    const host = getEnvString(ctx.env, 'HOST', 'localhost')
    
    ctx.log.info(`API Key: ${apiKey}`)
    ctx.log.info(`Host: ${host}`)

    // Integer values with defaults
    const port = getEnvInt(ctx.env, 'PORT', 3000)
    const timeout = getEnvInt(ctx.env, 'TIMEOUT_MS', 5000)
    
    ctx.log.info(`Port: ${port}`)
    ctx.log.info(`Timeout: ${timeout}ms`)

    // Boolean values (supports 'true', '1', 'yes', 'on' as true)
    const debugMode = getEnvBoolean(ctx.env, 'DEBUG', false)
    const enableFeature = getEnvBoolean(ctx.env, 'ENABLE_FEATURE', true)
    
    ctx.log.info(`Debug mode: ${debugMode}`)
    ctx.log.info(`Feature enabled: ${enableFeature}`)

    // Check if optional environment variables exist
    if (hasEnv(ctx.env, 'OPTIONAL_CONFIG')) {
      const optionalValue = getEnvString(ctx.env, 'OPTIONAL_CONFIG')
      ctx.log.info(`Optional config found: ${optionalValue}`)
    } else {
      ctx.log.info("Optional config not provided")
    }

    // Example of configuration object
    const config = {
      database: {
        host: getEnvString(ctx.env, 'DB_HOST', 'localhost'),
        port: getEnvInt(ctx.env, 'DB_PORT', 5432),
        ssl: getEnvBoolean(ctx.env, 'DB_SSL', false),
      },
      redis: {
        host: getEnvString(ctx.env, 'REDIS_HOST', 'localhost'),
        port: getEnvInt(ctx.env, 'REDIS_PORT', 6379),
        password: getEnvString(ctx.env, 'REDIS_PASSWORD'), // undefined if not set
      },
      features: {
        enableWorker: getEnvBoolean(ctx.env, 'WORKER_ENABLED', true),
        enableCron: getEnvBoolean(ctx.env, 'CRON_ENABLED', false),
      }
    }

    ctx.log.info("Configuration:", JSON.stringify(config, null, 2))

    return { 
      message: "Environment variables processed successfully",
      config 
    }
  },
})