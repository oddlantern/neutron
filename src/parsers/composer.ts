import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { isRecord } from "@/guards";
import type { Dependency } from "@/graph/types";
import type { ManifestParser, ParsedManifest } from "@/parsers/types";

type DepType = Dependency["type"];

/** Platform requirements that are not actual packages */
function isPlatformRequirement(name: string): boolean {
  return (
    name === "php" || name.startsWith("ext-") || name.startsWith("lib-") || name === "composer"
  );
}

function extractDeps(
  manifest: Record<string, unknown>,
  field: string,
  type: DepType,
): Dependency[] {
  const raw = manifest[field];
  if (!isRecord(raw)) {
    return [];
  }
  return Object.entries(raw)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .filter(([name]) => !isPlatformRequirement(name))
    .map(([name, range]) => ({ name, range, type }));
}

/**
 * Extract local dependency paths from composer.json repositories.
 * Path repositories look like: { "type": "path", "url": "../shared" }
 */
function extractLocalPaths(manifest: Record<string, unknown>, manifestDir: string): string[] {
  const repos = manifest["repositories"];
  if (!Array.isArray(repos)) {
    return [];
  }

  const paths: string[] = [];
  for (const repo of repos) {
    if (!isRecord(repo)) {
      continue;
    }
    if (repo["type"] === "path" && typeof repo["url"] === "string") {
      paths.push(resolve(manifestDir, repo["url"]));
    }
  }

  return paths;
}

export const composerParser: ManifestParser = {
  manifestName: "composer.json",

  async parse(manifestPath: string): Promise<ParsedManifest> {
    const content = await readFile(manifestPath, "utf-8");
    const manifest: unknown = JSON.parse(content);
    if (!isRecord(manifest)) {
      throw new Error(`Expected object in ${manifestPath}`);
    }

    const name = typeof manifest["name"] === "string" ? manifest["name"] : "<unnamed>";
    const version = typeof manifest["version"] === "string" ? manifest["version"] : undefined;

    const dependencies = [
      ...extractDeps(manifest, "require", "production"),
      ...extractDeps(manifest, "require-dev", "dev"),
    ];

    const localDependencyPaths = extractLocalPaths(manifest, dirname(manifestPath));

    return { name, version, dependencies, localDependencyPaths };
  },
};
