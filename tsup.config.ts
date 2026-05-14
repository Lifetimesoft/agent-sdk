import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    testing: "src/testing.ts",
    runtime: "src/runtime.ts",
    "runtime-chrome": "src/runtime-chrome.ts",
    build: "src/build.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  external: ["esbuild"],
})
