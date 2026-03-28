#!/usr/bin/env node
import { n as VERSION } from "./version-M9xRTj7S.js";
import { a as GREEN, c as PASS, f as YELLOW, i as FAIL, r as DIM, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { t as loadConfig } from "./loader-KI-fjymk.js";
import { t as buildWorkspaceGraph } from "./workspace-22OBPV16.js";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
//#region src/commands/doctor.ts
const WARN = `${YELLOW}!${RESET}`;
function getVersion(cmd) {
	try {
		return execSync(`${cmd} --version`, {
			encoding: "utf-8",
			timeout: 5e3
		}).trim();
	} catch {
		return null;
	}
}
function checkTool(name, cmd) {
	const version = getVersion(cmd);
	if (version) return {
		label: name,
		status: "ok",
		detail: version
	};
	return {
		label: name,
		status: "warn",
		detail: "not found"
	};
}
/**
* Run workspace diagnostics — check health of mido installation,
* tool availability, config validity, hooks, and generated output.
*
* @returns exit code (0 = all ok, 1 = issues found)
*/
async function runDoctor(parsers) {
	console.log(`\n${BOLD}mido doctor${RESET} ${DIM}— v${VERSION}${RESET}\n`);
	const results = [];
	let root = null;
	try {
		const loaded = await loadConfig();
		root = loaded.root;
		const pkgCount = Object.values(loaded.config.ecosystems).reduce((sum, eco) => sum + eco.packages.length, 0);
		results.push({
			label: "mido.yml",
			status: "ok",
			detail: `${pkgCount} package(s), ${loaded.config.bridges?.length ?? 0} bridge(s)`
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		results.push({
			label: "mido.yml",
			status: "fail",
			detail: msg
		});
	}
	if (root) {
		const hooksDir = join(root, ".git", "hooks");
		const hookNames = [
			"pre-commit",
			"commit-msg",
			"post-merge",
			"post-checkout"
		];
		let installedCount = 0;
		for (const hook of hookNames) if (existsSync(join(hooksDir, hook))) installedCount++;
		if (installedCount === hookNames.length) results.push({
			label: "git hooks",
			status: "ok",
			detail: `${installedCount}/${hookNames.length} installed`
		});
		else if (installedCount > 0) results.push({
			label: "git hooks",
			status: "warn",
			detail: `${installedCount}/${hookNames.length} installed — run \`mido install\``
		});
		else results.push({
			label: "git hooks",
			status: "warn",
			detail: "none installed — run `mido install`"
		});
	}
	if (root) try {
		const graph = await buildWorkspaceGraph((await loadConfig()).config, root, parsers);
		const bridges = graph.bridges;
		let missingCount = 0;
		let presentCount = 0;
		for (const bridge of bridges) for (const consumer of bridge.consumers) {
			const pkg = graph.packages.get(consumer);
			if (!pkg) continue;
			if (existsSync(join(root, bridge.source, "generated", pkg.ecosystem))) presentCount++;
			else missingCount++;
		}
		if (missingCount === 0 && presentCount > 0) results.push({
			label: "generated output",
			status: "ok",
			detail: `${presentCount} output(s) present`
		});
		else if (missingCount > 0) results.push({
			label: "generated output",
			status: "warn",
			detail: `${missingCount} missing — run \`mido generate\``
		});
		else if (bridges.length === 0) results.push({
			label: "generated output",
			status: "ok",
			detail: "no bridges configured"
		});
	} catch {}
	results.push(checkTool("node", "node"));
	const dartVersion = getVersion("dart");
	const flutterVersion = getVersion("flutter");
	if (dartVersion) results.push({
		label: "dart",
		status: "ok",
		detail: dartVersion
	});
	if (flutterVersion) results.push({
		label: "flutter",
		status: "ok",
		detail: flutterVersion
	});
	if (!dartVersion && !flutterVersion) results.push({
		label: "dart/flutter",
		status: "warn",
		detail: "not found (only needed for Dart ecosystems)"
	});
	if (root) {
		const detected = [
			{
				file: "bun.lock",
				pm: "bun"
			},
			{
				file: "bun.lockb",
				pm: "bun"
			},
			{
				file: "pnpm-lock.yaml",
				pm: "pnpm"
			},
			{
				file: "yarn.lock",
				pm: "yarn"
			},
			{
				file: "package-lock.json",
				pm: "npm"
			}
		].find((l) => existsSync(join(root, l.file)));
		if (detected) {
			const pmVersion = getVersion(detected.pm);
			results.push({
				label: "package manager",
				status: "ok",
				detail: `${detected.pm}${pmVersion ? ` (${pmVersion})` : ""}`
			});
		} else results.push({
			label: "package manager",
			status: "warn",
			detail: "no lockfile detected"
		});
	}
	let hasIssues = false;
	for (const r of results) {
		const icon = r.status === "ok" ? PASS : r.status === "warn" ? WARN : FAIL;
		if (r.status !== "ok") hasIssues = true;
		console.log(`  ${icon} ${BOLD}${r.label}${RESET} ${DIM}${r.detail}${RESET}`);
	}
	console.log();
	if (hasIssues) {
		console.log(`${YELLOW}Some issues found.${RESET}\n`);
		return 1;
	}
	console.log(`${GREEN}All checks passed.${RESET}\n`);
	return 0;
}
//#endregion
export { runDoctor };

//# sourceMappingURL=doctor-CljN4H0E.js.map