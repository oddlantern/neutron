import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isMap, parseDocument } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
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
  switch (update.ecosystem) {
    case "dart":
      return writePubspec(root, update);
    case "python":
      return writePyproject(root, update);
    case "rust":
      return writeCargoToml(root, update);
    case "go":
      return writeGoMod(root, update);
    case "php":
      return writeComposerJson(root, update);
    default:
      return writePackageJson(root, update);
  }
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

async function writePyproject(root: string, update: ManifestUpdate): Promise<boolean> {
  const filePath = join(root, update.packagePath, "pyproject.toml");
  const raw = await readFile(filePath, "utf-8");
  const doc = parseToml(raw) as Record<string, unknown>;

  let found = false;

  // PEP 621: [project].dependencies = ["pkg>=1.0", ...]
  const project = isRecord(doc["project"]) ? doc["project"] : null;
  if (project && Array.isArray(project["dependencies"])) {
    const deps = project["dependencies"] as string[];
    for (let i = 0; i < deps.length; i++) {
      const match = deps[i]?.match(/^([a-zA-Z0-9][-a-zA-Z0-9_.]*)/);
      if (match?.[1] === update.depName) {
        deps[i] = `${update.depName}${update.newRange}`;
        found = true;
        break;
      }
    }
  }

  // Poetry: [tool.poetry.dependencies].pkg = "^1.0"
  if (!found) {
    const tool = isRecord(doc["tool"]) ? doc["tool"] : null;
    const poetry = tool && isRecord(tool["poetry"]) ? tool["poetry"] : null;
    if (poetry) {
      for (const field of ["dependencies", "dev-dependencies"]) {
        const deps = isRecord(poetry[field]) ? poetry[field] : null;
        if (deps && update.depName in deps) {
          const val = deps[update.depName];
          if (typeof val === "string") {
            deps[update.depName] = update.newRange;
          } else if (isRecord(val) && "version" in val) {
            val["version"] = update.newRange;
          }
          found = true;
          break;
        }
      }
    }
  }

  if (!found) {
    return false;
  }

  await writeFile(filePath, stringifyToml(doc), "utf-8");
  return true;
}

async function writeCargoToml(root: string, update: ManifestUpdate): Promise<boolean> {
  const filePath = join(root, update.packagePath, "Cargo.toml");
  const raw = await readFile(filePath, "utf-8");
  const doc = parseToml(raw) as Record<string, unknown>;

  let found = false;

  for (const field of ["dependencies", "dev-dependencies", "build-dependencies"]) {
    const deps = isRecord(doc[field]) ? doc[field] : null;
    if (!deps || !(update.depName in deps)) {
      continue;
    }

    const val = deps[update.depName];
    if (typeof val === "string") {
      deps[update.depName] = update.newRange;
    } else if (isRecord(val) && "version" in val) {
      val["version"] = update.newRange;
    } else {
      continue;
    }

    found = true;
    break;
  }

  if (!found) {
    return false;
  }

  await writeFile(filePath, stringifyToml(doc), "utf-8");
  return true;
}

async function writeGoMod(root: string, update: ManifestUpdate): Promise<boolean> {
  const filePath = join(root, update.packagePath, "go.mod");
  const raw = await readFile(filePath, "utf-8");
  const lines = raw.split("\n");

  let found = false;
  const escaped = update.depName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const requireLineRe = new RegExp(`^(\\s*)${escaped}\\s+\\S+`);

  for (let i = 0; i < lines.length; i++) {
    if (requireLineRe.test(lines[i]!)) {
      const indent = lines[i]!.match(/^(\s*)/)?.[1] ?? "\t";
      lines[i] = `${indent}${update.depName} ${update.newRange}`;
      found = true;
      break;
    }
  }

  if (!found) {
    return false;
  }

  await writeFile(filePath, lines.join("\n"), "utf-8");
  return true;
}

async function writeComposerJson(root: string, update: ManifestUpdate): Promise<boolean> {
  const filePath = join(root, update.packagePath, "composer.json");
  const raw = await readFile(filePath, "utf-8");

  const indentMatch = raw.match(/^(\s+)"/m);
  const indent = indentMatch?.[1] ?? DEFAULT_INDENT;

  const manifest: unknown = JSON.parse(raw);
  if (!isRecord(manifest)) {
    return false;
  }

  let found = false;

  for (const field of ["require", "require-dev"]) {
    const deps = isRecord(manifest[field]) ? manifest[field] : null;
    if (deps && update.depName in deps) {
      deps[update.depName] = update.newRange;
      found = true;
      break;
    }
  }

  if (!found) {
    return false;
  }

  await writeFile(filePath, JSON.stringify(manifest, null, indent) + "\n", "utf-8");
  return true;
}
