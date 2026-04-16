import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { composerParser } from "../../src/parsers/composer.js";

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "neutron-test-composer-")));
}

function writeManifest(dir: string, content: Record<string, unknown>): string {
  const path = join(dir, "composer.json");
  writeFileSync(path, JSON.stringify(content, null, 2));
  return path;
}

describe("composerParser", () => {
  test("manifestName is composer.json", () => {
    expect(composerParser.manifestName).toBe("composer.json");
  });

  test("parses name and version", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      name: "vendor/package",
      version: "1.0.0",
    });

    const result = await composerParser.parse(path);
    expect(result.name).toBe("vendor/package");
    expect(result.version).toBe("1.0.0");
  });

  test("extracts require dependencies", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      name: "test",
      require: {
        "laravel/framework": "^10.0",
        "doctrine/orm": "^2.0",
      },
    });

    const result = await composerParser.parse(path);
    const names = result.dependencies.map((d) => d.name);
    expect(names).toContain("laravel/framework");
    expect(names).toContain("doctrine/orm");
  });

  test("extracts require-dev dependencies", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      name: "test",
      "require-dev": {
        "phpunit/phpunit": "^10.0",
      },
    });

    const result = await composerParser.parse(path);
    const devDep = result.dependencies.find((d) => d.name === "phpunit/phpunit");
    expect(devDep?.type).toBe("dev");
  });

  test("filters out platform requirements", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      name: "test",
      require: {
        php: "^8.1",
        "ext-json": "*",
        "ext-pdo": "*",
        "laravel/framework": "^10.0",
      },
    });

    const result = await composerParser.parse(path);
    const names = result.dependencies.map((d) => d.name);
    expect(names).not.toContain("php");
    expect(names).not.toContain("ext-json");
    expect(names).toContain("laravel/framework");
  });

  test("extracts path repositories as local paths", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      name: "test",
      repositories: [
        { type: "path", url: "../shared" },
        { type: "vcs", url: "https://github.com/org/repo" },
      ],
    });

    const result = await composerParser.parse(path);
    expect(result.localDependencyPaths).toHaveLength(1);
    expect(result.localDependencyPaths[0]).toContain("shared");
  });

  test("handles missing name", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, {
      require: { "laravel/framework": "^10.0" },
    });

    const result = await composerParser.parse(path);
    expect(result.name).toBe("<unnamed>");
    expect(result.version).toBeUndefined();
  });
});
