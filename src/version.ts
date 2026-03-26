import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the mido package root directory. */
export const MIDO_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), "..");

const packageJsonPath = join(MIDO_ROOT, "package.json");
const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };

export const VERSION: string = pkg.version;
