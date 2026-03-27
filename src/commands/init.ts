import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readFile, rm, unlink, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  path as clackPath,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { Document, isMap, isScalar } from "yaml";

import {
  DART_FORMAT_DEFAULTS,
  DEFAULT_IGNORE,
  LINT_CATEGORY_DEFAULTS,
  OXFMT_DEFAULTS,
} from "../config/defaults.js";
import type { MidoConfig } from "../config/schema.js";
import { loadConfig } from "../config/loader.js";
import { scanRepo, type DiscoveredPackage } from "../discovery/scanner.js";
import { detectBridges, detectEnvFiles, type BridgeCandidate } from "../discovery/heuristics.js";
import { printBanner } from "../banner.js";
import { BOLD, DIM, GREEN, ORANGE, RESET } from "../output.js";
import { runCheck } from "./check.js";
import type { ParserRegistry } from "../graph/workspace.js";
import { loadPlugins } from "../plugins/loader.js";
import { PluginRegistry } from "../plugins/registry.js";
import type { WatchPathSuggestion } from "../plugins/types.js";
import { isRecord } from "../guards.js";
import { mergeMigratedConfig, migrateLintFormatConfig } from "./migrate.js";

const CONFIG_FILENAME = "mido.yml";

interface EcosystemGroup {
  readonly manifest: string;
  readonly packages: readonly string[];
}

interface BridgeWithWatch {
  readonly source: string;
  readonly consumers: readonly string[];
  readonly artifact: string;
  readonly watch: readonly string[] | undefined;
}

class CancelError extends Error {
  constructor() {
    super("Aborted.");
    this.name = "CancelError";
  }
}

function handleCancel(): never {
  cancel("Aborted.");
  throw new CancelError();
}

/**
 * Interactive setup that scans the repo and generates mido.yml.
 * If mido.yml already exists, runs reconciliation mode instead.
 *
 * @returns exit code (0 = success, 1 = error)
 */
export async function runInit(root: string, parsers: ParserRegistry): Promise<number> {
  const configPath = join(root, CONFIG_FILENAME);

  if (existsSync(configPath)) {
    return runReconciliation(root, configPath, parsers);
  }

  return runFirstTime(root, configPath, parsers);
}

// ─── First-time init ────────────────────────────────────────────────────────

