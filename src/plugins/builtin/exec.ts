import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { isRecord } from "../../guards.js";
import type { ExecuteResult } from "../types.js";

export { isRecord };

/** Maximum bytes of stdout/stderr to accumulate per process */
const MAX_OUTPUT_BYTES = 1024 * 1024;

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

/**
 * Spawn a command and collect its output.
 * Does NOT use shell: true — arguments are passed directly to the executable.
 */
export function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<ExecuteResult> {
  const start = performance.now();

  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const chunks: string[] = [];
    let totalBytes = 0;

    child.stdout.on("data", (data: Buffer) => {
      if (totalBytes < MAX_OUTPUT_BYTES) {
        chunks.push(data.toString());
        totalBytes += data.length;
      }
    });

    child.stderr.on("data", (data: Buffer) => {
      if (totalBytes < MAX_OUTPUT_BYTES) {
        chunks.push(data.toString());
        totalBytes += data.length;
      }
    });

    child.on("close", (code) => {
      const duration = Math.round(performance.now() - start);
      const output = chunks.join("");

      if (code === 0) {
        resolve({
          success: true,
          duration,
          summary: `${command} ${args.join(" ")} completed`,
          output,
        });
      } else {
        resolve({
          success: false,
          duration,
          summary: `${command} ${args.join(" ")} failed (exit ${String(code)})`,
          output,
        });
      }
    });

    child.on("error", (err: Error) => {
      const duration = Math.round(performance.now() - start);
      resolve({
        success: false,
        duration,
        summary: `Failed to spawn: ${err.message}`,
        output: err.message,
      });
    });
  });
}
