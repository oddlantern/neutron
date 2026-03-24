#!/usr/bin/env node
import { n as closePrompt, t as ask } from "./prompt-BLf9wcmi.js";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { stringify } from "yaml";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
//#region src/discovery/scanner.ts
/** Directories to always skip during scanning */
const SKIP_DIRS = new Set([
	".dart_tool",
	".git",
	".husky",
	".idea",
	".mido",
	".symlinks",
	".vscode",
	"android",
	"build",
	"dist",
	"example",
	"ios",
	"linux",
	"macos",
	"node_modules",
	"web",
	"windows"
]);
/** Manifest filenames and their ecosystem names */
const MANIFEST_MAP = new Map([
	["package.json", "typescript"],
	["pubspec.yaml", "dart"],
	["Cargo.toml", "rust"],
	["pyproject.toml", "python"]
]);
/** Ecosystems that mido currently supports */
const SUPPORTED_ECOSYSTEMS = new Set(["typescript", "dart"]);
/**
* Load .gitignore patterns from root. Returns a simple set of directory names
* to skip (not full glob support — just top-level directory names).
*/
function loadGitignoreDirs(root) {
	const gitignorePath = join(root, ".gitignore");
	const dirs = /* @__PURE__ */ new Set();
	if (!existsSync(gitignorePath)) return dirs;
	try {
		const content = readFileSync(gitignorePath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const cleaned = trimmed.replace(/\/$/, "");
			if (cleaned && !cleaned.includes("*") && !cleaned.includes("/")) dirs.add(cleaned);
		}
	} catch {}
	return dirs;
}
/**
* Scan a repository root for ecosystem markers.
* Returns all discovered packages (both supported and unsupported).
*/
async function scanRepo(root) {
	const gitignoreDirs = loadGitignoreDirs(root);
	const skipAll = new Set([...SKIP_DIRS, ...gitignoreDirs]);
	const packages = [];
	async function walk(dir) {
		let entries;
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}
		for (const entry of entries) {
			if (skipAll.has(entry)) continue;
			const fullPath = join(dir, entry);
			let stat;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}
			if (!stat.isDirectory()) continue;
			for (const [manifest, ecosystem] of MANIFEST_MAP) {
				if (!existsSync(join(fullPath, manifest))) continue;
				packages.push({
					path: relative(root, fullPath),
					ecosystem,
					manifest,
					supported: SUPPORTED_ECOSYSTEMS.has(ecosystem)
				});
			}
			await walk(fullPath);
		}
	}
	await walk(root);
	return packages;
}
//#endregion
//#region src/discovery/heuristics.ts
const ARTIFACT_FILENAMES = [
	"openapi.json",
	"openapi.yaml",
	"swagger.json",
	"tokens.json"
];
/**
* Detect potential bridge candidates between packages of different ecosystems.
*/
async function detectBridges(root, packages) {
	const candidates = [];
	const packagesByPath = new Map(packages.map((p) => [p.path, p]));
	for (const pkg of packages) {
		const pkgDir = resolve(root, pkg.path);
		for (const artifactName of ARTIFACT_FILENAMES) {
			const artifactPath = join(pkgDir, artifactName);
			if (!existsSync(artifactPath)) continue;
			const artifactRel = relative(root, artifactPath);
			for (const other of packages) {
				if (other.path === pkg.path || other.ecosystem === pkg.ecosystem) continue;
				if (isPlausibleConsumer(pkg.path, other.path)) candidates.push({
					source: pkg.path,
					target: other.path,
					artifact: artifactRel,
					reason: `Found ${artifactName} in ${pkg.path}`
				});
			}
		}
	}
	for (const pkg of packages) {
		if (pkg.ecosystem !== "dart") continue;
		const pubspecPath = join(root, pkg.path, "pubspec.yaml");
		try {
			const raw = await readFile(pubspecPath, "utf-8");
			const pathDepPattern = /path:\s+(.+)/g;
			let match;
			while ((match = pathDepPattern.exec(raw)) !== null) {
				const depPath = match[1]?.trim();
				if (!depPath) continue;
				const relPath = relative(root, resolve(root, pkg.path, depPath));
				const targetPkg = packagesByPath.get(relPath);
				if (targetPkg && targetPkg.ecosystem !== "dart") candidates.push({
					source: targetPkg.path,
					target: pkg.path,
					artifact: `${targetPkg.path}/openapi.json`,
					reason: `Dart path dependency from ${pkg.path} to ${targetPkg.path}`
				});
			}
		} catch {}
	}
	const seen = /* @__PURE__ */ new Set();
	const unique = [];
	for (const candidate of candidates) {
		const key = `${candidate.source}:${candidate.target}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(candidate);
	}
	return unique;
}
/**
* Check if a consumer path is plausibly related to a producer path.
* E.g., packages/api/clients/dart is a plausible consumer of packages/api.
*/
function isPlausibleConsumer(producerPath, consumerPath) {
	if (consumerPath.startsWith(producerPath + "/")) return true;
	if (dirname(producerPath) === dirname(consumerPath)) return true;
	return false;
}
/**
* Find .env.example and .env.template files across the repo.
*/
function detectEnvFiles(root, packages) {
	const candidates = [];
	const envNames = [".env.example", ".env.template"];
	for (const pkg of packages) {
		const pkgDir = resolve(root, pkg.path);
		for (const envName of envNames) {
			const envPath = join(pkgDir, envName);
			if (existsSync(envPath)) candidates.push({ path: relative(root, envPath) });
		}
	}
	return candidates;
}
//#endregion
//#region src/commands/init.ts
const RESET = "\x1B[0m";
const BOLD = "\x1B[1m";
const DIM = "\x1B[2m";
const CYAN = "\x1B[36m";
const YELLOW = "\x1B[33m";
const CONFIG_FILENAME = "mido.yml";
/**
* Interactive setup that scans the repo and generates mido.yml.
*
* @returns exit code (0 = success, 1 = error)
*/
async function runInit(root) {
	const configPath = join(root, CONFIG_FILENAME);
	if (existsSync(configPath)) {
		if ((await ask(`${CONFIG_FILENAME} already exists. Overwrite? [y/N] `)).toLowerCase() !== "y") {
			console.log("Aborted.");
			closePrompt();
			return 0;
		}
	}
	console.log(`\n${CYAN}${BOLD}mido init${RESET} ${DIM}— scanning repo...${RESET}\n`);
	const discovered = await scanRepo(root);
	if (discovered.length === 0) {
		console.log("No ecosystem packages found. Nothing to configure.");
		closePrompt();
		return 1;
	}
	const supported = discovered.filter((p) => p.supported);
	const unsupported = discovered.filter((p) => !p.supported);
	if (unsupported.length > 0) {
		for (const pkg of unsupported) console.log(`  ${YELLOW}⚠${RESET} ${pkg.ecosystem} detected at ${pkg.path} (not yet supported)`);
		console.log("");
	}
	if (supported.length === 0) {
		console.log("No supported ecosystem packages found.");
		closePrompt();
		return 1;
	}
	const ecosystems = groupByEcosystem(supported);
	console.log("  Ecosystems:");
	for (const [name, group] of Object.entries(ecosystems)) {
		console.log(`    ${BOLD}${name}${RESET} (${group.packages.length} packages)`);
		for (const pkg of group.packages) console.log(`      ${pkg}`);
	}
	const bridges = [...await detectBridges(root, supported)];
	if (bridges.length > 0) {
		console.log(`\n  Bridges (auto-detected):`);
		for (const bridge of bridges) {
			console.log(`    ${bridge.source} → ${bridge.target}`);
			console.log(`      ${DIM}via ${bridge.artifact}${RESET}`);
		}
	}
	const manualBridges = await promptAdditionalBridges(root, supported.map((p) => p.path));
	bridges.push(...manualBridges);
	if (manualBridges.length > 0) {
		console.log(`\n  Bridges (manual):`);
		for (const bridge of manualBridges) {
			console.log(`    ${bridge.source} → ${bridge.target}`);
			console.log(`      ${DIM}via ${bridge.artifact}${RESET}`);
		}
	}
	const envFiles = detectEnvFiles(root, supported);
	if (envFiles.length >= 2) {
		console.log(`\n  Env files:`);
		for (const env of envFiles) console.log(`    ${env.path}`);
	}
	console.log("");
	if ((await ask(`  Write ${CONFIG_FILENAME}? [Y/n] `)).toLowerCase() === "n") {
		console.log("Aborted.");
		closePrompt();
		return 0;
	}
	const dirName = root.split("/").pop() ?? "workspace";
	const config = {
		workspace: await ask(`  Workspace name [${dirName}]: `) || dirName,
		ecosystems
	};
	if (bridges.length > 0) config["bridges"] = bridges.map((b) => ({
		source: b.source,
		target: b.target,
		artifact: b.artifact
	}));
	if (envFiles.length >= 2) config["env"] = {
		shared: [],
		files: envFiles.map((e) => e.path)
	};
	await writeFile(configPath, stringify(config, { lineWidth: 120 }), "utf-8");
	console.log(`\n  ${BOLD}${CONFIG_FILENAME}${RESET} written\n`);
	if ((await ask("  Install git hooks? [Y/n] ")).toLowerCase() !== "n") {
		const { runInstall } = await import("./install-BRkV1UYQ.js");
		const installResult = await runInstall(root);
		if (installResult !== 0) {
			closePrompt();
			return installResult;
		}
	}
	await cleanupReplacedTooling(root);
	closePrompt();
	return 0;
}
function formatPackageList(paths) {
	return paths.map((p, i) => `    ${i + 1}) ${p}`).join("\n");
}
function pickPackage(answer, paths) {
	const idx = parseInt(answer, 10);
	if (isNaN(idx) || idx < 1 || idx > paths.length) return;
	return paths[idx - 1];
}
async function promptAdditionalBridges(root, packagePaths) {
	const result = [];
	console.log("");
	if ((await ask("  Any additional bridges? [y/N] ")).toLowerCase() !== "y") return result;
	let adding = true;
	while (adding) {
		console.log(`\n  ${DIM}A bridge connects two packages across ecosystems through a shared file.${RESET}`);
		console.log(`\n  ${DIM}Source = the package that PRODUCES the artifact${RESET}\n`);
		console.log(formatPackageList(packagePaths));
		const source = pickPackage(await ask("\n  Source package: "), packagePaths);
		if (!source) {
			console.log("  Invalid choice, skipping bridge.");
			break;
		}
		const targetPaths = packagePaths.filter((p) => p !== source);
		console.log(`\n  ${DIM}Target = the package that CONSUMES the artifact${RESET}\n`);
		console.log(formatPackageList(targetPaths));
		const target = pickPackage(await ask("\n  Target package: "), targetPaths);
		if (!target) {
			console.log("  Invalid choice, skipping bridge.");
			break;
		}
		console.log(`\n  ${DIM}Artifact = the file that connects them (e.g. openapi.json, tokens.json, schema.graphql)${RESET}`);
		const artifact = await ask("  Artifact path (relative to repo root): ");
		if (!artifact) {
			console.log("  No artifact path given, skipping bridge.");
			break;
		}
		const fullArtifactPath = join(root, artifact);
		if (existsSync(fullArtifactPath)) try {
			if (statSync(fullArtifactPath).isDirectory()) {
				console.log("  Artifact must be a file, not a directory. Skipping bridge.");
				adding = (await ask("  Add another bridge? [y/N] ")).toLowerCase() === "y";
				continue;
			}
		} catch {}
		else if ((await ask(`  ${YELLOW}⚠${RESET} File not found — it may not be generated yet. Continue? [y/N] `)).toLowerCase() !== "y") {
			adding = (await ask("  Add another bridge? [y/N] ")).toLowerCase() === "y";
			continue;
		}
		if ((await ask(`  Bridge: ${source} → ${target} via ${artifact} — correct? [Y/n] `)).toLowerCase() === "n") {
			adding = (await ask("  Add another bridge? [y/N] ")).toLowerCase() === "y";
			continue;
		}
		result.push({
			source,
			target,
			artifact,
			reason: "manual"
		});
		adding = (await ask("  Add another bridge? [y/N] ")).toLowerCase() === "y";
	}
	return result;
}
const HUSKY_DEPS = [
	"husky",
	"@commitlint/cli",
	"@commitlint/config-conventional"
];
const COMMITLINT_CONFIGS = [
	"commitlint.config.js",
	".commitlintrc.js",
	".commitlintrc.json"
];
const LOCKFILE_TO_REMOVE_CMD = new Map([
	["bun.lock", "bun remove"],
	["bun.lockb", "bun remove"],
	["pnpm-lock.yaml", "pnpm remove"],
	["yarn.lock", "yarn remove"],
	["package-lock.json", "npm uninstall"]
]);
function detectRemoveCommand(root) {
	for (const [lockfile, cmd] of LOCKFILE_TO_REMOVE_CMD) if (existsSync(join(root, lockfile))) return cmd;
	return "npm uninstall";
}
async function cleanupReplacedTooling(root) {
	const huskyDir = join(root, ".husky");
	if (existsSync(huskyDir)) {
		if ((await ask("  mido replaces Husky. Remove .husky/ directory? [Y/n] ")).toLowerCase() !== "n") {
			await rm(huskyDir, { recursive: true });
			console.log(`  ${DIM}removed .husky/${RESET}`);
		}
	}
	const foundConfigs = [];
	for (const name of COMMITLINT_CONFIGS) if (existsSync(join(root, name))) foundConfigs.push(name);
	if (foundConfigs.length > 0) {
		if ((await ask("  mido replaces commitlint. Remove commitlint config? [Y/n] ")).toLowerCase() !== "n") for (const name of foundConfigs) {
			await unlink(join(root, name));
			console.log(`  ${DIM}removed ${name}${RESET}`);
		}
	}
	const pkgJsonPath = join(root, "package.json");
	if (!existsSync(pkgJsonPath)) return;
	const pkgRaw = await readFile(pkgJsonPath, "utf-8");
	const devDeps = JSON.parse(pkgRaw)["devDependencies"];
	const depsToRemove = devDeps ? HUSKY_DEPS.filter((d) => d in devDeps) : [];
	if (depsToRemove.length > 0) {
		if ((await ask("  Remove Husky and commitlint from devDependencies? [Y/n] ")).toLowerCase() !== "n") {
			const full = `${detectRemoveCommand(root)} ${depsToRemove.join(" ")}`;
			console.log(`  ${DIM}$ ${full}${RESET}`);
			execSync(full, {
				cwd: root,
				stdio: "inherit"
			});
		}
	}
	if (!existsSync(pkgJsonPath)) return;
	const freshRaw = await readFile(pkgJsonPath, "utf-8");
	const freshPkg = JSON.parse(freshRaw);
	const scripts = freshPkg["scripts"];
	if (scripts && scripts["prepare"] === "husky") {
		scripts["prepare"] = "mido install";
		await writeFile(pkgJsonPath, JSON.stringify(freshPkg, null, 2) + "\n", "utf-8");
		console.log(`  ${DIM}updated scripts.prepare → "mido install"${RESET}`);
	}
}
function groupByEcosystem(packages) {
	const groups = {};
	const manifestNames = {
		typescript: "package.json",
		dart: "pubspec.yaml"
	};
	for (const pkg of packages) {
		if (!groups[pkg.ecosystem]) groups[pkg.ecosystem] = {
			manifest: manifestNames[pkg.ecosystem] ?? pkg.manifest,
			packages: []
		};
		const group = groups[pkg.ecosystem];
		if (group) group.packages.push(pkg.path);
	}
	for (const group of Object.values(groups)) group.packages.sort();
	return groups;
}
//#endregion
export { runInit };

//# sourceMappingURL=init-D0_Z7Fyp.js.map