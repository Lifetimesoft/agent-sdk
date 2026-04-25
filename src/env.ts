/**
 * Utility functions for safely accessing environment variables from ctx.env
 * when env is typed as Record<string, unknown>
 */

/**
 * Get an environment variable as a string with optional default value
 */
export function getEnvString(env: Record<string, unknown>, key: string): string | undefined
export function getEnvString(env: Record<string, unknown>, key: string, defaultValue: string): string
export function getEnvString(env: Record<string, unknown>, key: string, defaultValue?: string): string | undefined {
  const value = env[key]
  if (value === undefined || value === null) {
    return defaultValue
  }
  return String(value)
}

/**
 * Get an environment variable as a number with optional default value
 */
export function getEnvNumber(env: Record<string, unknown>, key: string): number | undefined
export function getEnvNumber(env: Record<string, unknown>, key: string, defaultValue: number): number
export function getEnvNumber(env: Record<string, unknown>, key: string, defaultValue?: number): number | undefined {
  const value = getEnvString(env, key)
  if (value === undefined) {
    return defaultValue
  }
  const parsed = Number(value)
  return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Get an environment variable as an integer with optional default value
 */
export function getEnvInt(env: Record<string, unknown>, key: string): number | undefined
export function getEnvInt(env: Record<string, unknown>, key: string, defaultValue: number): number
export function getEnvInt(env: Record<string, unknown>, key: string, defaultValue?: number): number | undefined {
  const value = getEnvString(env, key)
  if (value === undefined) {
    return defaultValue
  }
  const parsed = parseInt(value, 10)
  return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Get an environment variable as a boolean
 * Treats 'true', '1', 'yes', 'on' as true (case insensitive)
 * Everything else as false
 */
export function getEnvBoolean(env: Record<string, unknown>, key: string, defaultValue = false): boolean {
  const value = getEnvString(env, key)
  if (value === undefined) {
    return defaultValue
  }
  const normalized = value.toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}

/**
 * Check if an environment variable is set (not undefined, null, or empty string)
 */
export function hasEnv(env: Record<string, unknown>, key: string): boolean {
  const value = env[key]
  return value !== undefined && value !== null && value !== ''
}