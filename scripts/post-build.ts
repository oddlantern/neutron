import { chmod, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIST = "dist";
const SHEBANG = "#!/usr/bin/env node\n";
const BIN_PATH = join(DIST, "bin.js");

// ─── 1. Shebang + chmod on the CLI bin ───────────────────────────────────────
const binContent = await readFile(BIN_PATH, "utf-8");
if (!binContent.startsWith("#!")) {
  await writeFile(BIN_PATH, SHEBANG + binContent, "utf-8");
}
await chmod(BIN_PATH, 0o755);

// ─── 2. Rename hashed entry .d.ts → stable names matching the exports map ───
//
// tsdown's d.ts plugin emits files like `config-BGOBYDHz.d.ts` for both entries
// and chunks. Entries need stable names (e.g., `config.d.ts`) so the package's
// exports map can resolve them. Chunks keep their hash for cache busting.
//
// An entry d.ts is identified as one not imported by any other d.ts file —
// chunks get imported via `from "./X.js"` references; entries don't.

const LIBRARY_ENTRIES = ["index", "config", "graph", "parsers", "plugins", "checks"] as const;

const allDtsFiles = (await readdir(DIST)).filter((f) => f.endsWith(".d.ts"));

const referencedDtsFiles = new Set<string>();
for (const file of allDtsFiles) {
  const content = await readFile(join(DIST, file), "utf-8");
  for (const match of content.matchAll(/from "\.\/([^"]+)\.js"/g)) {
    referencedDtsFiles.add(`${match[1]}.d.ts`);
  }
}

const entryDtsFiles = allDtsFiles.filter((f) => !referencedDtsFiles.has(f));

for (const entry of LIBRARY_ENTRIES) {
  const candidates = entryDtsFiles.filter((f) => f.startsWith(`${entry}-`) && /^[a-z]+-[A-Za-z0-9_-]+\.d\.ts$/.test(f));
  if (candidates.length !== 1) {
    console.warn(
      `post-build: expected exactly one entry d.ts for "${entry}", found ${candidates.length}: ${candidates.join(", ")}`,
    );
    continue;
  }
  const [hashed] = candidates;
  await rename(join(DIST, hashed), join(DIST, `${entry}.d.ts`));

  // Rename the d.ts sourcemap if present
  const mapPath = join(DIST, `${hashed}.map`);
  if (await fileExists(mapPath)) {
    await rename(mapPath, join(DIST, `${entry}.d.ts.map`));
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

console.log("post-build: shebang on bin.js + renamed entry .d.ts to stable names");
