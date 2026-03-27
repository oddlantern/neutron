import { describe, expect, test } from "bun:test";

import type { Bridge, WorkspaceGraph, WorkspacePackage } from "../../src/graph/types.js";
import { loadPlugins } from "../../src/plugins/loader.js";
import { PluginRegistry } from "../../src/plugins/registry.js";

describe("shared-artifact grouping", () => {
  const dartTarget: WorkspacePackage = {
    name: "design_dart",
    path: "packages/design-system/clients/dart",
    ecosystem: "dart",
    version: undefined,
    dependencies: [],
    localDependencies: [],
  };

  const tsTarget: WorkspacePackage = {
    name: "design-ts",
    path: "packages/design-system/clients/typescript",
    ecosystem: "typescript",
    version: undefined,
    dependencies: [],
    localDependencies: [],
  };

  const source: WorkspacePackage = {
    name: "design-system",
    path: "packages/design-system",
    ecosystem: "typescript",
    version: undefined,
    dependencies: [],
    localDependencies: [],
  };

  const bridges: readonly Bridge[] = [
    {
      source: "packages/design-system",
      consumers: [
        "packages/design-system/clients/dart",
        "packages/design-system/clients/typescript",
      ],
      artifact: "packages/design-system/tokens.json",
      run: undefined,
      watch: ["packages/design-system/tokens.json"],
      entryFile: undefined,
      specPath: undefined,
    },
  ];

  const graph: WorkspaceGraph = {
    name: "test-workspace",
    root: "/tmp/test-workspace",
    packages: new Map([
      [source.path, source],
      [dartTarget.path, dartTarget],
      [tsTarget.path, tsTarget],
    ]),
    bridges,
  };

  test("design plugin detects tokens.json bridges", async () => {
    const { domain } = loadPlugins();
    const designPlugin = domain.find((p) => p.name === "design");
    expect(designPlugin).toBeDefined();
  });

  test("buildPipeline returns validate step + ecosystem steps", async () => {
    const { ecosystem, domain } = loadPlugins();
    const registry = new PluginRegistry(ecosystem, domain);

    const designPlugin = domain.find((p) => p.name === "design");
    expect(designPlugin).toBeDefined();
    expect(designPlugin!.buildPipeline).toBeDefined();

    // Create context with both targets accessible
    const context = registry.createContext(graph, "/tmp/test-workspace", "bun");

    const steps = await designPlugin!.buildPipeline!(
      source,
      "packages/design-system/tokens.json",
      [dartTarget, tsTarget],
      "/tmp/test-workspace",
      context,
    );

    // Should have at least 1 validate step
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0].name).toBe("validate-tokens");
    expect(steps[0].plugin).toBe("design");
  });

  test("registry resolves ecosystem plugins for dart and typescript targets", async () => {
    const { ecosystem, domain } = loadPlugins();
    const registry = new PluginRegistry(ecosystem, domain);

    const dartPlugin = registry.getEcosystemForPackage(dartTarget);
    const tsPlugin = registry.getEcosystemForPackage(tsTarget);

    expect(dartPlugin).toBeDefined();
    expect(dartPlugin!.name).toBe("dart");
    expect(tsPlugin).toBeDefined();
    expect(tsPlugin!.name).toBe("typescript");
  });
});
