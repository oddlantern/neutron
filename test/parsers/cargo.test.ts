import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { cargoParser } from "../../src/parsers/cargo.js";

function makeTempDir(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "mido-test-cargo-")));
}

function writeManifest(dir: string, content: string): string {
  const path = join(dir, "Cargo.toml");
  writeFileSync(path, content);
  return path;
}

describe("cargoParser", () => {
  test("manifestName is Cargo.toml", () => {
    expect(cargoParser.manifestName).toBe("Cargo.toml");
  });

  test("parses package name and version", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[package]
name = "my-crate"
version = "0.1.0"
`);

    const result = await cargoParser.parse(path);
    expect(result.name).toBe("my-crate");
    expect(result.version).toBe("0.1.0");
  });

  test("extracts string dependencies", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[package]
name = "test"
version = "1.0.0"

[dependencies]
serde = "1.0"
tokio = "1.28"
`);

    const result = await cargoParser.parse(path);
    const names = result.dependencies.map((d) => d.name);
    expect(names).toContain("serde");
    expect(names).toContain("tokio");
    expect(result.dependencies.find((d) => d.name === "serde")?.range).toBe("1.0");
  });

  test("extracts table-style dependencies with version", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[package]
name = "test"
version = "1.0.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
`);

    const result = await cargoParser.parse(path);
    expect(result.dependencies.find((d) => d.name === "serde")?.range).toBe("1.0");
  });

  test("extracts dev-dependencies", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[package]
name = "test"
version = "1.0.0"

[dev-dependencies]
tokio-test = "0.4"
`);

    const result = await cargoParser.parse(path);
    const devDep = result.dependencies.find((d) => d.name === "tokio-test");
    expect(devDep?.type).toBe("dev");
  });

  test("extracts path dependencies as local paths", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[package]
name = "test"
version = "1.0.0"

[dependencies]
my-lib = { path = "../shared" }
`);

    const result = await cargoParser.parse(path);
    expect(result.localDependencyPaths).toHaveLength(1);
    expect(result.localDependencyPaths[0]).toContain("shared");
  });

  test("handles missing package section", async () => {
    const dir = makeTempDir();
    const path = writeManifest(dir, `
[dependencies]
serde = "1.0"
`);

    const result = await cargoParser.parse(path);
    expect(result.name).toBe("<unnamed>");
    expect(result.version).toBeUndefined();
  });
});
