import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isRecord } from "@/guards";
import { runCommand } from "@/process";
import type { ExecutionContext } from "@/plugins/types";

export { isRecord, runCommand };

/** Check if the execution context has pre-resolved file paths */
export function hasResolvedFiles(context: ExecutionContext): boolean {
  return !!context.resolvedFiles && context.resolvedFiles.length > 0;
}

/**
 * Read and parse a package.json file from a package directory.
 * @param pkgPath — package path relative to workspace root
 * @param root — workspace root absolute path
 */
export async function readPackageJson(
  pkgPath: string,
  root: string,
): Promise<Record<string, unknown>> {
  const manifestPath = join(root, pkgPath, "package.json");
  const content = await readFile(manifestPath, "utf-8");
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error(`Expected object in ${manifestPath}`);
  }
  return parsed;
}

/** Extract the scripts record from a parsed package.json */
export function getScripts(manifest: Record<string, unknown>): Record<string, string> {
  const scripts = manifest["scripts"];
  if (!isRecord(scripts)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value === "string") {
      result[key] = value;
    }
  }
  return result;
}

const DEFAULT_DEP_FIELDS: readonly string[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
];

/** Check if a manifest has a dependency in the specified dependency groups */
export function hasDep(
  manifest: Record<string, unknown>,
  name: string,
  fields: readonly string[] = DEFAULT_DEP_FIELDS,
): boolean {
  for (const field of fields) {
    const deps = manifest[field];
    if (isRecord(deps) && name in deps) {
      return true;
    }
  }
  return false;
}
