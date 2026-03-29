import { BOLD, DIM, GREEN, ORANGE, RED, RESET, YELLOW } from "@/output";

import { stripRange } from "@/outdated/collect";
import type { OutdatedDep, RiskScore, StaticAnalysisResult, ValidationResult } from "@/outdated/types";

export const SEVERITY_COLOR: Readonly<Record<string, string>> = { major: RED, minor: YELLOW, patch: DIM };
const SEVERITY_LABEL: Readonly<Record<string, string>> = { major: "MAJOR", minor: "MINOR", patch: "PATCH" };

const RISK_CRITICAL_THRESHOLD = 76;
const RISK_HIGH_THRESHOLD = 51;
const RISK_MODERATE_THRESHOLD = 26;

const MAX_ERROR_PREVIEW_LINES = 5;

/** Format a risk score as a colored badge. */
export function formatRiskBadge(risk: RiskScore): string {
  if (risk.total >= RISK_CRITICAL_THRESHOLD) {
    return `${RED}CRITICAL${RESET}`;
  }
  if (risk.total >= RISK_HIGH_THRESHOLD) {
    return `${ORANGE}HIGH${RESET}`;
  }
  if (risk.total >= RISK_MODERATE_THRESHOLD) {
    return `${YELLOW}MODERATE${RESET}`;
  }
  return `${GREEN}LOW${RESET}`;
}

/** Print Level 1 results to console. */
export function formatLevel1Results(outdated: readonly OutdatedDep[]): void {
  if (outdated.length === 0) {
    console.log(`${GREEN}All dependencies are up to date.${RESET}\n`);
    return;
  }

  const shared = outdated.filter((d) => d.packages.length > 1);
  const single = outdated.filter((d) => d.packages.length === 1);

  function printDep(dep: OutdatedDep): void {
    const color = SEVERITY_COLOR[dep.severity] ?? DIM;
    const label = SEVERITY_LABEL[dep.severity] ?? "PATCH";
    const current = stripRange(dep.workspaceRange);
    const badge = formatRiskBadge(dep.risk);

    let line = `  ${color}${label}${RESET} ${BOLD}${dep.name}${RESET} ${DIM}${current} \u2192${RESET} ${color}${dep.latest}${RESET}`;
    line += ` ${DIM}(${dep.ecosystem}, ${dep.packages.length} pkg)${RESET}`;
    line += ` [${badge}]`;

    console.log(line);

    if (dep.metadata.deprecated) {
      console.log(`    ${RED}\u26A0 DEPRECATED: ${dep.metadata.deprecated}${RESET}`);
    }

    if (dep.peerConflicts.length > 0) {
      for (const conflict of dep.peerConflicts) {
        console.log(
          `    ${YELLOW}\u26A0 peer conflict: ${conflict.peerName} requires ${conflict.requiredRange}, workspace has ${conflict.workspaceRange}${RESET}`,
        );
      }
    }

    if (dep.metadata.changelogUrl) {
      console.log(`    ${DIM}\u2192 ${dep.metadata.changelogUrl}${RESET}`);
    }
  }

  if (shared.length > 0) {
    console.log(`${ORANGE}${BOLD}Shared dependencies${RESET} ${DIM}(used across multiple packages)${RESET}`);
    for (const dep of shared) {
      printDep(dep);
    }
    console.log();
  }

  if (single.length > 0) {
    console.log(`${BOLD}Other dependencies${RESET}`);
    for (const dep of single) {
      printDep(dep);
    }
    console.log();
  }

  const majorCount = outdated.filter((d) => d.severity === "major").length;
  const minorCount = outdated.filter((d) => d.severity === "minor").length;
  const patchCount = outdated.filter((d) => d.severity === "patch").length;
  const deprecatedCount = outdated.filter((d) => d.metadata.deprecated).length;
  const conflictCount = outdated.filter((d) => d.peerConflicts.length > 0).length;

  console.log(
    `${DIM}${outdated.length} outdated: ${RED}${majorCount} major${RESET}${DIM}, ${YELLOW}${minorCount} minor${RESET}${DIM}, ${patchCount} patch${RESET}`,
  );

  if (deprecatedCount > 0 || conflictCount > 0) {
    const parts: string[] = [];
    if (deprecatedCount > 0) {
      parts.push(`${RED}${deprecatedCount} deprecated${RESET}`);
    }
    if (conflictCount > 0) {
      parts.push(`${YELLOW}${conflictCount} with peer conflicts${RESET}`);
    }
    console.log(`${DIM}${parts.join(", ")}${RESET}`);
  }
}