async function runFirstTime(
  root: string,
  configPath: string,
  parsers: ParserRegistry,
): Promise<number> {
  printBanner();
  intro("mido init");

  const s = spinner();
  s.start("Scanning repo...");
  const discovered = scanRepo(root);
  s.stop("Scan complete");

  if (discovered.length === 0) {
    log.error("No ecosystem packages found. Nothing to configure.");
    return 1;
  }

  const supported = discovered.filter((p) => p.supported);
  const unsupported = discovered.filter((p) => !p.supported);

  if (unsupported.length > 0) {
    for (const pkg of unsupported) {
      log.warn(`${pkg.ecosystem} detected at ${pkg.path} (not yet supported)`);
    }
  }

  if (supported.length === 0) {
    log.error("No supported ecosystem packages found.");
    return 1;
  }

  // Group by ecosystem and display
  const ecosystems = groupByEcosystem(supported);
  const packageLines = formatEcosystemList(ecosystems);
  log.info(
    `Found ${supported.length} packages across ${Object.keys(ecosystems).length} ecosystems:\n${packageLines}`,
  );

  // Confirm or adjust packages
  const adjustPackages = await select({
    message: "Confirm packages?",
    options: [
      { value: "yes", label: "Yes, looks correct" },
      { value: "adjust", label: "Let me adjust" },
    ],
  });
  if (isCancel(adjustPackages)) {
    handleCancel();
  }

  let finalSupported = supported;
  if (adjustPackages === "adjust") {
    const selected = await multiselect({
      message: "Select packages to include:",
      options: supported.map((p) => ({
        value: p.path,
        label: p.path,
        hint: p.ecosystem,
      })),
      initialValues: supported.map((p) => p.path),
      required: true,
    });
    if (isCancel(selected)) {
      handleCancel();
    }
    const selectedSet = new Set(selected);
    finalSupported = supported.filter((p) => selectedSet.has(p.path));
  }

  const finalEcosystems = groupByEcosystem(finalSupported);

  // Detect bridges
  const detectedBridges: BridgeCandidate[] = [...(await detectBridges(root, finalSupported))];

  if (detectedBridges.length > 0) {
    const bridgeLines = detectedBridges
      .map(
        (b) =>
          `  ${ORANGE}${b.source}${RESET} ${DIM}\u2192${RESET} ${ORANGE}[${b.consumers.join(", ")}]${RESET} ${DIM}via${RESET} ${BOLD}${b.artifact}${RESET}`,
      )
      .join("\n");
    log.info(`Detected ${ORANGE}${detectedBridges.length}${RESET} bridge(s):\n${bridgeLines}`);
  }

  // Load plugins to get watch path suggestions
  const { ecosystem, domain } = loadPlugins();
  const pluginRegistry = new PluginRegistry(ecosystem, domain);

  // Build a temporary package map for plugin suggestions
  const tmpPackageMap = buildPackageMap(finalSupported);

  // Prompt for watch paths on detected bridges (with plugin suggestions)
  const bridgesWithWatch: BridgeWithWatch[] = [];
  for (const b of detectedBridges) {
    const sourcePackage = tmpPackageMap.get(b.source);
    let suggestion: WatchPathSuggestion | null = null;
    if (sourcePackage) {
      suggestion = await pluginRegistry.suggestWatchPaths(
        sourcePackage,
        b.artifact,
        tmpPackageMap,
        root,
      );
    }
    const watch = await promptWatchPaths(root, b.source, suggestion);
    bridgesWithWatch.push({
      source: b.source,
      consumers: b.consumers,
      artifact: b.artifact,
      watch,
    });
  }

  // Prompt for additional bridges (includes watch prompt)
  const manualBridges = await promptAdditionalBridges(
    root,
    finalSupported.map((p) => p.path),
  );
  bridgesWithWatch.push(...manualBridges);

  // Detect env files
  const MIN_ENV_FILES_FOR_PARITY = 2;
  const envFiles = detectEnvFiles(root, finalSupported);
  if (envFiles.length >= MIN_ENV_FILES_FOR_PARITY) {
    const envLines = envFiles.map((e) => `  ${e.path}`).join("\n");
    log.info(`Env files:\n${envLines}`);
  }

  // Workspace name
  const dirName = root.split("/").pop() ?? "workspace";
  const nameResult = await text({
    message: "Workspace name:",
    placeholder: dirName,
    defaultValue: dirName,
  });
  if (isCancel(nameResult)) {
    handleCancel();
  }
  const name = nameResult || dirName;

  // Migrate existing lint/format config files
  const migratedToolConfig = await migrateLintFormatConfig(root, handleCancel);

  // Build and write config
  const config = buildConfigObject(name, finalEcosystems, bridgesWithWatch, envFiles);
  mergeMigratedConfig(config, migratedToolConfig);
  const yaml = renderYaml(config);
  await writeFile(configPath, yaml, "utf-8");
  log.success(`${ORANGE}${CONFIG_FILENAME}${RESET} written`);

  // Offer hooks
  const installHooks = await confirm({ message: "Install git hooks?", initialValue: true });
  if (isCancel(installHooks)) {
    handleCancel();
  }

  let hooksInstalled = false;
  if (installHooks) {
    const { runInstall } = await import("./install.js");
    const installResult = await runInstall(root);
    if (installResult !== 0) {
      return installResult;
    }
    hooksInstalled = true;
  }

  // Clean up replaced tooling
  await cleanupReplacedTooling(root);

  // Run health check and offer to fix mismatches
  const checksPass = await runPostInitCheck(parsers);

  return promptNextSteps(parsers, {
    packageCount: finalSupported.length,
    ecosystemCount: Object.keys(finalEcosystems).length,
    bridgeCount: bridgesWithWatch.length,
    hooksInstalled,
    checksPass,
  });
}

// ─── Reconciliation mode ────────────────────────────────────────────────────

