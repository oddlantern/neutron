#!/usr/bin/env node
import { a as GREEN, l as RED, r as DIM, t as BOLD, u as RESET } from "./output-MbJ98jNX.js";
import { a as mergeLock, o as writeLock, r as loadLock } from "./lock-0DJ_gelN.js";
import { t as loadConfig } from "./loader-CYxgXRd0.js";
import { t as buildWorkspaceGraph } from "./workspace-22OBPV16.js";
import { n as formatDiagnostics, t as DiagnosticCollector } from "./diagnostic-ua3edMsw.js";
import { t as runCommand } from "./process-ByVI-buF.js";
import { t as detectPackageManager } from "./pm-detect-BtRYHQXQ.js";
import { n as promptMultiSelect, t as confirmAction } from "./prompt-DsWWicDa.js";
import { t as applyManifestUpdate } from "./manifest-writer-4mLd8drD.js";
import { c as buildWorkspaceDepsMap, d as stripRange, l as collectDeps, n as SEVERITY_COLOR, s as formatRiskBadge, t as runLevel1, u as hasFlutterDeps } from "./level1-BXef9QQO.js";
//#region src/commands/upgrade.ts
const MAX_INSTALL_OUTPUT = 200;
/**
* Preserve the range prefix (^ ~ >= etc.) from the current range
* and apply it to the new version.
*/
function buildNewRange(currentRange, newVersion) {
	const prefixMatch = currentRange.match(/^[\^~>=<]+/);
	return `${prefixMatch ? prefixMatch[0] : "^"}${newVersion}`;
}
/**
* Run typecheck + tests per ecosystem for verification.
*/
async function runVerification(ecosystems, root, packages, diag) {
	console.log(`\n${DIM}Running verification (typecheck + tests)...${RESET}\n`);
	for (const ecosystem of ecosystems) {
		if (ecosystem === "typescript") {
			const pm = detectPackageManager(root);
			const tcResult = await runCommand(pm === "bun" ? "bunx" : "npx", ["tsc", "--noEmit"], root);
			const tcIcon = tcResult.success ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
			console.log(`  ${tcIcon} ${DIM}typecheck (typescript)${RESET}`);
			if (!tcResult.success) diag.error("TypeScript typecheck failed", {
				detail: (tcResult.output ?? "").split("\n")[0],
				fix: "Run tsc --noEmit for full output"
			});
			const testResult = await runCommand(pm, ["run", "test"], root);
			const testIcon = testResult.success ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
			console.log(`  ${testIcon} ${DIM}tests (typescript)${RESET}`);
			if (!testResult.success) diag.error("TypeScript tests failed", {
				detail: (testResult.output ?? "").split("\n")[0],
				fix: `Run ${pm} run test for full output`
			});
		}
		if (ecosystem === "dart") {
			const analyzeResult = await runCommand("dart", ["analyze"], root);
			const analyzeIcon = analyzeResult.success ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
			console.log(`  ${analyzeIcon} ${DIM}analyze (dart)${RESET}`);
			if (!analyzeResult.success) diag.error("Dart analysis failed", {
				detail: (analyzeResult.output ?? "").split("\n")[0],
				fix: "Run dart analyze for full output"
			});
			const testCmd = hasFlutterDeps(packages) ? "flutter" : "dart";
			const testResult = await runCommand(testCmd, ["test"], root);
			const testIcon = testResult.success ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
			console.log(`  ${testIcon} ${DIM}tests (dart)${RESET}`);
			if (!testResult.success) diag.error("Dart tests failed", {
				detail: (testResult.output ?? "").split("\n")[0],
				fix: `Run ${testCmd} test for full output`
			});
		}
	}
}
/**
* Interactive upgrade of outdated dependencies.
*
* @returns exit code (0 = success, 1 = failure)
*/
async function runUpgrade(parsers, options = {}) {
	const { config, root } = await loadConfig();
	const graph = await buildWorkspaceGraph(config, root, parsers);
	const deps = collectDeps(graph.packages);
	if (deps.length === 0) {
		console.log(`${DIM}No production dependencies found.${RESET}`);
		return 0;
	}
	console.log(`\n${BOLD}mido upgrade${RESET} ${DIM}\u2014 checking ${deps.length} dependencies...${RESET}\n`);
	const { outdated } = await runLevel1(deps, buildWorkspaceDepsMap(graph.packages));
	if (outdated.length === 0) {
		console.log(`${GREEN}All dependencies are up to date.${RESET}\n`);
		return 0;
	}
	console.log(`${DIM}Found ${outdated.length} outdated dep(s).${RESET}\n`);
	let selected;
	if (options.all) selected = outdated;
	else {
		const selectedNames = await promptMultiSelect("Select dependencies to upgrade", outdated.map((dep) => {
			const color = SEVERITY_COLOR[dep.severity] ?? "\x1B[2m";
			const current = stripRange(dep.workspaceRange);
			const badge = formatRiskBadge(dep.risk);
			return {
				value: dep.name,
				label: `${color}${dep.name}${RESET} ${DIM}${current} \u2192 ${dep.latest}${RESET}`,
				hint: `${dep.severity} | ${dep.ecosystem} | ${dep.packages.length} pkg | ${badge}`
			};
		}));
		const nameSet = new Set(selectedNames);
		selected = outdated.filter((d) => nameSet.has(d.name));
	}
	if (selected.length === 0) {
		console.log(`${DIM}No dependencies selected.${RESET}`);
		return 0;
	}
	console.log(`\n${BOLD}Upgrading ${selected.length} dep(s)...${RESET}\n`);
	const diag = new DiagnosticCollector();
	for (const dep of selected) {
		const newRange = buildNewRange(dep.workspaceRange, dep.latest);
		for (const pkgPath of dep.packages) if (await applyManifestUpdate(root, {
			packagePath: pkgPath,
			ecosystem: dep.ecosystem,
			depName: dep.name,
			newRange
		})) console.log(`  ${GREEN}\u2713${RESET} ${dep.name} ${DIM}${stripRange(dep.workspaceRange)} \u2192 ${dep.latest}${RESET} ${DIM}in ${pkgPath}${RESET}`);
		else {
			console.log(`  ${RED}\u2717${RESET} ${dep.name} ${DIM}not found in ${pkgPath}${RESET}`);
			diag.warn(`Manifest update skipped: ${dep.name} in ${pkgPath}`, { fix: "Check package paths in mido.yml" });
		}
	}
	console.log(`\n${DIM}Running package manager install...${RESET}\n`);
	const ecosystems = new Set(selected.map((d) => d.ecosystem));
	for (const ecosystem of ecosystems) if (ecosystem === "dart") {
		const cmd = hasFlutterDeps(graph.packages) ? "flutter" : "dart";
		const result = await runCommand(cmd, ["pub", "get"], root);
		if (result.success) console.log(`  ${GREEN}\u2713${RESET} ${DIM}${cmd} pub get${RESET}`);
		else {
			console.log(`  ${RED}\u2717${RESET} ${DIM}${cmd} pub get failed${RESET}`);
			diag.error(`${cmd} pub get failed`, {
				detail: (result.output ?? "").slice(0, MAX_INSTALL_OUTPUT),
				fix: `Run ${cmd} pub get manually and resolve conflicts`
			});
		}
	} else {
		const pm = detectPackageManager(root);
		const result = await runCommand(pm, ["install"], root);
		if (result.success) console.log(`  ${GREEN}\u2713${RESET} ${DIM}${pm} install${RESET}`);
		else {
			console.log(`  ${RED}\u2717${RESET} ${DIM}${pm} install failed${RESET}`);
			diag.error(`${pm} install failed`, {
				detail: (result.output ?? "").slice(0, MAX_INSTALL_OUTPUT),
				fix: `Run ${pm} install manually and resolve conflicts`
			});
		}
	}
	await writeLock(root, mergeLock(await loadLock(root), selected.map((dep) => ({
		depName: dep.name,
		range: buildNewRange(dep.workspaceRange, dep.latest),
		ecosystems: [dep.ecosystem]
	}))));
	console.log(`\n  ${GREEN}\u2713${RESET} ${DIM}mido.lock updated${RESET}`);
	console.log(`\n${DIM}Verifying version consistency...${RESET}\n`);
	const { runCheck } = await import("./check-qJ6B_1Uc.js").then((n) => n.t);
	if (await runCheck(parsers, {
		fix: false,
		quiet: true
	}) === 0) console.log(`  ${GREEN}\u2713${RESET} ${DIM}All checks passed${RESET}`);
	else diag.warn("Version consistency issues detected", { fix: "Run mido check --fix to resolve" });
	if (options.verify || await confirmAction("Run typecheck + tests to verify?", false)) await runVerification(ecosystems, root, graph.packages, diag);
	console.log(formatDiagnostics(diag, selected.length));
	return diag.hasErrors ? 1 : 0;
}
//#endregion
export { runUpgrade };

//# sourceMappingURL=upgrade-Bz4TIgUA.js.map