/** Format outdated results as JSON string. */
export function formatJsonOutput(outdated: readonly OutdatedDep[]): string {
  return JSON.stringify(outdated, null, 2);
}

/** Print Level 2 static analysis results to console. */
export function formatLevel2Results(results: readonly StaticAnalysisResult[]): void {
  if (results.length === 0) {
    console.log(`${DIM}No static analysis results.${RESET}\n`);
    return;
  }

  console.log(`\n${BOLD}Static analysis${RESET} ${DIM}\u2014 approximate API surface diff${RESET}\n`);

  for (const result of results) {
    const dep = result.dep;
    const color = SEVERITY_COLOR[dep.severity] ?? DIM;

    console.log(`  ${color}${BOLD}${dep.name}${RESET} ${DIM}${stripRange(dep.workspaceRange)} \u2192 ${dep.latest}${RESET}`);

    if (!result.typeDiff) {
      console.log(`    ${DIM}Could not diff API surface${RESET}`);
      continue;
    }

    const diff = result.typeDiff;

    if (diff.removed.length === 0 && diff.changed.length === 0 && diff.added.length === 0) {
      console.log(`    ${GREEN}No API surface changes detected${RESET}`);
      continue;
    }

    if (diff.added.length > 0) {
      console.log(`    ${GREEN}+${diff.added.length} added${RESET}`);
    }
    if (diff.changed.length > 0) {
      console.log(`    ${YELLOW}~${diff.changed.length} changed${RESET}`);
    }
    if (diff.removed.length > 0) {
      console.log(`    ${RED}-${diff.removed.length} removed${RESET}`);
    }

    if (result.usedRemovedExports.length > 0) {
      console.log(`    ${RED}\u26A0 ${result.usedRemovedExports.length} removed export(s) used in codebase:${RESET}`);
      for (const name of result.usedRemovedExports) {
        console.log(`      ${RED}\u2022 ${name}${RESET}`);
      }
    }

    if (result.usedChangedExports.length > 0) {
      console.log(`    ${YELLOW}\u26A0 ${result.usedChangedExports.length} changed export(s) used in codebase:${RESET}`);
      for (const name of result.usedChangedExports) {
        console.log(`      ${YELLOW}\u2022 ${name}${RESET}`);
      }
    }

    if (result.usedRemovedExports.length === 0 && result.usedChangedExports.length === 0) {
      console.log(`    ${GREEN}None of the changed exports are used in your codebase${RESET}`);
    }
  }
  console.log();
}

/** Print Level 3 live validation results to console. */
export function formatLevel3Results(results: readonly ValidationResult[]): void {
  if (results.length === 0) {
    console.log(`${DIM}No validation results.${RESET}\n`);
    return;
  }

  console.log(`\n${BOLD}Live validation${RESET} ${DIM}\u2014 typecheck + tests with updated deps${RESET}\n`);

  for (const result of results) {
    const dep = result.dep;
    const tcIcon = result.typecheckPassed ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;
    const testIcon = result.testsPassed ? `${GREEN}\u2713${RESET}` : `${RED}\u2717${RESET}`;

    console.log(
      `  ${BOLD}${dep.name}${RESET} ${DIM}${stripRange(dep.workspaceRange)} \u2192 ${dep.latest}${RESET}  ${tcIcon} typecheck  ${testIcon} tests`,
    );

    if (!result.typecheckPassed && result.typecheckOutput) {
      const lines = result.typecheckOutput.split("\n").slice(0, MAX_ERROR_PREVIEW_LINES);
      for (const line of lines) {
        console.log(`    ${DIM}${line}${RESET}`);
      }
    }

    if (!result.testsPassed && result.testOutput) {
      const lines = result.testOutput.split("\n").slice(0, MAX_ERROR_PREVIEW_LINES);
      for (const line of lines) {
        console.log(`    ${DIM}${line}${RESET}`);
      }
    }
  }
  console.log();
}
