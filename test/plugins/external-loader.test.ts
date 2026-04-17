import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  classifyPlugin,
  extractPlugins,
  loadPluginsWithExternal,
} from "@/plugins/loader";

// External plugin loading is the 1.0 extensibility story. Two things
// must hold: the classify/extract helpers never accept a malformed
// module, and the loader surfaces clear errors without crashing the
// whole run when one package is broken.

describe("classifyPlugin — accepts valid shapes", () => {
  test("valid ecosystem plugin", () => {
    const plugin = {
      type: "ecosystem",
      name: "x-eco",
      manifest: "x.toml",
      detect: async () => true,
      execute: async () => ({ success: true, duration: 0, summary: "" }),
    };
    expect(classifyPlugin(plugin)).not.toBeNull();
  });

  test("valid domain plugin", () => {
    const plugin = {
      type: "domain",
      name: "x-domain",
      detectBridge: async () => true,
      exportArtifact: async () => ({ success: true, duration: 0, summary: "" }),
    };
    expect(classifyPlugin(plugin)).not.toBeNull();
  });
});

describe("classifyPlugin — rejects malformed", () => {
  test("null / undefined / primitives", () => {
    expect(classifyPlugin(null)).toBeNull();
    expect(classifyPlugin(undefined)).toBeNull();
    expect(classifyPlugin("a string")).toBeNull();
    expect(classifyPlugin(42)).toBeNull();
  });

  test("missing name", () => {
    expect(classifyPlugin({ type: "ecosystem", manifest: "x", detect: () => {}, execute: () => {} })).toBeNull();
  });

  test("unknown type", () => {
    expect(
      classifyPlugin({
        type: "what",
        name: "bad",
        manifest: "x",
        detect: () => {},
        execute: () => {},
      }),
    ).toBeNull();
  });

  test("ecosystem plugin missing required method", () => {
    expect(
      classifyPlugin({
        type: "ecosystem",
        name: "missing-execute",
        manifest: "x",
        detect: async () => false,
        // no execute
      }),
    ).toBeNull();
  });

  test("domain plugin missing required method", () => {
    expect(
      classifyPlugin({
        type: "domain",
        name: "missing-export",
        detectBridge: async () => false,
        // no exportArtifact
      }),
    ).toBeNull();
  });
});

describe("extractPlugins — supported export shapes", () => {
  const validEco = {
    type: "ecosystem" as const,
    name: "eco",
    manifest: "x",
    detect: async () => true,
    execute: async () => ({ success: true, duration: 0, summary: "" }),
  };
  const validDomain = {
    type: "domain" as const,
    name: "dom",
    detectBridge: async () => true,
    exportArtifact: async () => ({ success: true, duration: 0, summary: "" }),
  };

  test("default export", () => {
    expect(extractPlugins({ default: validEco })).toHaveLength(1);
  });

  test("named `plugin` export", () => {
    expect(extractPlugins({ plugin: validEco })).toHaveLength(1);
  });

  test("`plugins` array with multiple entries", () => {
    expect(extractPlugins({ plugins: [validEco, validDomain] })).toHaveLength(2);
  });

  test("drops invalid entries from `plugins` array without failing the rest", () => {
    // A mix: one valid, one junk, one valid. Extractor takes the good
    // ones and quietly ignores the garbage.
    expect(extractPlugins({ plugins: [validEco, "not-a-plugin", validDomain] })).toHaveLength(2);
  });

  test("returns empty when the module exports nothing recognizable", () => {
    expect(extractPlugins({ someOtherExport: 1 })).toEqual([]);
    expect(extractPlugins(null)).toEqual([]);
    expect(extractPlugins("string")).toEqual([]);
  });

  test("does not double-count when default and plugin export are the same object", () => {
    const shared = { ...validEco };
    expect(extractPlugins({ default: shared, plugin: shared })).toHaveLength(1);
  });
});