async function runReconciliation(
  root: string,
  configPath: string,
  parsers: ParserRegistry,
): Promise<number> {
  printBanner();
  intro("mido init \u2014 reconciling with existing config");

  const s = spinner();
  s.start("Scanning repo and comparing with mido.yml...");

  const discovered = scanRepo(root);
  const supported = discovered.filter((p) => p.supported);

  let existing: MidoConfig;
  try {
    const loaded = await loadConfig(root);
    existing = loaded.config;
  } catch {
    s.stop("Failed to load existing config");
    log.error(`Could not parse existing ${CONFIG_FILENAME}. Delete it and run init again.`);
    return 1;
  }

  s.stop("Scan complete");

  // Load plugins for watch path suggestions
  const { ecosystem, domain } = loadPlugins();
  const pluginRegistry = new PluginRegistry(ecosystem, domain);
  const reconPackageMap = buildPackageMap(supported);

  // Build set of existing package paths
  const existingPaths = new Set<string>();
  const existingEcosystemForPath = new Map<string, string>();
  for (const [eco, group] of Object.entries(existing.ecosystems)) {
    for (const pkg of group.packages) {
      existingPaths.add(pkg);
      existingEcosystemForPath.set(pkg, eco);
    }
  }

  const discoveredPaths = new Set(supported.map((p) => p.path));

  // Categorise packages
  const kept: string[] = [];
  const newPackages: DiscoveredPackage[] = [];
  const missing: string[] = [];

  for (const pkg of supported) {
    if (existingPaths.has(pkg.path)) {
      kept.push(pkg.path);
    } else {
      newPackages.push(pkg);
    }
  }

  for (const path of existingPaths) {
    if (!discoveredPaths.has(path)) {
      missing.push(path);
    }
  }

  // Display status
  const statusLines: string[] = [];
  for (const path of kept) {
    const eco = existingEcosystemForPath.get(path) ?? "";
    statusLines.push(`  ${GREEN}\u2713${RESET} ${path} ${DIM}(${eco})${RESET}`);
  }
  for (const pkg of newPackages) {
    statusLines.push(
      `  ${ORANGE}+${RESET} ${ORANGE}${pkg.path}${RESET} ${DIM}(${pkg.ecosystem})${RESET} ${ORANGE}\u2190 NEW${RESET}`,
    );
  }
  for (const path of missing) {
    const eco = existingEcosystemForPath.get(path) ?? "";
    statusLines.push(`  ${DIM}\u26A0 ${path} (${eco}) \u2190 NOT FOUND ON DISK${RESET}`);
  }
  log.info(`Packages:\n${statusLines.join("\n")}`);

  let configChanged = false;

  // Handle new packages
  for (const pkg of newPackages) {
    const add = await confirm({
      message: `${pkg.path} detected. Add to config?`,
      initialValue: true,
    });
    if (isCancel(add)) {
      handleCancel();
    }
    if (add) {
      addPackageToConfig(existing, pkg);
      configChanged = true;
    }
  }

  // Handle missing packages
  for (const path of missing) {
    const remove = await confirm({
      message: `${path} not found on disk. Remove from config?`,
      initialValue: true,
    });
    if (isCancel(remove)) {
      handleCancel();
    }
    if (remove) {
      removePackageFromConfig(existing, path);
      configChanged = true;
    }
  }

  // Handle existing bridges
  const existingBridges = (existing.bridges ?? []).map((b) => ({
    ...b,
    consumers: b.consumers ?? (b.target ? [b.target] : []),
  }));
  const updatedBridges: BridgeWithWatch[] = [];

  for (const bridge of existingBridges) {
    const action = await select({
      message: `Bridge: ${bridge.source} produces ${basename(bridge.artifact)}, consumed by [${bridge.consumers.join(", ")}]`,
      options: [
        { value: "keep", label: "Keep" },
        { value: "modify", label: "Modify" },
        { value: "remove", label: "Remove" },
      ],
    });
    if (isCancel(action)) {
      handleCancel();
    }

    if (action === "keep") {
      // If bridge has no watch paths, offer to add them (with plugin suggestion)
      if (!bridge.watch?.length) {
        const sourcePackage = reconPackageMap.get(bridge.source);
        let reconSuggestion: WatchPathSuggestion | null = null;
        if (sourcePackage) {
          reconSuggestion = await pluginRegistry.suggestWatchPaths(
            sourcePackage,
            bridge.artifact,
            reconPackageMap,
            root,
          );
        }

        if (reconSuggestion) {
          // Plugin has a suggestion — show the full watch path menu
          const watch = await promptWatchPaths(root, bridge.source, reconSuggestion);
          if (watch) {
            updatedBridges.push({
              source: bridge.source,
              consumers: bridge.consumers,
              artifact: bridge.artifact,
              watch: [...watch],
            });
            configChanged = true;
          } else {
            updatedBridges.push({
              source: bridge.source,
              consumers: bridge.consumers,
              artifact: bridge.artifact,
              watch: bridge.watch ? [...bridge.watch] : undefined,
            });
          }
        } else {
          // No suggestion — ask if they want to add paths manually
          const addWatch = await confirm({
            message: "Add watch paths for this bridge?",
            initialValue: false,
          });
          if (isCancel(addWatch)) {
            handleCancel();
          }
          if (addWatch) {
            const watch = await promptWatchPaths(root, bridge.source);
            if (watch) {
              updatedBridges.push({
                source: bridge.source,
                consumers: bridge.consumers,
                artifact: bridge.artifact,
                watch: [...watch],
              });
              configChanged = true;
            } else {
              updatedBridges.push({
                source: bridge.source,
                consumers: bridge.consumers,
                artifact: bridge.artifact,
                watch: bridge.watch ? [...bridge.watch] : undefined,
              });
            }
          } else {
            updatedBridges.push({
              source: bridge.source,
              consumers: bridge.consumers,
              artifact: bridge.artifact,
              watch: bridge.watch ? [...bridge.watch] : undefined,
            });
          }
        }
      } else {
        updatedBridges.push({
          source: bridge.source,
          consumers: bridge.consumers,
          artifact: bridge.artifact,
          watch: bridge.watch ? [...bridge.watch] : undefined,
        });
      }
    } else if (action === "modify") {
      const modified = await promptModifyBridge(
        root,
        existing,
        bridge,
        pluginRegistry,
        reconPackageMap,
      );
      if (modified) {
        updatedBridges.push(modified);
        configChanged = true;
      } else {
        updatedBridges.push({
          source: bridge.source,
          consumers: bridge.consumers,
          artifact: bridge.artifact,
          watch: bridge.watch ? [...bridge.watch] : undefined,
        });
      }
    } else {
      configChanged = true;
    }
  }

  // Prompt for additional bridges
  const allPaths = getAllPackagePaths(existing);
  const manualBridges = await promptAdditionalBridges(root, allPaths);
  if (manualBridges.length > 0) {
    configChanged = true;
    for (const b of manualBridges) {
      updatedBridges.push({
        source: b.source,
        consumers: [...b.consumers],
        artifact: b.artifact,
        watch: b.watch?.length ? [...b.watch] : undefined,
      });
    }
  }

  // Convert to mutable plain object for further mutations
  const mutable = configToObject(existing);

  // Update bridges in config
  if (configChanged || updatedBridges.length !== existingBridges.length) {
    mutable["bridges"] = updatedBridges.length > 0 ? updatedBridges : undefined;
    configChanged = true;
  }

  // Migrate existing lint/format config files
  const migratedToolConfig = await migrateLintFormatConfig(root, handleCancel);
  if (migratedToolConfig.lint || migratedToolConfig.format) {
    mergeMigratedConfig(mutable, migratedToolConfig);
    configChanged = true;
  }

  // Write if changed
  if (configChanged) {
    const yaml = renderYaml(mutable);
    await writeFile(configPath, yaml, "utf-8");
    log.success("Config updated");
  } else {
    log.success("No changes needed");
  }

  // Offer hooks
  const installHooks = await confirm({ message: "Install git hooks?", initialValue: true });
  if (isCancel(installHooks)) {
    handleCancel();
  }

  let hooksInstalled = false;
  if (installHooks) {
    const { runInstall } = await import("./install.js");
    const installResult = await runInstall(root, existing);
    if (installResult !== 0) {
      return installResult;
    }
    hooksInstalled = true;
  }

  // Run health check and offer to fix mismatches
  const checksPass = await runPostInitCheck(parsers);

  // Count packages and ecosystems from the final config
  let totalPackages = 0;
  for (const group of Object.values(existing.ecosystems)) {
    totalPackages += group.packages.length;
  }

  return promptNextSteps(parsers, {
    packageCount: totalPackages,
    ecosystemCount: Object.keys(existing.ecosystems).length,
    bridgeCount: updatedBridges.length,
    hooksInstalled,
    checksPass,
  });
}

