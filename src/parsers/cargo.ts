import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parse as parseToml } from "smol-toml";

import { isRecord } from "@/guards";
import type { Dependency } from "@/graph/types";
import type { ManifestParser, ParsedManifest } from "@/parsers/types";

type DepType = Dependency["type"];

/**
 * Extract dependencies from a Cargo.toml dependency section.
 *
 * Values are either:
 * - A string version: `serde = "1.0"`
 * - A table with version: `serde = { version = "1.0", features = ["derive"] }`
 * - A table with path (local dep): `my-lib = { path = "../shared" }`
 */
function extractDeps(
  manifest: Record<string, unknown>,
  field: string,
  type: DepType,
): Dependency[] {
  const raw = manifest[field];
  if (!isRecord(raw)) {
    return [];
  }

  const deps: Dependency[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string") {
      deps.push({ name, range: value, type });
    } else if (isRecord(value)) {
      if (typeof value["path"] === "string") {
        const range = typeof value["version"] === "string" ? value["version"] : "<local>";
        deps.push({ name, range, type });
      } else if (typeof value["version"] === "string") {
        deps.push({ name, range: value["version"], type });
      } else if (typeof value["git"] === "string") {
        deps.push({ name, range: "<git>", type });
      } else {
        deps.push({ name, range: "any", type });
      }
    }
  }
  return deps;
}

/**
 * Extract local dependency paths from path deps across all sections.
 */
function extractLocalPaths(manifest: Record<string, unknown>, manifestDir: string): string[] {
  const paths: string[] = [];
  const sections = ["dependencies", "dev-dependencies", "build-dependencies"];

  for (const section of sections) {
    const raw = manifest[section];
    if (!isRecord(raw)) {
      continue;
    }
    for (const value of Object.values(raw)) {
      if (isRecord(value) && typeof value["path"] === "string") {
        paths.push(resolve(manifestDir, value["path"]));
      }
    }
  }

  return paths;
}

export const cargoParser: ManifestParser = {
  manifestName: "Cargo.toml",

  async parse(manifestPath: string): Promise<ParsedManifest> {
    const content = await readFile(manifestPath, "utf-8");
    const manifest = parseToml(content) as Record<string, unknown>;

    const pkg = isRecord(manifest["package"]) ? manifest["package"] : null;

    const name = pkg && typeof pkg["name"] === "string" ? pkg["name"] : "<unnamed>";
    const version = pkg && typeof pkg["version"] === "string" ? pkg["version"] : undefined;

    const dependencies = [
      ...extractDeps(manifest, "dependencies", "production"),
      ...extractDeps(manifest, "dev-dependencies", "dev"),
      ...extractDeps(manifest, "build-dependencies", "dev"),
    ];

    const localDependencyPaths = extractLocalPaths(manifest, dirname(manifestPath));

    return { name, version, dependencies, localDependencyPaths };
  },
};
