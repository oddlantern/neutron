import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { confirm, intro, isCancel, log, multiselect, select, spinner, text } from "@clack/prompts";

import { scanRepo } from "../discovery/scanner.js";
import { detectBridges, detectEnvFiles } from "../discovery/heuristics.js";
import { printBanner } from "../banner.js";
import { BOLD, DIM, GREEN, ORANGE, RESET } from "../output.js";
import type { ParserRegistry } from "../graph/workspace.js";
import { loadPlugins } from "../plugins/loader.js";
import { PluginRegistry } from "../plugins/registry.js";
import { mergeMigratedConfig, migrateLintFormatConfig } from "./migrate.js";
import { buildConfigObject, renderYaml } from "./utils/config-render.js";
import {
  type BridgeWithWatch,
  CONFIG_FILENAME,
  MIN_ENV_FILES_FOR_PARITY,
  buildPackageMap,
  cleanupReplacedTooling,
  formatEcosystemList,
  groupByEcosystem,
  handleCancel,
  promptAdditionalBridges,
  promptNextSteps,
  promptWatchPaths,
  runPostInitCheck,
} from "./utils/shared.js";
import { runReconciliation } from "./reconcile.js";

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
  const detectedBridges = [...(await detectBridges(root, finalSupported))];

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
    let suggestion = null;
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
