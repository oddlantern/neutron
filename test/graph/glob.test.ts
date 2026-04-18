import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, spyOn, test } from "bun:test";

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
    // No subdirectories exist under apps/ — new contract: emits a warning on zero match.
    const warnSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = expandPackageGlobs(["apps/*"], root);
      expect(result).toEqual([]);
      expect(warnSpy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("returns empty when parent directory does not exist", () => {
    const root = makeTempDir();
    // Non-existent parent is a zero-match — new contract: emits a warning.
    const warnSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = expandPackageGlobs(["nonexistent/*"], root);
      expect(result).toEqual([]);
      expect(warnSpy.mock.calls.length).toBeGreaterThan(0);
    } finally {
      warnSpy.mockRestore();
    }
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
    // tinyglobby's ** matches zero or more path segments, so "services" itself is included.
    expect(new Set(result)).toEqual(
      new Set(["services", "services/api", "services/api/v1", "services/api/v2", "services/worker"]),
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

  test("expands brace alternatives {a,b}/*", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    mkdirSync(join(root, "tools", "cli"), { recursive: true });
    mkdirSync(join(root, "tools", "doctor"), { recursive: true });

    const result = expandPackageGlobs(["{apps,tools}/*"], root);
    expect(new Set(result)).toEqual(
      new Set(["apps/web", "tools/cli", "tools/doctor"]),
    );
  });

  test("emits a warning when a glob matches zero packages", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "apps", "server"), { recursive: true });

    const warnSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = expandPackageGlobs(["apps/*", "nonexistent/*"], root);
      expect(result).toEqual(["apps/server"]);
      const calls = warnSpy.mock.calls.map((c) => c.join(" "));
      expect(calls.some((line) => line.includes("nonexistent/*"))).toBe(true);
      expect(calls.some((line) => line.toLowerCase().includes("no packages"))).toBe(
        true,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("warns when a literal path does not exist", () => {
    const root = makeTempDir();

    const warnSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = expandPackageGlobs(["packages/not-yet-created"], root);
      expect(result).toEqual([]);
      const calls = warnSpy.mock.calls.map((c) => c.join(" "));
      expect(
        calls.some((line) => line.includes("packages/not-yet-created")),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