// ─── Post-init health check ─────────────────────────────────────────────────

async function runPostInitCheck(parsers: ParserRegistry): Promise<boolean> {
  // Run check quietly to detect issues
  const checkResult = await runCheck(parsers, { quiet: true });

  if (checkResult === 0) {
    log.success(`${GREEN}All checks passed${RESET}`);
    return true;
  }

  // There are failures — check specifically for version mismatches
  const { config, root } = await loadConfig();
  const { buildWorkspaceGraph } = await import("../graph/workspace.js");
  const { findVersionMismatches } = await import("../checks/versions.js");
  const { loadLock } = await import("../lock.js");

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
async function promptNextSteps(parsers: ParserRegistry, summary: InitSummary): Promise<number> {
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
      const { runDev } = await import("../watcher/dev.js");
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

interface InitSummary {
  readonly packageCount: number;
  readonly ecosystemCount: number;
  readonly bridgeCount: number;
  readonly hooksInstalled: boolean;
  readonly checksPass: boolean;
}

// ─── Bridge prompts ─────────────────────────────────────────────────────────

async function promptWatchPaths(
  root: string,
  source: string,
  suggestion?: WatchPathSuggestion | null,
  currentWatch?: readonly string[] | null,
): Promise<readonly string[] | undefined> {
  const defaultWatch = `${source}/**`;

  // Build options: plugin suggestion first (if available), then browse/manual/skip
  type WatchChoice = "suggestion" | "browse" | "manual" | "skip";
  const options: Array<{ value: WatchChoice; label: string; hint?: string }> = [];

  if (suggestion) {
    const suggestedLabel = suggestion.paths.join(", ");
    options.push({
      value: "suggestion",
      label: suggestedLabel,
      hint: `detected: ${suggestion.reason}`,
    });
  }

  // "Skip" shows current watch paths if they exist, otherwise the default
  const skipHint = currentWatch?.length
    ? `keep: ${currentWatch.join(", ")}`
    : `default: ${defaultWatch}`;

  options.push(
    { value: "browse", label: "Browse for a different path" },
    { value: "manual", label: "Enter manually" },
    { value: "skip", label: "Skip", hint: skipHint },
  );

  const choice = await select({
    message: "Watch paths for this bridge:",
    options,
    initialValue: suggestion
      ? ("suggestion" satisfies WatchChoice)
      : ("browse" satisfies WatchChoice),
  });
  if (isCancel(choice)) {
    handleCancel();
  }

  switch (choice) {
    case "suggestion": {
      return suggestion?.paths;
    }
    case "browse": {
      const browsed = await clackPath({
        message: "Select directory to watch:",
        root,
        directory: true,
      });
      if (isCancel(browsed)) {
        handleCancel();
      }
      const relPath = relative(root, join(root, browsed));
      return [`${relPath}/**`];
    }
    case "manual": {
      const entered = await text({
        message: "Watch paths (comma-separated globs):",
        placeholder: defaultWatch,
      });
      if (isCancel(entered)) {
        handleCancel();
      }
      if (!entered) {
        return undefined;
      }
      return entered
        .split(/[,\s]+/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    }
    case "skip":
    default: {
      // Preserve existing watch paths if available
      return currentWatch?.length ? currentWatch : undefined;
    }
  }
}

async function promptModifyBridge(
  root: string,
  config: MidoConfig,
  current: {
    readonly source: string;
    readonly consumers: readonly string[];
    readonly artifact: string;
    readonly watch?: readonly string[] | undefined;
  },
  pluginRegistry?: PluginRegistry,
  packageMap?: ReadonlyMap<string, import("../graph/types.js").WorkspacePackage>,
): Promise<BridgeWithWatch | null> {
  const allPaths = getAllPackagePaths(config);

  const source = await select({
    message: `Source (currently: ${current.source}):`,
    options: allPaths.map((p) => ({ value: p, label: p })),
    initialValue: current.source,
  });
  if (isCancel(source)) {
    handleCancel();
  }

  const consumerPaths = allPaths.filter((p) => p !== source);
  const consumers = await multiselect({
    message: `Consumers (currently: [${current.consumers.join(", ")}]):`,
    options: consumerPaths.map((p) => ({
      value: p,
      label: p,
      selected: current.consumers.includes(p),
    })),
    required: true,
  });
  if (isCancel(consumers)) {
    handleCancel();
  }

  const artifact = await clackPath({
    message: `Artifact (currently: ${current.artifact}):`,
    root,
    initialValue: current.artifact,
  });
  if (isCancel(artifact)) {
    handleCancel();
  }

  // Make artifact relative to root
  const relArtifact = relative(root, join(root, artifact));

  // Get plugin suggestion for the (possibly changed) source
  let modifySuggestion: WatchPathSuggestion | null = null;
  if (pluginRegistry && packageMap) {
    const sourcePkg = packageMap.get(source);
    if (sourcePkg) {
      modifySuggestion = await pluginRegistry.suggestWatchPaths(
        sourcePkg,
        relArtifact,
        packageMap,
        root,
      );
    }
  }

  const watch = await promptWatchPaths(root, source, modifySuggestion, current.watch);

  return { source, consumers, artifact: relArtifact, watch };
}

async function promptAdditionalBridges(
  root: string,
  packagePaths: readonly string[],
): Promise<BridgeWithWatch[]> {
  const result: BridgeWithWatch[] = [];

  const addMore = await confirm({ message: "Any additional bridges?", initialValue: false });
  if (isCancel(addMore)) {
    handleCancel();
  }
  if (!addMore) {
    return result;
  }

  let adding = true;
  while (adding) {
    const source = await select({
      message: "Source (who generates the file):",
      options: packagePaths.map((p) => ({ value: p, label: p })),
    });
    if (isCancel(source)) {
      handleCancel();
    }

    const consumerPaths = packagePaths.filter((p) => p !== source);
    const consumers = await multiselect({
      message: "Consumers (who depends on it):",
      options: consumerPaths.map((p) => ({ value: p, label: p })),
      required: true,
    });
    if (isCancel(consumers)) {
      handleCancel();
    }

    const artifact = await clackPath({
      message: "Artifact (shared file, e.g. openapi.json):",
      root,
    });
    if (isCancel(artifact)) {
      handleCancel();
    }

    const relArtifact = relative(root, join(root, artifact));

    // Validate artifact
    const fullArtifactPath = join(root, relArtifact);
    if (existsSync(fullArtifactPath)) {
      try {
        if (statSync(fullArtifactPath).isDirectory()) {
          log.warn("Artifact must be a file, not a directory. Skipping bridge.");
          const retry = await confirm({ message: "Add another bridge?", initialValue: false });
          if (isCancel(retry)) {
            handleCancel();
          }
          adding = retry;
          continue;
        }
      } catch {
        // stat failed
      }
    } else {
      const proceed = await confirm({
        message: "File not found — it may not be generated yet. Continue?",
        initialValue: false,
      });
      if (isCancel(proceed)) {
        handleCancel();
      }
      if (!proceed) {
        const retry = await confirm({ message: "Add another bridge?", initialValue: false });
        if (isCancel(retry)) {
          handleCancel();
        }
        adding = retry;
        continue;
      }
    }

    const watch = await promptWatchPaths(root, source);
    result.push({ source, consumers, artifact: relArtifact, watch });
    log.step(
      `Bridge: ${ORANGE}${source}${RESET} ${DIM}\u2192${RESET} ${ORANGE}[${consumers.join(", ")}]${RESET} ${DIM}via${RESET} ${BOLD}${relArtifact}${RESET}`,
    );

    const another = await confirm({ message: "Add another bridge?", initialValue: false });
    if (isCancel(another)) {
      handleCancel();
    }
    adding = another;
  }

  return result;
}

// ─── Package map helper ─────────────────────────────────────────────────────

/**
 * Build a lightweight WorkspacePackage map from discovered packages.
 * Used during init to provide context to plugin watch path suggestions
 * before the full workspace graph is built.
 */
function buildPackageMap(
  packages: readonly DiscoveredPackage[],
): ReadonlyMap<string, import("../graph/types.js").WorkspacePackage> {
  const map = new Map<string, import("../graph/types.js").WorkspacePackage>();

  for (const pkg of packages) {
    map.set(pkg.path, {
      name: pkg.path.split("/").pop() ?? pkg.path,
      path: pkg.path,
      ecosystem: pkg.ecosystem,
      version: undefined,
      dependencies: [],
      localDependencies: [],
    });
  }

  return map;
}

// ─── Config helpers ─────────────────────────────────────────────────────────

function getAllPackagePaths(config: MidoConfig): string[] {
  const paths: string[] = [];
  for (const group of Object.values(config.ecosystems)) {
    paths.push(...group.packages);
  }
  return paths.sort();
}

function addPackageToConfig(config: MidoConfig, pkg: DiscoveredPackage): void {
  const eco = config.ecosystems[pkg.ecosystem];
  if (eco) {
    config.ecosystems[pkg.ecosystem] = {
      ...eco,
      packages: [...eco.packages, pkg.path].sort(),
    };
  } else {
    const manifestNames: Record<string, string> = {
      typescript: "package.json",
      dart: "pubspec.yaml",
    };
    config.ecosystems[pkg.ecosystem] = {
      manifest: manifestNames[pkg.ecosystem] ?? pkg.manifest,
      packages: [pkg.path],
    };
  }
}

function removePackageFromConfig(config: MidoConfig, path: string): void {
  for (const [ecoName, group] of Object.entries(config.ecosystems)) {
    if (!group.packages.includes(path)) {
      continue;
    }
    const remaining = group.packages.filter((p) => p !== path);
    // Remove ecosystem if no packages left
    if (remaining.length === 0) {
      delete config.ecosystems[ecoName];
    } else {
      config.ecosystems[ecoName] = { ...group, packages: remaining };
    }
    return;
  }
}

function configToObject(config: MidoConfig): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    workspace: config.workspace,
    ecosystems: config.ecosystems,
  };
  if (config.bridges && config.bridges.length > 0) {
    obj["bridges"] = config.bridges;
  }
  if (config.env) {
    obj["env"] = config.env;
  }
  if (config.commits) {
    obj["commits"] = config.commits;
  }
  if (config.lint) {
    obj["lint"] = config.lint;
  }
  if (config.format) {
    obj["format"] = config.format;
  }
  return obj;
}

function buildConfigObject(
  name: string,
  ecosystems: Record<string, EcosystemGroup>,
  bridges: readonly BridgeWithWatch[],
  envFiles: readonly { readonly path: string }[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    workspace: name,
    ecosystems,
  };

  if (bridges.length > 0) {
    config["bridges"] = bridges.map((b) => {
      const entry: Record<string, unknown> = {
        source: b.source,
        artifact: b.artifact,
        consumers: [...b.consumers],
      };
      if (b.watch?.length) {
        entry["watch"] = b.watch;
      }
      return entry;
    });
  }

  if (envFiles.length >= MIN_ENV_FILES_FOR_PARITY) {
    config["env"] = {
      shared: [],
      files: envFiles.map((e) => e.path),
    };
  }

  // Format defaults — ecosystem-centric
  const formatSection: Record<string, unknown> = {
    ignore: [...DEFAULT_IGNORE],
  };
  if (ecosystems["typescript"]) {
    formatSection["typescript"] = { ...OXFMT_DEFAULTS };
  }
  if (ecosystems["dart"]) {
    formatSection["dart"] = { ...DART_FORMAT_DEFAULTS };
  }
  config["format"] = formatSection;

  // Lint defaults — ecosystem-centric
  const lintSection: Record<string, unknown> = {
    ignore: [...DEFAULT_IGNORE],
  };
  if (ecosystems["typescript"]) {
    lintSection["typescript"] = {
      categories: { ...LINT_CATEGORY_DEFAULTS },
      rules: {},
    };
  }
  if (ecosystems["dart"]) {
    lintSection["dart"] = { strict: false };
  }
  config["lint"] = lintSection;

  // Commits defaults — auto-populate scopes from package names
  const scopes: string[] = [];
  for (const group of Object.values(ecosystems)) {
    for (const pkg of group.packages) {
      const scope = pkg.split("/").pop();
      if (scope && !scopes.includes(scope)) {
        scopes.push(scope);
      }
    }
  }
  config["commits"] = {
    types: [
      "feat",
      "fix",
      "docs",
      "style",
      "refactor",
      "perf",
      "test",
      "build",
      "ci",
      "chore",
      "revert",
    ],
    scopes: scopes.sort(),
    header_max_length: 100,
    body_max_line_length: 200,
  };

  // Hooks defaults
  config["hooks"] = {
    "pre-commit": ["mido pre-commit"],
    "commit-msg": ['mido commit-msg "$1"'],
    "post-merge": [
      'mido check --quiet || echo "⚠ mido: workspace drift detected — run mido check --fix"',
    ],
    "post-checkout": [
      'mido check --quiet || echo "⚠ mido: workspace drift detected — run mido check --fix"',
    ],
  };

  return config;
}

function renderYaml(config: Record<string, unknown>): string {
  const doc = new Document(config);
  doc.commentBefore =
    " yaml-language-server: $schema=node_modules/@oddlantern/mido/schema.json\n\n ─────────────────────────────────────────────────────────\n mido — Cross-ecosystem workspace configuration\n Docs: https://github.com/oddlantern/mido\n ─────────────────────────────────────────────────────────";

  const comments: ReadonlyMap<string, string> = new Map([
    [
      "workspace",
      " ─── Workspace ─────────────────────────────────────────\n Workspace name (used in generated package names and CLI output)",
    ],
    [
      "ecosystems",
      " ─── Ecosystems ────────────────────────────────────────\n Declare which languages your workspace uses and where\n packages live. mido auto-detects these during init.",
    ],
    [
      "bridges",
      " ─── Bridges ───────────────────────────────────────────\n Cross-ecosystem dependencies linked by a shared artifact.\n\n source:   package that produces the artifact\n target:   package that consumes the artifact\n artifact: the file that connects them\n watch:    files to monitor for changes (used by mido dev)",
    ],
    [
      "env",
      " ─── Environment ───────────────────────────────────────\n Environment variable parity across packages",
    ],
    [
      "format",
      " ─── Formatting ────────────────────────────────────────\n Per-ecosystem formatting. mido picks the right tool:\n   TypeScript → oxfmt (bundled with mido)\n   Dart       → dart format\n\n All tool defaults are shown. Change any value to override.",
    ],
    [
      "lint",
      " ─── Linting ───────────────────────────────────────────\n Per-ecosystem linting. mido picks the right tool:\n   TypeScript → oxlint (bundled with mido)\n   Dart       → dart analyze\n\n mido auto-enables appropriate oxlint plugins based on\n your dependencies (typescript, unicorn, oxc, import by\n default — react, jsx-a11y, react-perf if React detected).",
    ],
    [
      "commits",
      " ─── Commits ───────────────────────────────────────────\n Conventional commit validation, enforced by mido's\n commit-msg git hook. Run `mido install` to set up hooks.",
    ],
    [
      "hooks",
      " ─── Hooks ─────────────────────────────────────────────\n Git hooks installed by `mido install`. Each hook is a\n list of shell commands run sequentially (stops on first\n failure). Set a hook to `false` to disable it.\n Changes are applied on `mido install` or when mido.yml\n is saved during `mido dev`.",
    ],
  ]);

  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key)) {
        continue;
      }
      const comment = comments.get(String(pair.key.value));
      if (comment) {
        pair.key.commentBefore = comment;
      }
    }
  }

  return doc.toString({ lineWidth: 120 });
}

