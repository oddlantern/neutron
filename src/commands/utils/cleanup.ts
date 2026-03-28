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
  const checkResult = await runCheck(parsers, { quiet: true });

  if (checkResult === 0) {
    log.success(`${GREEN}All checks passed${RESET}`);
    return true;
  }

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

export async function promptNextSteps(
  parsers: ParserRegistry,
  summary: InitSummary,
): Promise<number> {
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

// ─── Tool detection and cleanup ──────────────────────────────────────────────

interface DetectedTool {
  readonly name: string;
  readonly replacement: string;
  readonly deps: readonly string[];
  readonly configs: readonly string[];
  readonly dirs: readonly string[];
}

const REPLACEABLE_TOOLS: readonly DetectedTool[] = [
  {
    name: "Husky",
    replacement: "mido install (git hooks)",
    deps: ["husky"],
    configs: [],
    dirs: [".husky"],
  },
  {
    name: "commitlint",
    replacement: "mido commit-msg (conventional commits)",
    deps: ["@commitlint/cli", "@commitlint/config-conventional", "@commitlint/config-angular"],
    configs: [
      "commitlint.config.js",
      "commitlint.config.cjs",
      "commitlint.config.ts",
      ".commitlintrc.js",
      ".commitlintrc.json",
      ".commitlintrc.yml",
    ],
    dirs: [],
  },
  {
    name: "lint-staged",
    replacement: "mido pre-commit",
    deps: ["lint-staged"],
    configs: [".lintstagedrc", ".lintstagedrc.json", ".lintstagedrc.yml", ".lintstagedrc.js"],
    dirs: [],
  },
  {
    name: "Prettier",
    replacement: "mido fmt (oxfmt, bundled)",
    deps: ["prettier"],
    configs: [
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.yml",
      ".prettierrc.yaml",
      ".prettierrc.js",
      ".prettierrc.cjs",
      "prettier.config.js",
      "prettier.config.cjs",
      ".prettierignore",
    ],
    dirs: [],
  },
  {
    name: "ESLint",
    replacement: "mido lint (oxlint, bundled)",
    deps: ["eslint"],
    configs: [
      ".eslintrc.json",
      ".eslintrc.js",
      ".eslintrc.cjs",
      ".eslintrc.yml",
      ".eslintrc.yaml",
      ".eslintrc",
      "eslint.config.js",
      "eslint.config.cjs",
      "eslint.config.mjs",
      ".eslintignore",
    ],
    dirs: [],
  },
  {
    name: "Biome",
    replacement: "mido lint + mido fmt",
    deps: ["@biomejs/biome"],
    configs: ["biome.json", "biome.jsonc"],
    dirs: [],
  },
  {
    name: "syncpack",
    replacement: "mido check --fix (version consistency)",
    deps: ["syncpack"],
    configs: [".syncpackrc", ".syncpackrc.json", ".syncpackrc.yml", ".syncpackrc.js"],
    dirs: [],
  },
  {
    name: "oxlint (standalone config)",
    replacement: "lint.typescript in mido.yml",
    deps: [],
    configs: [".oxlintrc.json", "oxlint.config.ts", "oxlint.config.js"],
    dirs: [],
  },
  {
    name: "oxfmt (standalone config)",
    replacement: "format.typescript in mido.yml",
    deps: [],
    configs: [".oxfmtrc.json", ".oxfmtrc.jsonc", ".oxfmtignore"],
    dirs: [],
  },
];

interface FoundTool {
  readonly tool: DetectedTool;
  readonly foundDeps: readonly string[];
  readonly foundConfigs: readonly string[];
  readonly foundDirs: readonly string[];
}

function detectTools(
  root: string,
  devDeps: Record<string, unknown> | undefined,
): readonly FoundTool[] {
  const found: FoundTool[] = [];

  for (const tool of REPLACEABLE_TOOLS) {
    const foundDeps = devDeps ? tool.deps.filter((d) => d in devDeps) : [];
    const foundConfigs = tool.configs.filter((c) => existsSync(join(root, c)));
    const foundDirs = tool.dirs.filter((d) => existsSync(join(root, d)));

    if (foundDeps.length > 0 || foundConfigs.length > 0 || foundDirs.length > 0) {
      found.push({ tool, foundDeps, foundConfigs, foundDirs });
    }
  }

  return found;
}

/**
 * Detect all tools that mido replaces, show a summary table,
 * and offer to remove them.
 */
export async function cleanupReplacedTooling(root: string): Promise<void> {
  const pkgJsonPath = join(root, "package.json");
  let devDeps: Record<string, unknown> | undefined;

  if (existsSync(pkgJsonPath)) {
    const raw = await readFile(pkgJsonPath, "utf-8");
    const pkg: unknown = JSON.parse(raw);
    if (isRecord(pkg)) {
      const devDepsRaw = pkg["devDependencies"];
      devDeps = isRecord(devDepsRaw) ? devDepsRaw : undefined;
    }
  }

  const found = detectTools(root, devDeps);
  if (found.length === 0) {
    return;
  }

  // Show the replacement table
  const tableLines = found.map((f) => {
    const items: string[] = [
      ...f.foundDeps.map((d) => `dep: ${d}`),
      ...f.foundConfigs,
      ...f.foundDirs.map((d) => `${d}/`),
    ];
    return `  ${ORANGE}${f.tool.name}${RESET} ${DIM}→ ${f.tool.replacement}${RESET}\n    ${DIM}found: ${items.join(", ")}${RESET}`;
  });

  note(
    tableLines.join("\n\n"),
    `${ORANGE}${BOLD}mido replaces ${found.length} tool(s)${RESET}`,
  );

  const cleanup = await confirm({
    message: "Remove replaced tools? (configs, devDependencies, directories)",
    initialValue: true,
  });
  if (isCancel(cleanup)) {
    handleCancel();
  }

  if (!cleanup) {
    return;
  }

  // Collect all deps and configs to remove
  const allDeps: string[] = [];
  const allConfigs: string[] = [];
  const allDirs: string[] = [];

  for (const f of found) {
    allDeps.push(...f.foundDeps);
    allConfigs.push(...f.foundConfigs);
    allDirs.push(...f.foundDirs);
  }

  // Remove config files
  for (const config of allConfigs) {
    const filePath = join(root, config);
    if (existsSync(filePath)) {
      await unlink(filePath);
      log.step(`Removed ${config}`);
    }
  }

  // Remove directories
  for (const dir of allDirs) {
    const dirPath = join(root, dir);
    if (existsSync(dirPath)) {
      await rm(dirPath, { recursive: true });
      log.step(`Removed ${dir}/`);
    }
  }

  // Remove lint-staged config from package.json if inline
  if (existsSync(pkgJsonPath)) {
    const raw = await readFile(pkgJsonPath, "utf-8");
    const pkg: unknown = JSON.parse(raw);
    if (isRecord(pkg) && "lint-staged" in pkg) {
      delete pkg["lint-staged"];
      await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
      log.step("Removed lint-staged config from package.json");
    }
  }

  // Uninstall devDependencies
  if (allDeps.length > 0) {
    const cmd = detectRemoveCommand(root);
    const full = `${cmd} ${allDeps.join(" ")}`;
    log.step(`$ ${full}`);
    const parts = cmd.split(" ");
    const bin = parts[0];
    const baseArgs = parts.slice(1);
    if (bin) {
      spawnSync(bin, [...baseArgs, ...allDeps], { cwd: root, stdio: "inherit" });
    }
  }

  // Update prepare script
  if (existsSync(pkgJsonPath)) {
    const freshRaw = await readFile(pkgJsonPath, "utf-8");
    const freshPkg: unknown = JSON.parse(freshRaw);
    if (isRecord(freshPkg)) {
      const scriptsRaw = freshPkg["scripts"];
      const scripts = isRecord(scriptsRaw) ? scriptsRaw : undefined;

      if (scripts && typeof scripts["prepare"] === "string") {
        const prepare = scripts["prepare"];
        if (prepare === "husky" || prepare === "husky install") {
          scripts["prepare"] = "mido init && mido generate";
          await writeFile(pkgJsonPath, JSON.stringify(freshPkg, null, 2) + "\n", "utf-8");
          log.step('Updated scripts.prepare → "mido init && mido generate"');
        }
      }
    }
  }

  log.success(`Removed ${allConfigs.length + allDirs.length} config(s) and ${allDeps.length} dep(s)`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
