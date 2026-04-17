import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { loadPluginsFromConfig } from "@/plugins/loader";

// Integration test for the critical 0.2 gap: external plugins must be
// reachable from every command, not just doctor. This test covers the
// common-path helper `loadPluginsFromConfig` which generate / dev /
// build / lint / fmt / test now use — if the helper returns the
// external plugin in the merged list, the commands have it.

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-ext-integration-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePluginPackage(pkgName: string, source: string): void {
  const pkgDir = join(root, "node_modules", pkgName);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: pkgName, version: "0.0.0", type: "module", main: "index.js" }),
    "utf-8",
  );
  writeFileSync(join(pkgDir, "index.js"), source, "utf-8");
}

describe("loadPluginsFromConfig — runtime wiring", () => {
  test("empty plugins list returns builtins only (fast path, no filesystem)", async () => {
    // No plugins declared → skips the resolver entirely.
    const plugins = await loadPluginsFromConfig({}, root);
    expect(plugins.ecosystem.some((p) => p.name === "typescript")).toBe(true);
    expect(plugins.ecosystem.some((p) => p.name === "python")).toBe(true);
    expect(plugins.domain.some((p) => p.name === "openapi")).toBe(true);
  });

  test("declared plugin appears in the merged ecosystem set", async () => {
    writePluginPackage(
      "neutron-plugin-zig",
      `
export default {
  type: "ecosystem",
  name: "zig",
  manifest: "build.zig",
  detect: async () => true,
  execute: async () => ({ success: true, duration: 0, summary: "ran" }),
};`.trim(),
    );

    const plugins = await loadPluginsFromConfig({ plugins: ["neutron-plugin-zig"] }, root);
    const zig = plugins.ecosystem.find((p) => p.name === "zig");
    expect(zig).toBeDefined();
    expect(zig?.manifest).toBe("build.zig");

    // Builtins still present.
    expect(plugins.ecosystem.some((p) => p.name === "typescript")).toBe(true);
  });

  test("declared plugin's execute is the one the registry would call", async () => {
    writePluginPackage(
      "neutron-plugin-runner",
      `
export default {
  type: "ecosystem",
  name: "runner-test",
  manifest: "x.toml",
  detect: async () => true,
  execute: async () => ({ success: true, duration: 42, summary: "from external plugin" }),
};`.trim(),
    );

    const { ecosystem } = await loadPluginsFromConfig(
      { plugins: ["neutron-plugin-runner"] },
      root,
    );
    const external = ecosystem.find((p) => p.name === "runner-test");
    expect(external).toBeDefined();

    // Verify it's callable — matters because a command dispatches to
    // this via ecosystem-runner / registry, so the method has to work.
    // Use a bare-minimum package and context matching the plugin
    // contract.
    const result = await external!.execute(
      "lint",
      {
        name: "x",
        path: "packages/x",
        ecosystem: "runner-test",
        version: "1.0.0",
        dependencies: [],
        localDependencies: [],
      },
      root,
      {
        graph: { name: "ws", root, packages: new Map(), bridges: [] },
        packageManager: "bun",
        root,
        findEcosystemHandlers: async () => [],
      },
    );
    expect(result.success).toBe(true);
    expect(result.duration).toBe(42);
    expect(result.summary).toBe("from external plugin");
  });

  test("failed plugin load doesn't break builtin availability", async () => {
    // User declared a plugin that doesn't exist. Helper should log the
    // failure (to stderr, not captured here) and return builtins +
    // whatever other external plugins DID load.
    writePluginPackage(
      "neutron-plugin-good",
      `
export default {
  type: "domain",
  name: "good-domain",
  detectBridge: async () => true,
  exportArtifact: async () => ({ success: true, duration: 0, summary: "" }),
};`.trim(),
    );

    const plugins = await loadPluginsFromConfig(
      { plugins: ["neutron-plugin-missing", "neutron-plugin-good"] },
      root,
    );
    // The good one made it in despite the neighboring failure.
    expect(plugins.domain.some((p) => p.name === "good-domain")).toBe(true);
    // Builtins still all there.
    expect(plugins.domain.some((p) => p.name === "openapi")).toBe(true);
    expect(plugins.ecosystem.some((p) => p.name === "typescript")).toBe(true);
  });

  test("external plugin with name matching a builtin overrides the builtin", async () => {
    // Critical override semantic — user-installed plugin wins when
    // name collides with a builtin.
    writePluginPackage(
      "neutron-plugin-custom-ts",
      `
export default {
  type: "ecosystem",
  name: "typescript",
  manifest: "package.json",
  detect: async () => true,
  execute: async () => ({ success: true, duration: 0, summary: "from override" }),
  markerField: "external-override",
};`.trim(),
    );

    const { ecosystem } = await loadPluginsFromConfig(
      { plugins: ["neutron-plugin-custom-ts"] },
      root,
    );
    const tsPlugins = ecosystem.filter((p) => p.name === "typescript");
    expect(tsPlugins).toHaveLength(1);
    expect((tsPlugins[0] as { markerField?: string }).markerField).toBe("external-override");
  });
});
