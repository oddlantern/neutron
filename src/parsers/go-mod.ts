import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Dependency } from "@/graph/types";
import type { ManifestParser, ParsedManifest } from "@/parsers/types";

/**
 * Parse a go.mod file. Line-based format:
 *
 * ```
 * module github.com/org/my-module
 *
 * go 1.21
 *
 * require (
 *     github.com/gin-gonic/gin v1.9.1
 *     github.com/org/shared v0.0.0
 * )
 *
 * replace github.com/org/shared => ../shared
 * ```
 */

/** Parse a single require entry like "github.com/foo/bar v1.2.3" */
function parseRequireLine(line: string): { readonly name: string; readonly range: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("//")) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  return { name: parts[0]!, range: parts[1]! };
}

export const goModParser: ManifestParser = {
  manifestName: "go.mod",

  async parse(manifestPath: string): Promise<ParsedManifest> {
    const content = await readFile(manifestPath, "utf-8");
    const lines = content.split("\n");

    let name = "<unnamed>";
    const dependencies: Dependency[] = [];
    const localPaths: string[] = [];
    const manifestDir = dirname(manifestPath);

    let inRequireBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Module declaration
      if (trimmed.startsWith("module ")) {
        name = trimmed.slice("module ".length).trim();
        continue;
      }

      // Require block start
      if (trimmed.startsWith("require (") || trimmed === "require (") {
        inRequireBlock = true;
        continue;
      }

      // Block end
      if (trimmed === ")" && inRequireBlock) {
        inRequireBlock = false;
        continue;
      }

      // Inside require block
      if (inRequireBlock) {
        const dep = parseRequireLine(trimmed);
        if (dep) {
          dependencies.push({ name: dep.name, range: dep.range, type: "production" });
        }
        continue;
      }

      // Single-line require
      if (trimmed.startsWith("require ") && !trimmed.includes("(")) {
        const rest = trimmed.slice("require ".length).trim();
        const dep = parseRequireLine(rest);
        if (dep) {
          dependencies.push({ name: dep.name, range: dep.range, type: "production" });
        }
        continue;
      }

      // Replace directive with local path: "replace module => ../path"
      if (trimmed.startsWith("replace ")) {
        const arrowIndex = trimmed.indexOf("=>");
        if (arrowIndex === -1) {
          continue;
        }
        const target = trimmed.slice(arrowIndex + 2).trim();
        // Local path replacements start with . or /
        if (target.startsWith(".") || target.startsWith("/")) {
          // May have a version suffix: "../shared v0.0.0"
          const pathPart = target.split(/\s+/)[0]!;
          localPaths.push(resolve(manifestDir, pathPart));
        }
      }
    }

    return {
      name,
      version: undefined, // Go modules don't have a single version field
      dependencies,
      localDependencyPaths: localPaths,
    };
  },
};
