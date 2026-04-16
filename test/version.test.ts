import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { describe, expect, test } from "bun:test";

import { NEUTRON_ROOT, VERSION } from "../src/version";

describe("VERSION", () => {
  test("is a non-empty string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  test("matches the version in package.json", () => {
    const pkgPath = join(NEUTRON_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(VERSION).toBe(pkg.version);
  });

  test("looks like a semver string", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("NEUTRON_ROOT", () => {
  test("is an absolute path", () => {
    expect(isAbsolute(NEUTRON_ROOT)).toBe(true);
  });

  test("contains a package.json file", () => {
    const pkgPath = join(NEUTRON_ROOT, "package.json");
    expect(existsSync(pkgPath)).toBe(true);
  });

  test("package.json at NEUTRON_ROOT has the neutron package name", () => {
    const pkgPath = join(NEUTRON_ROOT, "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.name).toBe("@oddlantern/neutron");
  });
});