// Integration-level loader tests: write real plugin packages to a
// temp node_modules and assert the loader picks them up via module
// resolution. This exercises the createRequire + pathToFileURL path
// that pure in-memory extract tests can't reach.
describe("loadPluginsWithExternal — filesystem integration", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "neutron-ext-loader-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writePluginPackage(pkgName: string, moduleSource: string): void {
    // Supports scoped (`@scope/name`) and unscoped names.
    const pkgDir = join(root, "node_modules", pkgName);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: pkgName,
        version: "0.0.0",
        type: "module",
        main: "index.js",
      }),
      "utf-8",
    );
    writeFileSync(join(pkgDir, "index.js"), moduleSource, "utf-8");
  }

  test("loads a valid ecosystem plugin exposed as default export", async () => {
    writePluginPackage(
      "neutron-plugin-test-eco",
      `
export default {
  type: "ecosystem",
  name: "testeco",
  manifest: "test.toml",
  detect: async () => true,
  execute: async () => ({ success: true, duration: 0, summary: "" }),
};`.trim(),
    );

    const { loaded, external } = await loadPluginsWithExternal(["neutron-plugin-test-eco"], root);
    expect(external).toHaveLength(1);
    const [report] = external;
    expect(report?.loaded).toBe(true);
    expect(report?.plugins).toEqual([{ name: "testeco", type: "ecosystem" }]);

    // Loaded plugin is in the merged list alongside builtins.
    expect(loaded.ecosystem.some((p) => p.name === "testeco")).toBe(true);
    // Builtins are still there.
    expect(loaded.ecosystem.some((p) => p.name === "typescript")).toBe(true);
  });

  test("loads a package exposing `plugins` array with mixed types", async () => {
    writePluginPackage(
      "neutron-plugin-multi",
      `
export const plugins = [
  {
    type: "ecosystem",
    name: "eco-a",
    manifest: "a.toml",
    detect: async () => true,
    execute: async () => ({ success: true, duration: 0, summary: "" }),
  },
  {
    type: "domain",
    name: "dom-b",
    detectBridge: async () => true,
    exportArtifact: async () => ({ success: true, duration: 0, summary: "" }),
  },
];`.trim(),
    );

    const { loaded, external } = await loadPluginsWithExternal(["neutron-plugin-multi"], root);
    expect(external[0]?.loaded).toBe(true);
    expect(external[0]?.plugins).toHaveLength(2);
    expect(loaded.ecosystem.some((p) => p.name === "eco-a")).toBe(true);
    expect(loaded.domain.some((p) => p.name === "dom-b")).toBe(true);
  });

  test("reports failure when the package doesn't exist, doesn't crash the load", async () => {
    writePluginPackage(
      "neutron-plugin-real",
      `export default { type: "ecosystem", name: "real", manifest: "x", detect: async () => true, execute: async () => ({ success: true, duration: 0, summary: "" }) };`,
    );

    const { loaded, external } = await loadPluginsWithExternal(
      ["neutron-plugin-real", "neutron-plugin-does-not-exist"],
      root,
    );

    expect(external).toHaveLength(2);
    const [ok, failed] = external;
    expect(ok?.loaded).toBe(true);
    expect(failed?.loaded).toBe(false);
    expect(failed?.error).toBeDefined();
    // The good one still made it into the loaded set despite the
    // neighboring failure.
    expect(loaded.ecosystem.some((p) => p.name === "real")).toBe(true);
  });

  test("reports failure when a loaded package exports no plugin", async () => {
    writePluginPackage("neutron-plugin-empty", "export const somethingElse = 42;");

    const { external } = await loadPluginsWithExternal(["neutron-plugin-empty"], root);
    expect(external[0]?.loaded).toBe(false);
    expect(external[0]?.error).toContain("exports no plugin");
  });

  test("external plugin overrides a builtin on name collision", async () => {
    // Ship a plugin that claims name "python" — user explicitly
    // installed it, so it wins over the builtin python plugin.
    writePluginPackage(
      "neutron-plugin-override-python",
      `
export default {
  type: "ecosystem",
  name: "python",
  manifest: "pyproject.toml",
  detect: async () => true,
  execute: async () => ({ success: true, duration: 0, summary: "from external" }),
  // Distinct marker the builtin doesn't have.
  isExternalOverride: true,
};`.trim(),
    );

    const { loaded } = await loadPluginsWithExternal(
      ["neutron-plugin-override-python"],
      root,
    );
    const python = loaded.ecosystem.find((p) => p.name === "python");
    expect(python).toBeDefined();
    // Only one "python" plugin in the merged list.
    expect(loaded.ecosystem.filter((p) => p.name === "python")).toHaveLength(1);
    // It's the external one, not the builtin.
    expect((python as { isExternalOverride?: boolean }).isExternalOverride).toBe(true);
  });
});