// ─── Display helpers ────────────────────────────────────────────────────────

function formatEcosystemList(ecosystems: Record<string, EcosystemGroup>): string {
  const lines: string[] = [];
  for (const [name, group] of Object.entries(ecosystems)) {
    lines.push(
      `  ${ORANGE}${BOLD}${name}${RESET} ${DIM}(${group.packages.length} packages)${RESET}`,
    );
    for (const pkg of group.packages) {
      lines.push(`    ${DIM}${pkg}${RESET}`);
    }
  }
  return lines.join("\n");
}

function groupByEcosystem(packages: readonly DiscoveredPackage[]): Record<string, EcosystemGroup> {
  const groups: Record<string, EcosystemGroup> = {};

  const manifestNames: Record<string, string> = {
    typescript: "package.json",
    dart: "pubspec.yaml",
  };

  for (const pkg of packages) {
    if (!groups[pkg.ecosystem]) {
      groups[pkg.ecosystem] = {
        manifest: manifestNames[pkg.ecosystem] ?? pkg.manifest,
        packages: [],
      };
    }
    const group = groups[pkg.ecosystem];
    if (group) {
      group.packages.push(pkg.path);
    }
  }

  for (const group of Object.values(groups)) {
    group.packages.sort();
  }

  return groups;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

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

async function cleanupReplacedTooling(root: string): Promise<void> {
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
