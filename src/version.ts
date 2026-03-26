import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the mido package root directory. */
export const MIDO_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), "..");

const packageJsonPath = join(MIDO_ROOT, "package.json");
const raw: unknown = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractVersion(data: unknown): string {
  if (!isRecord(data)) {
    return "0.0.0";
  }
  return typeof data["version"] === "string" ? data["version"] : "0.0.0";
}

export const VERSION: string = extractVersion(raw);
