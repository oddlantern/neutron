import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { expandPackageGlobs } from "../../src/graph/glob.js";

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "neutron-test-glob-")));
}

describe("expandPackageGlobs", () => {
  test("literal paths pass through unchanged", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "apps", "server"), { recursive: true });

    const result = expandPackageGlobs(["apps/server"], root);
    expect(result).toEqual(["apps/server"]);
  });

  test("expands apps/* to subdirectories", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "apps", "server"), { recursive: true });
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    mkdirSync(join(root, "apps", "mobile"), { recursive: true });

    const result = expandPackageGlobs(["apps/*"], root);
    expect(result).toHaveLength(3);
    expect(new Set(result)).toEqual(new Set(["apps/server", "apps/web", "apps/mobile"]));
  });

  test("mixed literal and glob patterns", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "packages", "shared"), { recursive: true });
    mkdirSync(join(root, "packages", "utils"), { recursive: true });
    mkdirSync(join(root, "apps", "server"), { recursive: true });

    const result = expandPackageGlobs(["apps/server", "packages/*"], root);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("apps/server");
    expect(new Set(result.slice(1))).toEqual(new Set(["packages/shared", "packages/utils"]));
  });

  test("returns empty for glob with no matches", () => {
    const root = makeTempDir();
    // No subdirectories exist under apps/

    const result = expandPackageGlobs(["apps/*"], root);
    expect(result).toEqual([]);
  });

  test("returns empty when parent directory does not exist", () => {
    const root = makeTempDir();

    const result = expandPackageGlobs(["nonexistent/*"], root);
    expect(result).toEqual([]);
  });

  test("skips non-directory matches", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "apps"), { recursive: true });
    mkdirSync(join(root, "apps", "server"), { recursive: true });
    // Create a file (not directory) — should be skipped
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(root, "apps", "README.md"), "hello");

    const result = expandPackageGlobs(["apps/*"], root);
    expect(result).toEqual(["apps/server"]);
  });

  test("deduplicates results", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "apps", "server"), { recursive: true });

    const result = expandPackageGlobs(["apps/server", "apps/*"], root);
    expect(result).toEqual(["apps/server"]);
  });

  test("handles prefix star patterns like app-*", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "apps", "app-web"), { recursive: true });
    mkdirSync(join(root, "apps", "app-mobile"), { recursive: true });
    mkdirSync(join(root, "apps", "server"), { recursive: true });

    const result = expandPackageGlobs(["apps/app-*"], root);
    expect(result).toHaveLength(2);
    expect(new Set(result)).toEqual(new Set(["apps/app-web", "apps/app-mobile"]));
  });

  test("handles suffix segments after star", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "packages", "shared", "src"), { recursive: true });
    mkdirSync(join(root, "packages", "utils", "src"), { recursive: true });

    const result = expandPackageGlobs(["packages/*/src"], root);
    expect(result).toHaveLength(2);
    expect(new Set(result)).toEqual(new Set(["packages/shared/src", "packages/utils/src"]));
  });

  test("handles empty pattern list", () => {
    const root = makeTempDir();
    expect(expandPackageGlobs([], root)).toEqual([]);
  });

  test("expands ** recursive globs", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "services", "api", "v1"), { recursive: true });
    mkdirSync(join(root, "services", "worker"), { recursive: true });
    mkdirSync(join(root, "services", "api", "v2"), { recursive: true });

    const result = expandPackageGlobs(["services/**"], root);
    expect(new Set(result)).toEqual(
      new Set(["services/api", "services/api/v1", "services/api/v2", "services/worker"]),
    );
  });

  test("excludes patterns prefixed with !", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "packages", "core"), { recursive: true });
    mkdirSync(join(root, "packages", "ui"), { recursive: true });
    mkdirSync(join(root, "packages", "experimental-alpha"), { recursive: true });
    mkdirSync(join(root, "packages", "experimental-beta"), { recursive: true });

    const result = expandPackageGlobs(
      ["packages/*", "!packages/experimental-*"],
      root,
    );
    expect(new Set(result)).toEqual(new Set(["packages/core", "packages/ui"]));
  });
});
