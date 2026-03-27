import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { confirm, isCancel, log, note, outro, select } from "@clack/prompts";

import { loadConfig } from "../../config/loader.js";
import { BOLD, DIM, GREEN, ORANGE, RESET } from "../../output.js";
import { runCheck } from "../check.js";
import type { ParserRegistry } from "../../graph/workspace.js";
import { isRecord } from "../../guards.js";
import { type InitSummary, CONFIG_FILENAME, handleCancel } from "./shared.js";

// ─── Post-init health check ─────────────────────────────────────────────────

export async function runPostInitCheck(parsers: ParserRegistry): Promise<boolean> {
  // Run check quietly to detect issues
  const checkResult = await runCheck(parsers, { quiet: true });

  if (checkResult === 0) {
    log.success(`${GREEN}All checks passed${RESET}`);
    return true;
  }

  // There are failures — check specifically for version mismatches
  const { config, root } = await loadConfig();
  const { buildWorkspaceGraph } = await import("../../graph/workspace.js");
  const { findVersionMismatches } = await import("../../checks/versions.js");
  const { loadLock } = await import("../../lock.js");

  const graph = await buildWorkspaceGraph(config, root, parsers);
  const lock = await loadLock(root);
  const mismatches = findVersionMismatches(graph, lock);

  if (mismatches.length === 0) {
    log.warn(
      `${DIM}Some checks failed. Run${RESET} ${BOLD}mido check${RESET} ${DIM}to see details.${RESET}`,
    );
    return false;
  }

  const fix = await confirm({
    message: `Found ${mismatches.length} version mismatch(es). Fix now?`,
    initialValue: true,
  });
  if (isCancel(fix)) {
    handleCancel();
  }

  if (fix) {
    const fixResult = await runCheck(parsers, { fix: true });
    return fixResult === 0;
  }

  return false;
}

// ─── Next steps ──────────────────────────────────────────────────────────────

const HELP_LINES = [
  `${BOLD}mido dev${RESET}              ${DIM}Watch bridges and regenerate on changes${RESET}`,
  `${BOLD}mido check${RESET}            ${DIM}Run all workspace consistency checks${RESET}`,
  `${BOLD}mido check --fix${RESET}      ${DIM}Interactively resolve version mismatches${RESET}`,
  `${BOLD}mido install${RESET}          ${DIM}Install git hooks${RESET}`,
].join("\n");

/**
 * Show a celebratory summary and next-steps menu after init completes.
 * Returns the exit code from the chosen action.
 */
export async function promptNextSteps(
  parsers: ParserRegistry,
  summary: InitSummary,
): Promise<number> {
  // Build a styled summary of what was created
  const summaryLines: string[] = [];
  summaryLines.push(`${GREEN}${BOLD}${CONFIG_FILENAME}${RESET} ${DIM}written${RESET}`);
  summaryLines.push(
    `${DIM}${summary.packageCount} package(s) across ${summary.ecosystemCount} ecosystem(s)${RESET}`,
  );
  if (summary.bridgeCount > 0) {
    summaryLines.push(`${ORANGE}${summary.bridgeCount}${RESET} ${DIM}bridge(s) configured${RESET}`);
  }
  if (summary.hooksInstalled) {
    summaryLines.push(`${DIM}git hooks installed${RESET}`);
  }
  if (summary.checksPass) {
    summaryLines.push(`${GREEN}all checks passed${RESET}`);
  }

  note(summaryLines.join("\n"), `${ORANGE}${BOLD}Workspace ready${RESET}`);

  const next = await select({
    message: "What's next?",
    options: [
      { value: "dev", label: "Start watching", hint: "mido dev" },
      { value: "check", label: "Check workspace health", hint: "mido check" },
      { value: "help", label: "View help", hint: "mido help" },
      { value: "exit", label: "Exit" },
    ],
  });

  if (isCancel(next)) {
    outro(`${DIM}Happy coding!${RESET}`);
    return 0;
  }

  switch (next) {
    case "dev": {
      outro(`${ORANGE}Starting watcher...${RESET}`);
      const { runDev } = await import("../../watcher/dev.js");
      return runDev(parsers, {});
    }
    case "check": {
      outro(`${ORANGE}Running checks...${RESET}`);
      return runCheck(parsers, {});
    }
    case "help": {
      note(HELP_LINES, `${ORANGE}${BOLD}Commands${RESET}`);
      outro(`${DIM}Happy coding!${RESET}`);
      return 0;
    }
    case "exit":
    default: {
      outro(`${DIM}Happy coding!${RESET}`);
      return 0;
    }
  }
}

