#!/usr/bin/env node
import { a as GREEN, r as DIM, s as ORANGE, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-CSbDQNfR.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { confirm, intro, isCancel, log, outro, select, text } from "@clack/prompts";
//#region src/commands/add.ts
const CONFIG_FILENAME = "mido.yml";
var CancelError = class extends Error {
	constructor() {
		super("Aborted.");
		this.name = "CancelError";
	}
};
function handleCancel() {
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
async function runAdd() {
	intro("mido add");
	let root;
	try {
		root = (await loadConfig()).root;
	} catch {
		log.error("No mido.yml found. Run `mido init` first.");
		return 1;
	}
	const ecosystem = await select({
		message: "Ecosystem:",
		options: [{
			value: "typescript",
			label: "TypeScript"
		}, {
			value: "dart",
			label: "Dart / Flutter"
		}]
	});
	if (isCancel(ecosystem)) handleCancel();
	const pkgType = await select({
		message: "Type:",
		options: [{
			value: "library",
			label: "Library (consumed by other packages)"
		}, {
			value: "app",
			label: "App (deployable, leaf node)"
		}]
	});
	if (isCancel(pkgType)) handleCancel();
	const pathResult = await text({
		message: "Package path (relative to workspace root):",
		placeholder: `${pkgType === "app" ? "apps/" : "packages/"}my-package`
	});
	if (isCancel(pathResult)) handleCancel();
	if (!pathResult) {
		log.error("Package path is required.");
		return 1;
	}
	const pkgPath = pathResult.replace(/\/+$/, "");
	const dirName = pkgPath.split("/").pop() ?? pkgPath;
	const nameResult = await text({
		message: "Package name:",
		placeholder: dirName,
		defaultValue: dirName
	});
	if (isCancel(nameResult)) handleCancel();
	const pkgName = nameResult || dirName;
	const absPath = join(root, pkgPath);
	if (existsSync(absPath)) {
		const overwrite = await confirm({
			message: `${pkgPath} already exists. Add to mido.yml anyway?`,
			initialValue: false
		});
		if (isCancel(overwrite) || !overwrite) handleCancel();
	} else {
		mkdirSync(absPath, { recursive: true });
		if (ecosystem === "typescript") scaffoldTypeScript(absPath, pkgName, pkgType === "library");
		else scaffoldDart(absPath, pkgName, pkgType === "library");
		log.success(`Scaffolded ${ORANGE}${pkgPath}${RESET}`);
	}
	await addToConfig(root, pkgPath, ecosystem);
	log.success(`Added to ${ORANGE}${CONFIG_FILENAME}${RESET}`);
	outro(`${GREEN}${BOLD}${pkgPath}${RESET} ${DIM}ready. Run${RESET} ${BOLD}${ecosystem === "typescript" ? "bun install (or npm/yarn/pnpm install)" : "dart pub get (or flutter pub get)"}${RESET} ${DIM}to install dependencies.${RESET}`);
	return 0;
}
function scaffoldTypeScript(dir, name, isLibrary) {
	const srcDir = join(dir, "src");
	mkdirSync(srcDir, { recursive: true });
	const pkgJson = {
		name,
		version: "0.0.0",
		private: true,
		type: "module"
	};
	if (isLibrary) {
		pkgJson["main"] = "src/index.ts";
		pkgJson["types"] = "src/index.ts";
	}
	writeFileSync(join(dir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n", "utf-8");
	writeFileSync(join(srcDir, "index.ts"), isLibrary ? "export {};\n" : "console.log('hello');\n", "utf-8");
}
function scaffoldDart(dir, name, isLibrary) {
	const dartName = name.replace(/-/g, "_").replace(/@/g, "").replace(/\//g, "_");
	const libDir = join(dir, "lib");
	mkdirSync(libDir, { recursive: true });
	const pubspec = [
		`name: ${dartName}`,
		"publish_to: none",
		"",
		"environment:",
		"  sdk: '>=3.0.0 <4.0.0'"
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
	writeFileSync(join(libDir, `${dartName}.dart`), isLibrary ? `library ${dartName};\n` : "", "utf-8");
}
async function addToConfig(root, pkgPath, ecosystem) {
	const configPath = join(root, CONFIG_FILENAME);
	const doc = parseDocument(await readFile(configPath, "utf-8"));
	if (!isMap(doc.contents)) return;
	const ecosystems = doc.get("ecosystems");
	if (!isMap(ecosystems)) return;
	const eco = ecosystems.get(ecosystem);
	if (isMap(eco)) {
		const packages = eco.get("packages");
		if (isSeq(packages)) {
			packages.add(pkgPath);
			packages.items.sort((a, b) => String(a).localeCompare(String(b)));
		}
	} else ecosystems.set(ecosystem, {
		manifest: {
			typescript: "package.json",
			dart: "pubspec.yaml"
		}[ecosystem] ?? "package.json",
		packages: [pkgPath]
	});
	await writeFile(configPath, doc.toString({ lineWidth: 120 }), "utf-8");
}
//#endregion
export { runAdd };

//# sourceMappingURL=add-C47daBW5.js.map