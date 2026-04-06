import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { isMap, parseDocument } from "yaml";

import { isRecord } from "@/guards";

/**
 * Wire a generated package as a workspace dependency in the consumer's manifest.
 * Idempotent — skips if the dependency already exists.
 *
 * @param consumerPath - Consumer package path relative to workspace root
 * @param generatedPkgDir - Absolute path to the generated package directory
 * @param ecosystem - Consumer's ecosystem (determines manifest format)
 * @param root - Workspace root absolute path
 */
export async function wireGeneratedDependency(
  consumerPath: string,
  generatedPkgDir: string,
  ecosystem: string,
  root: string,
): Promise<boolean> {
  switch (ecosystem) {
    case "typescript":
      return wireTypeScript(consumerPath, generatedPkgDir, root);
    case "dart":
      return wireDart(consumerPath, generatedPkgDir, root);
    default:
      // Other ecosystems: skip auto-wiring for now
      return false;
  }
}

async function wireTypeScript(
  consumerPath: string,
  generatedPkgDir: string,
  root: string,
): Promise<boolean> {
  const consumerManifest = join(root, consumerPath, "package.json");
  const generatedManifest = join(generatedPkgDir, "package.json");

  if (!existsSync(consumerManifest) || !existsSync(generatedManifest)) {
    return false;
  }

  // Read generated package name
  const genRaw = await readFile(generatedManifest, "utf-8");
  const genPkg: unknown = JSON.parse(genRaw);
  if (!isRecord(genPkg) || typeof genPkg["name"] !== "string") {
    return false;
  }
  const genName = genPkg["name"];

  // Read consumer manifest
  const consumerRaw = await readFile(consumerManifest, "utf-8");
  const consumer: unknown = JSON.parse(consumerRaw);
  if (!isRecord(consumer)) {
    return false;
  }

  // Check if already wired
  const deps = isRecord(consumer["dependencies"]) ? consumer["dependencies"] : {};
  if (genName in deps) {
    return false; // Already wired
  }

  // Add workspace dependency
  deps[genName] = "workspace:*";
  consumer["dependencies"] = deps;

  const indentMatch = consumerRaw.match(/^(\s+)"/m);
  const indent = indentMatch?.[1] ?? "  ";
  await writeFile(consumerManifest, JSON.stringify(consumer, null, indent) + "\n", "utf-8");
  return true;
}

async function wireDart(
  consumerPath: string,
  generatedPkgDir: string,
  root: string,
): Promise<boolean> {
  const consumerManifest = join(root, consumerPath, "pubspec.yaml");
  const generatedManifest = join(generatedPkgDir, "pubspec.yaml");

  if (!existsSync(consumerManifest) || !existsSync(generatedManifest)) {
    return false;
  }

  // Read generated package name
  const genRaw = await readFile(generatedManifest, "utf-8");
  const genDoc = parseDocument(genRaw);
  const genName = genDoc.get("name");
  if (typeof genName !== "string") {
    return false;
  }

  // Read consumer manifest
  const consumerRaw = await readFile(consumerManifest, "utf-8");
  const consumerDoc = parseDocument(consumerRaw);

  // Check if already wired
  const deps = consumerDoc.get("dependencies", true);
  if (isMap(deps) && deps.has(genName)) {
    return false; // Already wired
  }

  // Add path dependency
  const relPath = relative(join(root, consumerPath), generatedPkgDir);
  if (!isMap(deps)) {
    consumerDoc.set("dependencies", { [genName]: { path: relPath } });
  } else {
    deps.set(genName, { path: relPath });
  }

  await writeFile(consumerManifest, consumerDoc.toString(), "utf-8");
  return true;
}
