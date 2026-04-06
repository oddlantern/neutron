import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { pyprojectParser } from "../../src/parsers/pyproject.js";

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "mido-test-pyproject-")));
}

function writeManifest(dir: string, content: string): string {
  const path = join(dir, "pyproject.toml");
  writeFileSync(path, content);
  return path;
}

describe("pyprojectParser", () => {
  test("manifestName is pyproject.toml", () => {
    expect(pyprojectParser.manifestName).toBe("pyproject.toml");
  });

  test("parses PEP 621 format with name and version", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[project]
name = "my-package"
version = "1.0.0"
dependencies = ["requests>=2.28", "click~=8.0"]
`);

    const result = await pyprojectParser.parse(path);
    expect(result.name).toBe("my-package");
    expect(result.version).toBe("1.0.0");
  });

  test("extracts PEP 621 dependencies", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[project]
name = "test"
dependencies = ["requests>=2.28", "click~=8.0", "pydantic"]
`);

    const result = await pyprojectParser.parse(path);
    const names = result.dependencies.map((d) => d.name);
    expect(names).toContain("requests");
    expect(names).toContain("click");
    expect(names).toContain("pydantic");
  });

  test("extracts PEP 621 optional dependencies", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[project]
name = "test"
dependencies = []

[project.optional-dependencies]
dev = ["pytest", "ruff"]
`);

    const result = await pyprojectParser.parse(path);
    const devDeps = result.dependencies.filter((d) => d.type === "optional");
    expect(devDeps.map((d) => d.name)).toContain("pytest");
  });

  test("parses Poetry format", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[tool.poetry]
name = "poetry-project"
version = "2.0.0"

[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.28"

[tool.poetry.dev-dependencies]
pytest = "^7.0"
`);

    const result = await pyprojectParser.parse(path);
    expect(result.name).toBe("poetry-project");
    expect(result.version).toBe("2.0.0");

    const names = result.dependencies.map((d) => d.name);
    expect(names).toContain("requests");
    expect(names).toContain("pytest");
    // Python version constraint should be skipped
    expect(names).not.toContain("python");
  });

  test("extracts Poetry path dependencies as local paths", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[tool.poetry]
name = "test"

[tool.poetry.dependencies]
my-lib = { path = "../shared" }
`);

    const result = await pyprojectParser.parse(path);
    expect(result.localDependencyPaths).toHaveLength(1);
    expect(result.localDependencyPaths[0]).toContain("shared");
  });

  test("handles missing name gracefully", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[build-system]
requires = ["setuptools"]
`);

    const result = await pyprojectParser.parse(path);
    expect(result.name).toBe("<unnamed>");
    expect(result.version).toBeUndefined();
  });
});
