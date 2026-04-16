import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    index: "src/index.ts",
    config: "src/config/index.ts",
    graph: "src/graph/index.ts",
    parsers: "src/parsers/index.ts",
    plugins: "src/plugins/index.ts",
    checks: "src/checks/index.ts",
  },
  format: "esm",
  target: "node20",
  platform: "node",
  clean: true,
  dts: true,
  sourcemap: true,
  // Shebang + chmod handled by scripts/post-build.ts (only bin needs it)
});
