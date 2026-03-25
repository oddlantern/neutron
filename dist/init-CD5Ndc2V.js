#!/usr/bin/env node
import { t as printBanner } from "./bin.js";
import { t as loadConfig } from "./loader-BqgJlGYf.js";
import { runCheck } from "./check-DGNQGCP2.js";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { Document, isMap, isScalar } from "yaml";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { cancel, confirm, intro, isCancel, log, multiselect, outro, path, select, spinner, text } from "@clack/prompts";
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
const CONFIG_FILENAME = "mido.yml";
function handleCancel() {
	cancel("Aborted.");
	process.exit(0);
}
/**
* Interactive setup that scans the repo and generates mido.yml.
* If mido.yml already exists, runs reconciliation mode instead.
*
* @returns exit code (0 = success, 1 = error)
*/
async function runInit(root, parsers) {
	const configPath = join(root, CONFIG_FILENAME);
	if (existsSync(configPath)) return runReconciliation(root, configPath, parsers);
	return runFirstTime(root, configPath, parsers);
}
async function runFirstTime(root, configPath, parsers) {
	printBanner();
	intro("mido init");
	const s = spinner();
	s.start("Scanning repo...");
	const discovered = await scanRepo(root);
	s.stop("Scan complete");
	if (discovered.length === 0) {
		log.error("No ecosystem packages found. Nothing to configure.");
		return 1;
	}
	const supported = discovered.filter((p) => p.supported);
	const unsupported = discovered.filter((p) => !p.supported);
	if (unsupported.length > 0) for (const pkg of unsupported) log.warn(`${pkg.ecosystem} detected at ${pkg.path} (not yet supported)`);
	if (supported.length === 0) {
		log.error("No supported ecosystem packages found.");
		return 1;
	}
	const ecosystems = groupByEcosystem(supported);
	const packageLines = formatEcosystemList(ecosystems);
	log.info(`Found ${supported.length} packages across ${Object.keys(ecosystems).length} ecosystems:\n${packageLines}`);
	const adjustPackages = await select({
		message: "Confirm packages?",
		options: [{
			value: "yes",
			label: "Yes, looks correct"
		}, {
			value: "adjust",
			label: "Let me adjust"
		}]
	});
	if (isCancel(adjustPackages)) handleCancel();
	let finalSupported = supported;
	if (adjustPackages === "adjust") {
		const selected = await multiselect({
			message: "Select packages to include:",
			options: supported.map((p) => ({
				value: p.path,
				label: p.path,
				hint: p.ecosystem
			})),
			initialValues: supported.map((p) => p.path),
			required: true
		});
		if (isCancel(selected)) handleCancel();
		const selectedSet = new Set(selected);
		finalSupported = supported.filter((p) => selectedSet.has(p.path));
	}
	const finalEcosystems = groupByEcosystem(finalSupported);
	const bridges = [...await detectBridges(root, finalSupported)];
	if (bridges.length > 0) {
		const bridgeLines = bridges.map((b) => `  ${b.source} \u2192 ${b.target} via ${b.artifact}`).join("\n");
		log.info(`Detected ${bridges.length} bridge(s):\n${bridgeLines}`);
	}
	const manualBridges = await promptAdditionalBridges(root, finalSupported.map((p) => p.path));
	bridges.push(...manualBridges);
	const envFiles = detectEnvFiles(root, finalSupported);
	if (envFiles.length >= 2) {
		const envLines = envFiles.map((e) => `  ${e.path}`).join("\n");
		log.info(`Env files:\n${envLines}`);
	}
	const dirName = root.split("/").pop() ?? "workspace";
	const nameResult = await text({
		message: "Workspace name:",
		placeholder: dirName,
		defaultValue: dirName
	});
	if (isCancel(nameResult)) handleCancel();
	await writeFile(configPath, renderYaml(buildConfigObject(nameResult || dirName, finalEcosystems, bridges, envFiles)), "utf-8");
	log.success(`${CONFIG_FILENAME} written`);
	const installHooks = await confirm({
		message: "Install git hooks?",
		initialValue: true
	});
	if (isCancel(installHooks)) handleCancel();
	if (installHooks) {
		const { runInstall } = await import("./install-a0iKVUxi.js");
		const installResult = await runInstall(root);
		if (installResult !== 0) return installResult;
	}
	await cleanupReplacedTooling(root);
	await runPostInitCheck(parsers);
	outro("Workspace ready.");
	return 0;
}
async function runReconciliation(root, configPath, parsers) {
	printBanner();
	intro("mido init — reconciling with existing config");
	const s = spinner();
	s.start("Scanning repo and comparing with mido.yml...");
	const supported = (await scanRepo(root)).filter((p) => p.supported);
	let existing;
	try {
		existing = (await loadConfig(root)).config;
	} catch {
		s.stop("Failed to load existing config");
		log.error(`Could not parse existing ${CONFIG_FILENAME}. Delete it and run init again.`);
		return 1;
	}
	s.stop("Scan complete");
	const existingPaths = /* @__PURE__ */ new Set();
	const existingEcosystemForPath = /* @__PURE__ */ new Map();
	for (const [eco, group] of Object.entries(existing.ecosystems)) for (const pkg of group.packages) {
		existingPaths.add(pkg);
		existingEcosystemForPath.set(pkg, eco);
	}
	const discoveredPaths = new Set(supported.map((p) => p.path));
	const kept = [];
	const newPackages = [];
	const missing = [];
	for (const pkg of supported) if (existingPaths.has(pkg.path)) kept.push(pkg.path);
	else newPackages.push(pkg);
	for (const path of existingPaths) if (!discoveredPaths.has(path)) missing.push(path);
	const statusLines = [];
	for (const path of kept) {
		const eco = existingEcosystemForPath.get(path) ?? "";
		statusLines.push(`  \u2713 ${path} (${eco})`);
	}
	for (const pkg of newPackages) statusLines.push(`  + ${pkg.path} (${pkg.ecosystem}) \u2190 NEW`);
	for (const path of missing) {
		const eco = existingEcosystemForPath.get(path) ?? "";
		statusLines.push(`  \u26A0 ${path} (${eco}) \u2190 NOT FOUND ON DISK`);
	}
	log.info(`Packages:\n${statusLines.join("\n")}`);
	let configChanged = false;
	for (const pkg of newPackages) {
		const add = await confirm({
			message: `${pkg.path} detected. Add to config?`,
			initialValue: true
		});
		if (isCancel(add)) handleCancel();
		if (add) {
			addPackageToConfig(existing, pkg);
			configChanged = true;
		}
	}
	for (const path of missing) {
		const remove = await confirm({
			message: `${path} not found on disk. Remove from config?`,
			initialValue: true
		});
		if (isCancel(remove)) handleCancel();
		if (remove) {
			removePackageFromConfig(existing, path);
			configChanged = true;
		}
	}
	const existingBridges = existing.bridges ?? [];
	const updatedBridges = [];
	for (const bridge of existingBridges) {
		const action = await select({
			message: `${bridge.source} \u2192 ${bridge.target} via ${bridge.artifact}`,
			options: [
				{
					value: "keep",
					label: "Keep"
				},
				{
					value: "modify",
					label: "Modify"
				},
				{
					value: "remove",
					label: "Remove"
				}
			]
		});
		if (isCancel(action)) handleCancel();
		if (action === "keep") updatedBridges.push(bridge);
		else if (action === "modify") {
			const modified = await promptModifyBridge(root, existing, bridge);
			if (modified) {
				updatedBridges.push(modified);
				configChanged = true;
			} else updatedBridges.push(bridge);
		} else configChanged = true;
	}
	const manualBridges = await promptAdditionalBridges(root, getAllPackagePaths(existing));
	if (manualBridges.length > 0) {
		configChanged = true;
		for (const b of manualBridges) updatedBridges.push({
			source: b.source,
			target: b.target,
			artifact: b.artifact
		});
	}
	if (configChanged || updatedBridges.length !== existingBridges.length) {
		existing["bridges"] = updatedBridges.length > 0 ? updatedBridges : void 0;
		configChanged = true;
	}
	if (configChanged) {
		await writeFile(configPath, renderYaml(configToObject(existing)), "utf-8");
		log.success("Config updated");
	} else log.success("No changes needed");
	await runPostInitCheck(parsers);
	outro("Workspace ready.");
	return 0;
}
async function runPostInitCheck(parsers) {
	if (await runCheck(parsers, { quiet: true }) === 0) {
		log.success("All checks passed");
		return;
	}
	const { config, root } = await loadConfig();
	const { buildWorkspaceGraph } = await import("./workspace-EFJiXFzK.js").then((n) => n.n);
	const { findVersionMismatches } = await import("./versions-BIEdbVj8.js").then((n) => n.r);
	const { loadLock } = await import("./lock-BGhC5OeQ.js").then((n) => n.n);
	const mismatches = findVersionMismatches(await buildWorkspaceGraph(config, root, parsers), await loadLock(root));
	if (mismatches.length === 0) return;
	const fix = await confirm({
		message: `Found ${mismatches.length} version mismatch(es). Fix now?`,
		initialValue: true
	});
	if (isCancel(fix)) handleCancel();
	if (fix) await runCheck(parsers, { fix: true });
}
async function promptModifyBridge(root, config, current) {
	const allPaths = getAllPackagePaths(config);
	const source = await select({
		message: "Source (who generates the file):",
		options: allPaths.map((p) => ({
			value: p,
			label: p
		})),
		initialValue: current.source
	});
	if (isCancel(source)) handleCancel();
	const target = await select({
		message: "Target (who depends on it):",
		options: allPaths.filter((p) => p !== source).map((p) => ({
			value: p,
			label: p
		})),
		initialValue: current.target
	});
	if (isCancel(target)) handleCancel();
	const artifact = await path({
		message: "Artifact (shared file):",
		root,
		initialValue: current.artifact
	});
	if (isCancel(artifact)) handleCancel();
	return {
		source,
		target,
		artifact: relative(root, join(root, artifact))
	};
}
async function promptAdditionalBridges(root, packagePaths) {
	const result = [];
	const addMore = await confirm({
		message: "Any additional bridges?",
		initialValue: false
	});
	if (isCancel(addMore)) handleCancel();
	if (!addMore) return result;
	let adding = true;
	while (adding) {
		const source = await select({
			message: "Source (who generates the file):",
			options: packagePaths.map((p) => ({
				value: p,
				label: p
			}))
		});
		if (isCancel(source)) handleCancel();
		const target = await select({
			message: "Target (who depends on it):",
			options: packagePaths.filter((p) => p !== source).map((p) => ({
				value: p,
				label: p
			}))
		});
		if (isCancel(target)) handleCancel();
		const artifact = await path({
			message: "Artifact (shared file, e.g. openapi.json):",
			root
		});
		if (isCancel(artifact)) handleCancel();
		const relArtifact = relative(root, join(root, artifact));
		const fullArtifactPath = join(root, relArtifact);
		if (existsSync(fullArtifactPath)) try {
			if (statSync(fullArtifactPath).isDirectory()) {
				log.warn("Artifact must be a file, not a directory. Skipping bridge.");
				const retry = await confirm({
					message: "Add another bridge?",
					initialValue: false
				});
				if (isCancel(retry)) handleCancel();
				adding = retry;
				continue;
			}
		} catch {}
		else {
			const proceed = await confirm({
				message: "File not found — it may not be generated yet. Continue?",
				initialValue: false
			});
			if (isCancel(proceed)) handleCancel();
			if (!proceed) {
				const retry = await confirm({
					message: "Add another bridge?",
					initialValue: false
				});
				if (isCancel(retry)) handleCancel();
				adding = retry;
				continue;
			}
		}
		result.push({
			source,
			target,
			artifact: relArtifact,
			reason: "manual"
		});
		log.step(`Bridge: ${source} \u2192 ${target} via ${relArtifact}`);
		const another = await confirm({
			message: "Add another bridge?",
			initialValue: false
		});
		if (isCancel(another)) handleCancel();
		adding = another;
	}
	return result;
}
function getAllPackagePaths(config) {
	const paths = [];
	for (const group of Object.values(config.ecosystems)) paths.push(...group.packages);
	return paths.sort();
}
function addPackageToConfig(config, pkg) {
	const eco = config.ecosystems[pkg.ecosystem];
	if (eco) {
		eco.packages.push(pkg.path);
		eco.packages.sort();
	} else {
		const manifestNames = {
			typescript: "package.json",
			dart: "pubspec.yaml"
		};
		config.ecosystems[pkg.ecosystem] = {
			manifest: manifestNames[pkg.ecosystem] ?? pkg.manifest,
			packages: [pkg.path]
		};
	}
}
function removePackageFromConfig(config, path) {
	for (const [ecoName, group] of Object.entries(config.ecosystems)) {
		const idx = group.packages.indexOf(path);
		if (idx !== -1) {
			group.packages.splice(idx, 1);
			if (group.packages.length === 0) delete config.ecosystems[ecoName];
			return;
		}
	}
}
function configToObject(config) {
	const obj = {
		workspace: config.workspace,
		ecosystems: config.ecosystems
	};
	if (config.bridges && config.bridges.length > 0) obj["bridges"] = config.bridges;
	if (config.env) obj["env"] = config.env;
	if (config.commits) obj["commits"] = config.commits;
	return obj;
}
function buildConfigObject(name, ecosystems, bridges, envFiles) {
	const config = {
		workspace: name,
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
	return config;
}
function renderYaml(config) {
	const doc = new Document(config);
	doc.commentBefore = " yaml-language-server: $schema=https://raw.githubusercontent.com/oddlantern/mido/main/schema.json";
	const comments = new Map([
		["workspace", " Workspace name"],
		["ecosystems", " Language ecosystems and their packages"],
		["bridges", " Cross-ecosystem dependencies linked by a shared artifact"],
		["env", " Environment variable parity across packages"]
	]);
	if (isMap(doc.contents)) for (const pair of doc.contents.items) {
		if (!isScalar(pair.key)) continue;
		const comment = comments.get(String(pair.key.value));
		if (comment) pair.key.commentBefore = comment;
	}
	return doc.toString({ lineWidth: 120 });
}
function formatEcosystemList(ecosystems) {
	const lines = [];
	for (const [name, group] of Object.entries(ecosystems)) {
		lines.push(`  ${name} (${group.packages.length} packages)`);
		for (const pkg of group.packages) lines.push(`    ${pkg}`);
	}
	return lines.join("\n");
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
		const answer = await confirm({
			message: "mido replaces Husky. Remove .husky/ directory?",
			initialValue: true
		});
		if (isCancel(answer)) handleCancel();
		if (answer) {
			await rm(huskyDir, { recursive: true });
			log.step("Removed .husky/");
		}
	}
	const foundConfigs = [];
	for (const name of COMMITLINT_CONFIGS) if (existsSync(join(root, name))) foundConfigs.push(name);
	if (foundConfigs.length > 0) {
		const answer = await confirm({
			message: "mido replaces commitlint. Remove commitlint config?",
			initialValue: true
		});
		if (isCancel(answer)) handleCancel();
		if (answer) for (const name of foundConfigs) {
			await unlink(join(root, name));
			log.step(`Removed ${name}`);
		}
	}
	const pkgJsonPath = join(root, "package.json");
	if (!existsSync(pkgJsonPath)) return;
	const pkgRaw = await readFile(pkgJsonPath, "utf-8");
	const devDeps = JSON.parse(pkgRaw)["devDependencies"];
	const depsToRemove = devDeps ? HUSKY_DEPS.filter((d) => d in devDeps) : [];
	if (depsToRemove.length > 0) {
		const answer = await confirm({
			message: "Remove Husky and commitlint from devDependencies?",
			initialValue: true
		});
		if (isCancel(answer)) handleCancel();
		if (answer) {
			const full = `${detectRemoveCommand(root)} ${depsToRemove.join(" ")}`;
			log.step(`$ ${full}`);
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
		log.step("Updated scripts.prepare → \"mido install\"");
	}
}
//#endregion
export { runInit };

//# sourceMappingURL=init-CD5Ndc2V.js.map