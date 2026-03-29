import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ExecutablePipelineStep,
  PipelineResult,
  PipelineStepResult,
} from "@/plugins/types";

/**
 * Hash a file's contents. Returns empty string if the file doesn't exist.
 */
async function hashFile(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Hash all output files for a step. Returns a map of path → hash.
 */
async function hashOutputFiles(
  root: string,
  paths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const hashes = new Map<string, string>();
  for (const relPath of paths) {
    const absPath = join(root, relPath);
    const hash = await hashFile(absPath);
    hashes.set(relPath, hash);
  }
  return hashes;
}

/**
 * Compare before/after hashes to detect changes.
 * Treats files that don't exist in either snapshot as "changed"
 * (the step was expected to create them but didn't).
 */
function hasChanges(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): boolean {
  for (const [path, beforeHash] of before) {
    const afterHash = after.get(path) ?? "";
    // File didn't exist before and still doesn't — expected output never materialized
    if (!beforeHash && !afterHash) {
      return true;
    }
    if (afterHash !== beforeHash) {
      return true;
    }
  }
  return false;
}

/**
 * Execute a pipeline of steps sequentially.
 *
 * - Each step runs after the previous one succeeds
 * - If a step fails, the pipeline stops immediately
 * - Output files are hashed before/after each step for change detection
 * - Returns a full result with per-step timing and change status
 */
export async function runPipeline(
  steps: readonly ExecutablePipelineStep[],
  root: string,
): Promise<PipelineResult> {
  const results: PipelineStepResult[] = [];
  let totalDuration = 0;

  for (const step of steps) {
    // Hash output files before the step runs
    const beforeHashes = step.outputPaths
      ? await hashOutputFiles(root, step.outputPaths)
      : new Map<string, string>();

    const result = await step.execute();
    totalDuration += result.duration;

    // Hash output files after the step runs
    const afterHashes = step.outputPaths
      ? await hashOutputFiles(root, step.outputPaths)
      : new Map<string, string>();

    // Determine if outputs changed (default to true if no output paths specified)
    const changed = step.outputPaths ? hasChanges(beforeHashes, afterHashes) : true;

    results.push({
      step,
      success: result.success,
      duration: result.duration,
      output: result.output,
      changed,
    });

    // Stop pipeline on failure
    if (!result.success) {
      return { success: false, totalDuration, steps: results };
    }
  }

  return { success: true, totalDuration, steps: results };
}
