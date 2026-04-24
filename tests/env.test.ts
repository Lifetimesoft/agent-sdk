import { describe, it, expect } from "vitest"
import { getEnvString, getEnvNumber, getEnvInt, getEnvBoolean, hasEnv } from "../src/env"

describe("env utilities", () => {
  describe("getEnvString", () => {
    it("returns string value when present", () => {
      const env = { TEST_VAR: "hello" }
      expect(getEnvString(env, "TEST_VAR")).toBe("hello")
    })

    it("returns default when key is missing", () => {
      const env = {}
      expect(getEnvString(env, "MISSING", "default")).toBe("default")
    })

    it("returns undefined when key is missing and no default", () => {
      const env = {}
      expect(getEnvString(env, "MISSING")).toBeUndefined()
    })

    it("converts non-string values to string", () => {
      const env = { NUM: 123, BOOL: true, NULL: null }
      expect(getEnvString(env, "NUM")).toBe("123")
      expect(getEnvString(env, "BOOL")).toBe("true")
      expect(getEnvString(env, "NULL", "default")).toBe("default")
    })
  })

  describe("getEnvNumber", () => {
    it("parses valid number strings", () => {
      const env = { INT: "123", FLOAT: "123.45", NEGATIVE: "-42" }
      expect(getEnvNumber(env, "INT")).toBe(123)
      expect(getEnvNumber(env, "FLOAT")).toBe(123.45)
      expect(getEnvNumber(env, "NEGATIVE")).toBe(-42)
    })

    it("returns default for invalid numbers", () => {
      const env = { INVALID: "not-a-number" }
      expect(getEnvNumber(env, "INVALID", 999)).toBe(999)
    })

    it("returns undefined for missing keys", () => {
      const env = {}
      expect(getEnvNumber(env, "MISSING")).toBeUndefined()
    })

    it("handles numeric values directly", () => {
      const env = { NUM: 42 }
      expect(getEnvNumber(env, "NUM")).toBe(42)
    })
  })

  describe("getEnvInt", () => {
    it("parses integer strings", () => {
      const env = { INT: "123", FLOAT: "123.99" }
      expect(getEnvInt(env, "INT")).toBe(123)
      expect(getEnvInt(env, "FLOAT")).toBe(123) // parseInt truncates
    })

    it("returns default for invalid integers", () => {
      const env = { INVALID: "not-a-number" }
      expect(getEnvInt(env, "INVALID", 999)).toBe(999)
    })
  })

  describe("getEnvBoolean", () => {
    it("treats truthy strings as true", () => {
      const env = {
        TRUE1: "true",
        TRUE2: "TRUE",
        TRUE3: "1",
        TRUE4: "yes",
        TRUE5: "YES",
        TRUE6: "on",
        TRUE7: "ON"
      }
      expect(getEnvBoolean(env, "TRUE1")).toBe(true)
      expect(getEnvBoolean(env, "TRUE2")).toBe(true)
      expect(getEnvBoolean(env, "TRUE3")).toBe(true)
      expect(getEnvBoolean(env, "TRUE4")).toBe(true)
      expect(getEnvBoolean(env, "TRUE5")).toBe(true)
      expect(getEnvBoolean(env, "TRUE6")).toBe(true)
      expect(getEnvBoolean(env, "TRUE7")).toBe(true)
    })

    it("treats other strings as false", () => {
      const env = {
        FALSE1: "false",
        FALSE2: "0",
        FALSE3: "no",
        FALSE4: "off",
        FALSE5: "anything-else"
      }
      expect(getEnvBoolean(env, "FALSE1")).toBe(false)
      expect(getEnvBoolean(env, "FALSE2")).toBe(false)
      expect(getEnvBoolean(env, "FALSE3")).toBe(false)
      expect(getEnvBoolean(env, "FALSE4")).toBe(false)
      expect(getEnvBoolean(env, "FALSE5")).toBe(false)
    })

    it("returns default for missing keys", () => {
      const env = {}
      expect(getEnvBoolean(env, "MISSING")).toBe(false) // default is false
      expect(getEnvBoolean(env, "MISSING", true)).toBe(true)
    })
  })

  describe("hasEnv", () => {
    it("returns true for present values", () => {
      const env = { PRESENT: "value", ZERO: "0", SPACE: " " }
      expect(hasEnv(env, "PRESENT")).toBe(true)
      expect(hasEnv(env, "ZERO")).toBe(true)
      expect(hasEnv(env, "SPACE")).toBe(true)
    })

    it("returns false for missing, null, or empty values", () => {
      const env = { NULL: null, EMPTY: "", UNDEFINED: undefined }
      expect(hasEnv(env, "MISSING")).toBe(false)
      expect(hasEnv(env, "NULL")).toBe(false)
      expect(hasEnv(env, "EMPTY")).toBe(false)
      expect(hasEnv(env, "UNDEFINED")).toBe(false)
    })
  })
})