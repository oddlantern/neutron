import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { isRecord } from "../guards.js";
import type { Dependency } from "../graph/types.js";
import type { ManifestParser, ParsedManifest } from "./types.js";

type DepType = Dependency["type"];

const DEP_FIELDS: readonly (readonly [string, DepType])[] = [
  ["dependencies", "production"],
  ["dev_dependencies", "dev"],
  ["dependency_overrides", "override"],
] as const;

const manifestSchema = z.record(z.string(), z.unknown());

/**
 * Dart dependency values can be:
 * - A string version constraint: "^1.2.3"
 * - A map with path/git/hosted source: { path: ../shared }
 * - null (meaning "any")
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
    } else if (!value) {
      deps.push({ name, range: "any", type });
    } else if (isRecord(value)) {
      // Map-style dependency (path, git, hosted, sdk)
      if (typeof value["version"] === "string") {
        deps.push({ name, range: value["version"], type });
      } else if ("path" in value || "git" in value || "sdk" in value) {
        // Path/git/sdk deps don't have a version range to compare
        deps.push({ name, range: "<local>", type });
      } else {
        deps.push({ name, range: "any", type });
      }
    }
  }

  return deps;
}

function extractLocalPaths(manifest: Record<string, unknown>, manifestDir: string): string[] {
  const paths: string[] = [];

  for (const [field] of DEP_FIELDS) {
    const raw = manifest[field];
    if (!isRecord(raw)) {
      continue;
    }

    for (const value of Object.values(raw)) {
      if (!isRecord(value)) {
        continue;
      }

      if (typeof value["path"] === "string") {
        paths.push(resolve(manifestDir, value["path"]));
      }
    }
  }

  return paths;
}

export const pubspecParser: ManifestParser = {
  manifestName: "pubspec.yaml",

  async parse(manifestPath: string): Promise<ParsedManifest> {
    const content = await readFile(manifestPath, "utf-8");
    const manifest = manifestSchema.parse(parseYaml(content));

    const name = typeof manifest["name"] === "string" ? manifest["name"] : "<unnamed>";
    const version = typeof manifest["version"] === "string" ? manifest["version"] : undefined;

    const dependencies = DEP_FIELDS.flatMap(([field, type]) => extractDeps(manifest, field, type));

    const localDependencyPaths = extractLocalPaths(manifest, dirname(manifestPath));

    return { name, version, dependencies, localDependencyPaths };
  },
};
