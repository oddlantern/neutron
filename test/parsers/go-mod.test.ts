import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { goModParser } from "../../src/parsers/go-mod.js";

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "mido-test-gomod-")));
}

function writeManifest(dir: string, content: string): string {
  const path = join(dir, "go.mod");
  writeFileSync(path, content);
  return path;
}

describe("goModParser", () => {
  test("manifestName is go.mod", () => {
    expect(goModParser.manifestName).toBe("go.mod");
  });

  test("parses module name", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
module github.com/org/my-module

go 1.21
`);

    const result = await goModParser.parse(path);
    expect(result.name).toBe("github.com/org/my-module");
  });

  test("extracts require block dependencies", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
module github.com/org/test

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
)
`);

    const result = await goModParser.parse(path);
    const names = result.dependencies.map((d) => d.name);
    expect(names).toContain("github.com/gin-gonic/gin");
    expect(names).toContain("github.com/stretchr/testify");
    expect(result.dependencies.find((d) => d.name === "github.com/gin-gonic/gin")?.range).toBe("v1.9.1");
  });

  test("extracts single-line require", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
module github.com/org/test

go 1.21

require github.com/pkg/errors v0.9.1
`);

    const result = await goModParser.parse(path);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]?.name).toBe("github.com/pkg/errors");
  });

  test("extracts replace directives as local paths", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
module github.com/org/test

go 1.21

require github.com/org/shared v0.0.0

replace github.com/org/shared => ../shared
`);

    const result = await goModParser.parse(path);
    expect(result.localDependencyPaths).toHaveLength(1);
    expect(result.localDependencyPaths[0]).toContain("shared");
  });

  test("version is always undefined for go modules", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
module github.com/org/test

go 1.21
`);

    const result = await goModParser.parse(path);
    expect(result.version).toBeUndefined();
  });

  test("handles empty go.mod", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, "");

    const result = await goModParser.parse(path);
    expect(result.name).toBe("<unnamed>");
    expect(result.dependencies).toHaveLength(0);
  });
});
