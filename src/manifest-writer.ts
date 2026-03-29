import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isMap, parseDocument } from "yaml";
import { z } from "zod";

import { isRecord } from "@/guards";

const DEFAULT_INDENT = "  ";

const DEP_FIELDS_JSON = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

const packageJsonSchema = z.record(z.string(), z.unknown());

export interface ManifestUpdate {
  readonly packagePath: string;
  readonly ecosystem: string;
  readonly depName: string;
  readonly newRange: string;
}

export function applyManifestUpdate(root: string, update: ManifestUpdate): Promise<boolean> {
  if (update.ecosystem === "dart") {
    return writePubspec(root, update);
  }
  // Default to package.json for any JS/TS ecosystem
  return writePackageJson(root, update);
}

async function writePackageJson(root: string, update: ManifestUpdate): Promise<boolean> {
  const filePath = join(root, update.packagePath, "package.json");
  const raw = await readFile(filePath, "utf-8");

  // Detect indent from raw content
  const indentMatch = raw.match(/^(\s+)"/m);
  const indent = indentMatch?.[1] ?? DEFAULT_INDENT;

  const manifest = packageJsonSchema.parse(JSON.parse(raw));

  let found = false;

  for (const field of DEP_FIELDS_JSON) {
    const deps = manifest[field];
    if (!isRecord(deps)) {
      continue;
    }
    if (!(update.depName in deps)) {
      continue;
    }

    deps[update.depName] = update.newRange;
    found = true;
  }

  if (!found) {
    return false;
  }

  await writeFile(filePath, JSON.stringify(manifest, null, indent) + "\n", "utf-8");
  return true;
}

async function writePubspec(root: string, update: ManifestUpdate): Promise<boolean> {
  const filePath = join(root, update.packagePath, "pubspec.yaml");
  const raw = await readFile(filePath, "utf-8");
  const doc = parseDocument(raw);

  const depFields = ["dependencies", "dev_dependencies", "dependency_overrides"];
  let found = false;

  for (const field of depFields) {
    const section = doc.get(field, true);
    if (!isMap(section)) {
      continue;
    }

    if (!section.has(update.depName)) {
      continue;
    }

    const currentValue = section.get(update.depName);

    if (typeof currentValue === "string" || typeof currentValue === "number" || !currentValue) {
      // Simple scalar value — replace directly
      section.set(update.depName, update.newRange);
      found = true;
    } else if (isMap(currentValue)) {
      if (currentValue.has("version")) {
        currentValue.set("version", update.newRange);
        found = true;
      } else if (currentValue.has("path") || currentValue.has("git") || currentValue.has("sdk")) {
        // path/git/sdk dep — can't update version range
        return false;
      }
    }
  }

  if (!found) {
    return false;
  }

  await writeFile(filePath, doc.toString(), "utf-8");
  return true;
}
