import { describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import { goPlugin } from "@/plugins/builtin/ecosystem/go/plugin";
import { phpPlugin } from "@/plugins/builtin/ecosystem/php/plugin";
import { pythonPlugin } from "@/plugins/builtin/ecosystem/python/plugin";
import { rustPlugin } from "@/plugins/builtin/ecosystem/rust/plugin";
import { STANDARD_ACTIONS } from "@/plugins/types";

// These four plugins were introduced thin during the ecosystem-expansion
// phase. They're still marked experimental, but users pull them in the
// moment they declare a python/rust/go/php package. This file exists so
// the contract (detect, watch patterns, domain capabilities) can't drift
// silently when the plugin internals are later filled out.

function makePkg(ecosystem: string, name: string): WorkspacePackage {
  return {
    name,
    path: `packages/${name}`,
    ecosystem,
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

describe("pythonPlugin", () => {
  test("manifest is pyproject.toml", () => {
    expect(pythonPlugin.manifest).toBe("pyproject.toml");
  });

  test("detect matches python packages only", async () => {
    expect(await pythonPlugin.detect(makePkg("python", "pkg"), "/tmp")).toBe(true);
    expect(await pythonPlugin.detect(makePkg("typescript", "pkg"), "/tmp")).toBe(false);
    expect(await pythonPlugin.detect(makePkg("rust", "pkg"), "/tmp")).toBe(false);
  });

  test("getWatchPatterns returns python file patterns", async () => {
    const patterns = await pythonPlugin.getWatchPatterns(makePkg("python", "pkg"), "/tmp");
    expect(patterns).toContain("**/*.py");
    expect(patterns).toContain("pyproject.toml");
  });

  test("canHandleDomainArtifact: advertises schema, openapi, design-tokens", async () => {
    const pkg = makePkg("python", "pkg");
    const openapi = await pythonPlugin.canHandleDomainArtifact?.("openapi", "openapi.json", pkg, "/tmp");
    expect(openapi?.action).toBe("generate-openapi-python");

    const schema = await pythonPlugin.canHandleDomainArtifact?.("schema", "user.schema.json", pkg, "/tmp");
    expect(schema?.action).toBe("generate-schema-python");

    const tokens = await pythonPlugin.canHandleDomainArtifact?.("design-tokens", "tokens.json", pkg, "/tmp");
    expect(tokens?.action).toBe("generate-design-tokens-python");
  });

  test("canHandleDomainArtifact: returns null for unknown domain", async () => {
    const pkg = makePkg("python", "pkg");
    const result = await pythonPlugin.canHandleDomainArtifact?.("bogus", "x.json", pkg, "/tmp");
    expect(result).toBeNull();
  });
});

describe("rustPlugin", () => {
  test("manifest is Cargo.toml", () => {
    expect(rustPlugin.manifest).toBe("Cargo.toml");
  });

  test("detect matches rust packages only", async () => {
    expect(await rustPlugin.detect(makePkg("rust", "pkg"), "/tmp")).toBe(true);
    expect(await rustPlugin.detect(makePkg("go", "pkg"), "/tmp")).toBe(false);
  });

  test("getWatchPatterns returns rust file patterns", async () => {
    const patterns = await rustPlugin.getWatchPatterns(makePkg("rust", "pkg"), "/tmp");
    expect(patterns).toContain("src/**/*.rs");
    expect(patterns).toContain("Cargo.toml");
  });

  test("getActions returns deterministic cargo action set", async () => {
    // Rust's getActions is tool-less (cargo is assumed), so the set is
    // stable across environments — unlike python's tool-gated actions.
    const actions = await rustPlugin.getActions(makePkg("rust", "pkg"), "/tmp");
    expect(actions).toContain(STANDARD_ACTIONS.LINT);
    expect(actions).toContain(STANDARD_ACTIONS.FORMAT);
    expect(actions).toContain(STANDARD_ACTIONS.FORMAT_CHECK);
    expect(actions).toContain(STANDARD_ACTIONS.TEST);
    expect(actions).toContain(STANDARD_ACTIONS.BUILD);
  });

  test("canHandleDomainArtifact: openapi + schema supported", async () => {
    const pkg = makePkg("rust", "pkg");
    expect((await rustPlugin.canHandleDomainArtifact?.("openapi", "spec.json", pkg, "/tmp"))?.action).toBe(
      "generate-openapi-rust",
    );
    expect((await rustPlugin.canHandleDomainArtifact?.("schema", "s.schema.json", pkg, "/tmp"))?.action).toBe(
      "generate-schema-rust",
    );
    expect(await rustPlugin.canHandleDomainArtifact?.("design-tokens", "t.json", pkg, "/tmp")).toBeNull();
  });
});

describe("goPlugin", () => {
  test("manifest is go.mod", () => {
    expect(goPlugin.manifest).toBe("go.mod");
  });

  test("detect matches go packages only", async () => {
    expect(await goPlugin.detect(makePkg("go", "pkg"), "/tmp")).toBe(true);
    expect(await goPlugin.detect(makePkg("php", "pkg"), "/tmp")).toBe(false);
  });

  test("getWatchPatterns watches go sources and module files", async () => {
    const patterns = await goPlugin.getWatchPatterns(makePkg("go", "pkg"), "/tmp");
    expect(patterns).toContain("**/*.go");
    expect(patterns).toContain("go.mod");
    expect(patterns).toContain("go.sum");
  });

  test("getActions always includes format/test/build/typecheck", async () => {
    // Go's format/vet/test/build are all provided by the toolchain
    // without plugins, so these are always available when go is on PATH
    // (the plugin assumes go is installed). The lint action is gated on
    // golangci-lint being available.
    const actions = await goPlugin.getActions(makePkg("go", "pkg"), "/tmp");
    expect(actions).toContain(STANDARD_ACTIONS.FORMAT);
    expect(actions).toContain(STANDARD_ACTIONS.FORMAT_CHECK);
    expect(actions).toContain(STANDARD_ACTIONS.TEST);
    expect(actions).toContain(STANDARD_ACTIONS.BUILD);
    expect(actions).toContain(STANDARD_ACTIONS.TYPECHECK);
  });

  test("canHandleDomainArtifact: openapi + schema, design-tokens not yet wired", async () => {
    const pkg = makePkg("go", "pkg");
    expect((await goPlugin.canHandleDomainArtifact?.("openapi", "x.json", pkg, "/tmp"))?.action).toBe(
      "generate-openapi-go",
    );
    expect((await goPlugin.canHandleDomainArtifact?.("schema", "x.schema.json", pkg, "/tmp"))?.action).toBe(
      "generate-schema-go",
    );
    expect(await goPlugin.canHandleDomainArtifact?.("design-tokens", "t.json", pkg, "/tmp")).toBeNull();
  });
});

describe("phpPlugin", () => {
  test("manifest is composer.json", () => {
    expect(phpPlugin.manifest).toBe("composer.json");
  });

  test("detect matches php packages only", async () => {
    expect(await phpPlugin.detect(makePkg("php", "pkg"), "/tmp")).toBe(true);
    expect(await phpPlugin.detect(makePkg("python", "pkg"), "/tmp")).toBe(false);
  });

  test("getWatchPatterns watches conventional php paths + composer.json", async () => {
    const patterns = await phpPlugin.getWatchPatterns(makePkg("php", "pkg"), "/tmp");
    expect(patterns).toContain("src/**/*.php");
    expect(patterns).toContain("tests/**/*.php");
    expect(patterns).toContain("composer.json");
  });

  test("canHandleDomainArtifact: openapi + schema, design-tokens not yet wired", async () => {
    const pkg = makePkg("php", "pkg");
    expect((await phpPlugin.canHandleDomainArtifact?.("openapi", "x.json", pkg, "/tmp"))?.action).toBe(
      "generate-openapi-php",
    );
    expect((await phpPlugin.canHandleDomainArtifact?.("schema", "x.schema.json", pkg, "/tmp"))?.action).toBe(
      "generate-schema-php",
    );
    expect(await phpPlugin.canHandleDomainArtifact?.("design-tokens", "t.json", pkg, "/tmp")).toBeNull();
  });
});

// Cross-plugin invariants — these check the contract uniformly so a
// future plugin added to this family gets a free sanity check if it's
// listed below.
describe("ecosystem plugin contract parity", () => {
  const plugins = [
    { name: "python", plugin: pythonPlugin },
    { name: "rust", plugin: rustPlugin },
    { name: "go", plugin: goPlugin },
    { name: "php", plugin: phpPlugin },
  ];

  test.each(plugins)("$name plugin: type is 'ecosystem'", ({ plugin }) => {
    expect(plugin.type).toBe("ecosystem");
  });

  test.each(plugins)("$name plugin: name matches ecosystem key", ({ name, plugin }) => {
    expect(plugin.name).toBe(name);
  });

  test.each(plugins)("$name plugin: detect rejects unknown ecosystem", async ({ plugin }) => {
    expect(await plugin.detect(makePkg("totally-unknown", "x"), "/tmp")).toBe(false);
  });
});
