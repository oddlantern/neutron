import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, test } from "bun:test";

import { MIDO_ROOT, VERSION } from "../src/version.js";

describe("VERSION", () => {
  test("is a non-empty string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  test("matches the version in package.json", () => {
    const pkgPath = join(MIDO_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(VERSION).toBe(pkg.version);
  });

  test("looks like a semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("MIDO_ROOT", () => {
  test("is an absolute path", () => {
    expect(isAbsolute(MIDO_ROOT)).toBe(true);
  });

  test("contains a package.json file", () => {
    const pkgPath = join(MIDO_ROOT, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
  });

  test("package.json at MIDO_ROOT has the mido package name", () => {
    const pkgPath = join(MIDO_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("@oddlantern/mido");
  });
});
