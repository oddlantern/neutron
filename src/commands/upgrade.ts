import { loadConfig } from "@/config/loader";
import { DiagnosticCollector, formatDiagnostics } from "@/diagnostic";
import type { WorkspacePackage } from "@/graph/types";
import { buildWorkspaceGraph } from "@/graph/workspace";
import type { ParserRegistry } from "@/graph/workspace";
import { loadLock, mergeLock, writeLock } from "@/lock";
import type { LockUpdate } from "@/lock";
import { applyManifestUpdate } from "@/manifest-writer";
import { BOLD, DIM, GREEN, RED, RESET } from "@/output";
import { collectDeps, stripRange, buildWorkspaceDepsMap, hasFlutterDeps } from "@/outdated/collect";
import { SEVERITY_COLOR, formatRiskBadge } from "@/outdated/display";
import { runLevel1 } from "@/outdated/level1";
import type { OutdatedDep, UpgradeOptions } from "@/outdated/types";
import { detectPackageManager } from "@/pm-detect";
import { runCommand } from "@/process";
import { confirmAction, promptMultiSelect } from "@/prompt";

export type { UpgradeOptions };

const MAX_INSTALL_OUTPUT = 200;

/**
 * Preserve the range prefix (^ ~ >= etc.) from the current range
 * and apply it to the new version.
 */
function buildNewRange(currentRange: string, newVersion: string): string {
  const prefixMatch = currentRange.match(/^[\^~>=<]+/);
  const prefix = prefixMatch ? prefixMatch[0] : "^";
  return `${prefix}${newVersion}`;
}

/**
 * Run typecheck + tests per ecosystem for verification.
 */
async function runVerification(
  ecosystems: ReadonlySet<string>,
  root: string,
  packages: ReadonlyMap<string, WorkspacePackage>,
  diag: DiagnosticCollector,
): Promise<void> {
  console.log(`\n${DIM}Running verification (typecheck + tests)...${RESET}\n`);

  for (const ecosystem of ecosystems) {
    if (ecosystem === "typescript") {
      const pm = detectPackageManager(root);
      const tscBin = pm === "bun" ? "bunx" : "npx";
      const tcResult = await runCommand(tscBin, ["tsc", "--noEmit"], root);
      const tcIcon = tcResult.success ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
      console.log(`  ${tcIcon} ${DIM}typecheck (typescript)${RESET}`);
      if (!tcResult.success) {
        diag.error("TypeScript typecheck failed", {
          detail: (tcResult.output ?? "").split("\n")[0],
          fix: "Run tsc --noEmit for full output",
        });
      }

      const testResult = await runCommand(pm, ["run", "test"], root);
      const testIcon = testResult.success ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
      console.log(`  ${testIcon} ${DIM}tests (typescript)${RESET}`);
      if (!testResult.success) {
        diag.error("TypeScript tests failed", {
          detail: (testResult.output ?? "").split("\n")[0],
          fix: `Run ${pm} run test for full output`,
        });
      }
    }

    if (ecosystem === "dart") {
      const analyzeResult = await runCommand("dart", ["analyze"], root);
      const analyzeIcon = analyzeResult.success ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
      console.log(`  ${analyzeIcon} ${DIM}analyze (dart)${RESET}`);
      if (!analyzeResult.success) {
        diag.error("Dart analysis failed", {
          detail: (analyzeResult.output ?? "").split("\n")[0],
          fix: "Run dart analyze for full output",
        });
      }

      const testCmd = hasFlutterDeps(packages) ? "flutter" : "dart";
      const testResult = await runCommand(testCmd, ["test"], root);
      const testIcon = testResult.success ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
      console.log(`  ${testIcon} ${DIM}tests (dart)${RESET}`);
      if (!testResult.success) {
        diag.error("Dart tests failed", {
          detail: (testResult.output ?? "").split("\n")[0],
          fix: `Run ${testCmd} test for full output`,
        });
      }
    }
  }
}

/**
 * Interactive upgrade of outdated dependencies.
 *
 * @returns exit code (0 = success, 1 = failure)
 */