// ─── Cleanup replaced tooling ────────────────────────────────────────────────

const HUSKY_DEPS = ["husky", "@commitlint/cli", "@commitlint/config-conventional"];
const COMMITLINT_CONFIGS = ["commitlint.config.js", ".commitlintrc.js", ".commitlintrc.json"];

const LOCKFILE_TO_REMOVE_CMD: ReadonlyMap<string, string> = new Map([
  ["bun.lock", "bun remove"],
  ["bun.lockb", "bun remove"],
  ["pnpm-lock.yaml", "pnpm remove"],
  ["yarn.lock", "yarn remove"],
  ["package-lock.json", "npm uninstall"],
]);

function detectRemoveCommand(root: string): string {
  for (const [lockfile, cmd] of LOCKFILE_TO_REMOVE_CMD) {
    if (existsSync(join(root, lockfile))) {
      return cmd;
    }
  }
  return "npm uninstall";
}

export async function cleanupReplacedTooling(root: string): Promise<void> {
  const huskyDir = join(root, ".husky");
  if (existsSync(huskyDir)) {
    const answer = await confirm({
      message: "mido replaces Husky. Remove .husky/ directory?",
      initialValue: true,
    });
    if (isCancel(answer)) {
      handleCancel();
    }
    if (answer) {
      await rm(huskyDir, { recursive: true });
      log.step("Removed .husky/");
    }
  }

  const foundConfigs: string[] = [];
  for (const name of COMMITLINT_CONFIGS) {
    if (existsSync(join(root, name))) {
      foundConfigs.push(name);
    }
  }

  if (foundConfigs.length > 0) {
    const answer = await confirm({
      message: "mido replaces commitlint. Remove commitlint config?",
      initialValue: true,
    });
    if (isCancel(answer)) {
      handleCancel();
    }
    if (answer) {
      for (const name of foundConfigs) {
        await unlink(join(root, name));
        log.step(`Removed ${name}`);
      }
    }
  }

  const pkgJsonPath = join(root, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return;
  }

  const pkgRaw = await readFile(pkgJsonPath, "utf-8");
  const pkg: unknown = JSON.parse(pkgRaw);
  if (!isRecord(pkg)) {
    return;
  }
  const devDepsRaw = pkg["devDependencies"];
  const devDeps = isRecord(devDepsRaw) ? devDepsRaw : undefined;

  const depsToRemove = devDeps ? HUSKY_DEPS.filter((d) => d in devDeps) : [];

  if (depsToRemove.length > 0) {
    const answer = await confirm({
      message: "Remove Husky and commitlint from devDependencies?",
      initialValue: true,
    });
    if (isCancel(answer)) {
      handleCancel();
    }
    if (answer) {
      const cmd = detectRemoveCommand(root);
      const full = `${cmd} ${depsToRemove.join(" ")}`;
      log.step(`$ ${full}`);
      const parts = cmd.split(" ");
      const bin = parts[0];
      const baseArgs = parts.slice(1);
      if (bin) {
        spawnSync(bin, [...baseArgs, ...depsToRemove], { cwd: root, stdio: "inherit" });
      }
    }
  }

  // Re-read package.json in case it was modified by the uninstall step
  if (!existsSync(pkgJsonPath)) {
    return;
  }

  const freshRaw = await readFile(pkgJsonPath, "utf-8");
  const freshPkg: unknown = JSON.parse(freshRaw);
  if (!isRecord(freshPkg)) {
    return;
  }
  const scriptsRaw = freshPkg["scripts"];
  const scripts = isRecord(scriptsRaw) ? scriptsRaw : undefined;

  if (scripts && scripts["prepare"] === "husky") {
    scripts["prepare"] = "mido install";
    await writeFile(pkgJsonPath, JSON.stringify(freshPkg, null, 2) + "\n", "utf-8");
    log.step('Updated scripts.prepare \u2192 "mido install"');
  }
}
