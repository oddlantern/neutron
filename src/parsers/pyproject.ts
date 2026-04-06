import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { parse as parseToml } from "smol-toml";

import { isRecord } from "@/guards";
import type { Dependency } from "@/graph/types";
import type { ManifestParser, ParsedManifest } from "@/parsers/types";

type DepType = Dependency["type"];

/**
 * Parse a PEP 508 dependency string (e.g., "requests>=2.28", "click~=8.0").
 * Extracts the package name and version specifier.
 */
function parsePep508(spec: string): { readonly name: string; readonly range: string } {
  // PEP 508: name followed by optional extras, then version specifiers
  // Examples: "requests>=2.28", "click[extra]~=8.0", "mylib @ file:../shared"
  const match = spec.match(/^([a-zA-Z0-9][-a-zA-Z0-9_.]*)/);
  const name = match?.[1] ?? spec.trim();

  // Extract version specifier after the name (and optional extras)
  const afterName = spec.slice(name.length).replace(/\[[^\]]*\]/, "").trim();
  const range = afterName.startsWith("@") ? "<local>" : afterName || "any";

  return { name, range };
}

/**
 * Extract dependencies from PEP 621 `[project].dependencies` format.
 * Each entry is a PEP 508 string.
 */
function extractPep621Deps(
  project: Record<string, unknown>,
  field: string,
  type: DepType,
): Dependency[] {
  const raw = project[field];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((spec) => {
      const { name, range } = parsePep508(spec);
      return { name, range, type };
    });
}

/**
 * Extract dependencies from PEP 621 `[project].optional-dependencies` format.
 */
function extractOptionalDeps(project: Record<string, unknown>): Dependency[] {
  const groups = project["optional-dependencies"];
  if (!isRecord(groups)) {
    return [];
  }
  const deps: Dependency[] = [];
  for (const entries of Object.values(groups)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    for (const spec of entries) {
      if (typeof spec !== "string") {
        continue;
      }
      const { name, range } = parsePep508(spec);
      deps.push({ name, range, type: "optional" });
    }
  }
  return deps;
}

/**
 * Extract dependencies from Poetry `[tool.poetry.dependencies]` format.
 * Values are either version strings ("^1.2") or tables ({ version = "^1.2", ... }).
 */
function extractPoetryDeps(
  manifest: Record<string, unknown>,
  field: string,
  type: DepType,
): Dependency[] {
  const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
  const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
  if (!poetry) {
    return [];
  }
  const raw = poetry[field];
  if (!isRecord(raw)) {
    return [];
  }

  const deps: Dependency[] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (name === "python") {
      continue; // Skip Python version constraint
    }
    if (typeof value === "string") {
      deps.push({ name, range: value, type });
    } else if (isRecord(value)) {
      if (typeof value["path"] === "string") {
        deps.push({ name, range: "<local>", type });
      } else if (typeof value["version"] === "string") {
        deps.push({ name, range: value["version"], type });
      } else {
        deps.push({ name, range: "any", type });
      }
    }
  }
  return deps;
}

/**
 * Extract local dependency paths from Poetry path deps and PEP 508 file: references.
 */
function extractLocalPaths(
  manifest: Record<string, unknown>,
  project: Record<string, unknown> | null,
  manifestDir: string,
): string[] {
  const paths: string[] = [];

  // Poetry: { path = "../shared" } in dependency sections
  const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
  const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
  if (poetry) {
    for (const field of ["dependencies", "dev-dependencies"]) {
      const raw = poetry[field];
      if (!isRecord(raw)) {
        continue;
      }
      for (const value of Object.values(raw)) {
        if (isRecord(value) && typeof value["path"] === "string") {
          paths.push(resolve(manifestDir, value["path"]));
        }
      }
    }
  }

  // PEP 508: "mylib @ file:../shared" in [project].dependencies
  if (project) {
    const deps = project["dependencies"];
    if (Array.isArray(deps)) {
      for (const spec of deps) {
        if (typeof spec !== "string") {
          continue;
        }
        const fileMatch = spec.match(/@\s*file:(.+)/);
        if (fileMatch?.[1]) {
          paths.push(resolve(manifestDir, fileMatch[1].trim()));
        }
      }
    }
  }

  return paths;
}

export const pyprojectParser: ManifestParser = {
  manifestName: "pyproject.toml",

  async parse(manifestPath: string): Promise<ParsedManifest> {
    const content = await readFile(manifestPath, "utf-8");
    const manifest = parseToml(content) as Record<string, unknown>;

    const project = isRecord(manifest["project"]) ? manifest["project"] : null;
    const tool = isRecord(manifest["tool"]) ? manifest["tool"] : null;
    const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;

    // Name: PEP 621 > Poetry > fallback
    const name =
      (project && typeof project["name"] === "string" ? project["name"] : null) ??
      (poetry && typeof poetry["name"] === "string" ? poetry["name"] : null) ??
      "<unnamed>";

    // Version: PEP 621 > Poetry > undefined
    const version =
      (project && typeof project["version"] === "string" ? project["version"] : null) ??
      (poetry && typeof poetry["version"] === "string" ? poetry["version"] : null) ??
      undefined;

    // Dependencies: try PEP 621 first, fall back to Poetry
    let dependencies: Dependency[];
    if (project && Array.isArray(project["dependencies"])) {
      // PEP 621 format
      dependencies = [
        ...extractPep621Deps(project, "dependencies", "production"),
        ...extractOptionalDeps(project),
      ];
    } else if (poetry) {
      // Poetry format
      dependencies = [
        ...extractPoetryDeps(manifest, "dependencies", "production"),
        ...extractPoetryDeps(manifest, "dev-dependencies", "dev"),
      ];
    } else {
      dependencies = [];
    }

    const localDependencyPaths = extractLocalPaths(manifest, project, dirname(manifestPath));

    return { name, version, dependencies, localDependencyPaths };
  },
};