export async function runUpgrade(
  parsers: ParserRegistry,
  options: UpgradeOptions = {},
): Promise<number> {
  const { config, root } = await loadConfig();
  const graph = await buildWorkspaceGraph(config, root, parsers);

  const deps = collectDeps(graph.packages);
  if (deps.length === 0) {
    console.log(`${DIM}No production dependencies found.${RESET}`);
    return 0;
  }

  console.log(
    `\n${BOLD}neutron upgrade${RESET} ${DIM}\u2014 checking ${deps.length} dependencies...${RESET}\n`,
  );

  const workspaceDeps = buildWorkspaceDepsMap(graph.packages);
  const { outdated } = await runLevel1(deps, workspaceDeps);

  if (outdated.length === 0) {
    console.log(`${GREEN}All dependencies are up to date.${RESET}\n`);
    return 0;
  }

  console.log(`${DIM}Found ${outdated.length} outdated dep(s).${RESET}\n`);

  // ── Selection ───────────────────────────────────────────────────────
  let selected: readonly OutdatedDep[];

  if (options.all) {
    selected = outdated;
  } else {
    const selectOptions = outdated.map((dep) => {
      const color = SEVERITY_COLOR[dep.severity] ?? DIM;
      const current = stripRange(dep.workspaceRange);
      const badge = formatRiskBadge(dep.risk);
      return {
        value: dep.name,
        label: `${color}${dep.name}${RESET} ${DIM}${current} \u2192 ${dep.latest}${RESET}`,
        hint: `${dep.severity} | ${dep.ecosystem} | ${dep.packages.length} pkg | ${badge}`,
      };
    });

    const selectedNames = await promptMultiSelect("Select dependencies to upgrade", selectOptions);
    const nameSet = new Set(selectedNames);
    selected = outdated.filter((d) => nameSet.has(d.name));
  }

  if (selected.length === 0) {
    console.log(`${DIM}No dependencies selected.${RESET}`);
    return 0;
  }

  console.log(`\n${BOLD}Upgrading ${selected.length} dep(s)...${RESET}\n`);

  const diag = new DiagnosticCollector();

  // ── Update manifests ────────────────────────────────────────────────
  for (const dep of selected) {
    const newRange = buildNewRange(dep.workspaceRange, dep.latest);

    for (const pkgPath of dep.packages) {
      const success = await applyManifestUpdate(root, {
        packagePath: pkgPath,
        ecosystem: dep.ecosystem,
        depName: dep.name,
        newRange,
      });

      if (success) {
        console.log(`  ${GREEN}\u2713${RESET} ${dep.name} ${DIM}${stripRange(dep.workspaceRange)} \u2192 ${dep.latest}${RESET} ${DIM}in ${pkgPath}${RESET}`);
      } else {
        console.log(`  ${RED}\u2717${RESET} ${dep.name} ${DIM}not found in ${pkgPath}${RESET}`);
        diag.warn(`Manifest update skipped: ${dep.name} in ${pkgPath}`, {
          fix: "Check package paths in neutron.yml",
        });
      }
    }
  }

  // ── Install ─────────────────────────────────────────────────────────
  console.log(`\n${DIM}Running package manager install...${RESET}\n`);

  const ecosystems = new Set(selected.map((d) => d.ecosystem));

  for (const ecosystem of ecosystems) {
    if (ecosystem === "dart") {
      const cmd = hasFlutterDeps(graph.packages) ? "flutter" : "dart";
      const result = await runCommand(cmd, ["pub", "get"], root);
      if (result.success) {
        console.log(`  ${GREEN}\u2713${RESET} ${DIM}${cmd} pub get${RESET}`);
      } else {
        console.log(`  ${RED}\u2717${RESET} ${DIM}${cmd} pub get failed${RESET}`);
        diag.error(`${cmd} pub get failed`, {
          detail: (result.output ?? "").slice(0, MAX_INSTALL_OUTPUT),
          fix: `Run ${cmd} pub get manually and resolve conflicts`,
        });
      }
    } else {
      const pm = detectPackageManager(root);
      const result = await runCommand(pm, ["install"], root);
      if (result.success) {
        console.log(`  ${GREEN}\u2713${RESET} ${DIM}${pm} install${RESET}`);
      } else {
        console.log(`  ${RED}\u2717${RESET} ${DIM}${pm} install failed${RESET}`);
        diag.error(`${pm} install failed`, {
          detail: (result.output ?? "").slice(0, MAX_INSTALL_OUTPUT),
          fix: `Run ${pm} install manually and resolve conflicts`,
        });
      }
    }
  }

  // ── Update neutron.lock ────────────────────────────────────────────────
  const existingLock = await loadLock(root);
  const lockUpdates: LockUpdate[] = selected.map((dep) => ({
    depName: dep.name,
    range: buildNewRange(dep.workspaceRange, dep.latest),
    ecosystems: [dep.ecosystem],
  }));
  const newLock = mergeLock(existingLock, lockUpdates);
  await writeLock(root, newLock);
  console.log(`\n  ${GREEN}\u2713${RESET} ${DIM}neutron.lock updated${RESET}`);

  // ── Consistency check ───────────────────────────────────────────────
  console.log(`\n${DIM}Verifying version consistency...${RESET}\n`);

  const { runCheck } = await import("@/commands/check");
  const checkExitCode = await runCheck(parsers, { fix: false, quiet: true });

  if (checkExitCode === 0) {
    console.log(`  ${GREEN}\u2713${RESET} ${DIM}All checks passed${RESET}`);
  } else {
    diag.warn("Version consistency issues detected", {
      fix: "Run neutron check --fix to resolve",
    });
  }

  // ── Optional verification ───────────────────────────────────────────
  const shouldVerify = options.verify || await confirmAction("Run typecheck + tests to verify?", false);

  if (shouldVerify) {
    await runVerification(ecosystems, root, graph.packages, diag);
  }

  // ── Summary ─────────────────────────────────────────────────────────
  console.log(formatDiagnostics(diag, selected.length));
  return diag.hasErrors ? 1 : 0;
}
