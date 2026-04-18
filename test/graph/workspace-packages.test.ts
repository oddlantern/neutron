import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { buildWorkspaceGraph } from "../../src/graph/workspace.js";
import type { ManifestParser } from "../../src/parsers/types.js";
import type { NeutronConfig } from "../../src/config/schema.js";

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "neutron-test-pkgs-")));
}

const stubParser: ManifestParser = {
  manifestName: "package.json",
  async parse(_manifestPath) {
    return {
      name: "stub",
      version: "0.0.0",
      dependencies: [],
      localDependencyPaths: [],
    };
  },
};

describe("buildWorkspaceGraph — package discovery", () => {
  test("errors when every ecosystem's glob expansion is empty", async () => {
    const root = makeTempDir();
    // No package directories created — every glob will match nothing.

    const config: NeutronConfig = {
      workspace: "demo",
      ecosystems: {
        typescript: {
          manifest: "package.json",
          packages: ["packages/*"],
        },
      },
      bridges: [],
    };

    const parsers = new Map([["package.json", stubParser]]);

    await expect(buildWorkspaceGraph(config, root, parsers)).rejects.toThrow(
      /no packages/i,
    );
  });

  test("succeeds when at least one ecosystem has packages", async () => {
    const root = makeTempDir();
    mkdirSync(join(root, "packages", "core"), { recursive: true });
    writeFileSync(
      join(root, "packages", "core", "package.json"),
      JSON.stringify({ name: "core", version: "0.0.0" }),
    );

    const config: NeutronConfig = {
      workspace: "demo",
      ecosystems: {
        typescript: {
          manifest: "package.json",
          packages: ["packages/*"],
        },
      },
      bridges: [],
    };

    const parsers = new Map([["package.json", stubParser]]);

    const graph = await buildWorkspaceGraph(config, root, parsers);
    expect(graph.packages.size).toBe(1);
  });
});
