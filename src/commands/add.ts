import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { confirm, intro, isCancel, log, outro, select, text } from "@clack/prompts";
import { Document, isMap, isSeq, parseDocument } from "yaml";

import { loadConfig } from "../config/loader.js";
import { BOLD, DIM, GREEN, ORANGE, RESET } from "../output.js";

const CONFIG_FILENAME = "mido.yml";

class CancelError extends Error {
  constructor() {
    super("Aborted.");
    this.name = "CancelError";
  }
}

function handleCancel(): never {
  throw new CancelError();
}

/**
 * Scaffold a new package in the workspace.
 *
 * Creates the directory, a minimal manifest, and updates mido.yml.
 * Does NOT run package managers — the user does that.
 *
 * @returns exit code (0 = success, 1 = error)
 */
export async function runAdd(): Promise<number> {
  intro("mido add");

  // Load existing config
  let root: string;
  try {
    const loaded = await loadConfig();
    root = loaded.root;
  } catch {
    log.error("No mido.yml found. Run `mido init` first.");
    return 1;
  }

  // Pick ecosystem
  const ecosystem = await select({
    message: "Ecosystem:",
    options: [
      { value: "typescript", label: "TypeScript" },
      { value: "dart", label: "Dart / Flutter" },
    ],
  });
  if (isCancel(ecosystem)) {
    handleCancel();
  }

  // Pick type
  const pkgType = await select({
    message: "Type:",
    options: [
      { value: "library", label: "Library (consumed by other packages)" },
      { value: "app", label: "App (deployable, leaf node)" },
    ],
  });
  if (isCancel(pkgType)) {
    handleCancel();
  }

  // Enter path
  const defaultDir = pkgType === "app" ? "apps/" : "packages/";
  const pathResult = await text({
    message: "Package path (relative to workspace root):",
    placeholder: `${defaultDir}my-package`,
  });
  if (isCancel(pathResult)) {
    handleCancel();
  }
  if (!pathResult) {
    log.error("Package path is required.");
    return 1;
  }
  const pkgPath = pathResult.replace(/\/+$/, "");

  // Enter name
  const dirName = pkgPath.split("/").pop() ?? pkgPath;
  const nameResult = await text({
    message: "Package name:",
    placeholder: dirName,
    defaultValue: dirName,
  });
  if (isCancel(nameResult)) {
    handleCancel();
  }
  const pkgName = nameResult || dirName;

  // Check if path already exists
  const absPath = join(root, pkgPath);
  if (existsSync(absPath)) {
    const overwrite = await confirm({
      message: `${pkgPath} already exists. Add to mido.yml anyway?`,
      initialValue: false,
    });
    if (isCancel(overwrite) || !overwrite) {
      handleCancel();
    }
  } else {
    // Scaffold directory and manifest
    mkdirSync(absPath, { recursive: true });

    if (ecosystem === "typescript") {
      scaffoldTypeScript(absPath, pkgName, pkgType === "library");
    } else {
      scaffoldDart(absPath, pkgName, pkgType === "library");
    }

    log.success(`Scaffolded ${ORANGE}${pkgPath}${RESET}`);
  }

  // Update mido.yml
  await addToConfig(root, pkgPath, ecosystem);
  log.success(`Added to ${ORANGE}${CONFIG_FILENAME}${RESET}`);

  // Suggest next steps
  const installCmd = ecosystem === "typescript"
    ? "bun install (or npm/yarn/pnpm install)"
    : "dart pub get (or flutter pub get)";

  outro(
    `${GREEN}${BOLD}${pkgPath}${RESET} ${DIM}ready. Run${RESET} ${BOLD}${installCmd}${RESET} ${DIM}to install dependencies.${RESET}`,
  );

  return 0;
}

function scaffoldTypeScript(dir: string, name: string, isLibrary: boolean): void {
  const srcDir = join(dir, "src");
  mkdirSync(srcDir, { recursive: true });

  const pkgJson: Record<string, unknown> = {
    name,
    version: "0.0.0",
    private: true,
    type: "module",
  };

  if (isLibrary) {
    pkgJson["main"] = "src/index.ts";
    pkgJson["types"] = "src/index.ts";
  }

  writeFileSync(join(dir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
  writeFileSync(join(srcDir, "index.ts"), isLibrary ? "export {};\n" : "console.log('hello');\n", "utf-8");
}

function scaffoldDart(dir: string, name: string, isLibrary: boolean): void {
  const dartName = name.replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");

  const libDir = join(dir, "lib");
  mkdirSync(libDir, { recursive: true });

  const pubspec = [
    `name: ${dartName}`,
    "publish_to: none",
    "",
    "environment:",
    "  sdk: '>=3.0.0 <4.0.0'",
  ];

  if (!isLibrary) {
    pubspec.push("  flutter: '>=3.10.0'");
    pubspec.push("");
    pubspec.push("dependencies:");
    pubspec.push("  flutter:");
    pubspec.push("    sdk: flutter");
  }

  pubspec.push("");
  writeFileSync(join(dir, "pubspec.yaml"), pubspec.join("\n"), "utf-8");
  writeFileSync(
    join(libDir, `${dartName}.dart`),
    isLibrary ? `library ${dartName};\n` : "",
    "utf-8",
  );
}

async function addToConfig(root: string, pkgPath: string, ecosystem: string): Promise<void> {
  const configPath = join(root, CONFIG_FILENAME);
  const raw = await readFile(configPath, "utf-8");
  const doc = parseDocument(raw);

  if (!isMap(doc.contents)) {
    return;
  }

  // Find or create the ecosystems.<ecosystem>.packages array
  const ecosystems = doc.get("ecosystems");
  if (!isMap(ecosystems)) {
    return;
  }

  const eco = ecosystems.get(ecosystem);
  if (isMap(eco)) {
    const packages = eco.get("packages");
    if (isSeq(packages)) {
      // Add the new path and sort
      packages.add(pkgPath);
      // Sort the sequence items
      packages.items.sort((a, b) => String(a).localeCompare(String(b)));
    }
  } else {
    // Ecosystem doesn't exist — add it
    const manifestNames: Record<string, string> = {
      typescript: "package.json",
      dart: "pubspec.yaml",
    };
    ecosystems.set(ecosystem, {
      manifest: manifestNames[ecosystem] ?? "package.json",
      packages: [pkgPath],
    });
  }

  await writeFile(configPath, doc.toString({ lineWidth: 120 }), "utf-8");
}
