import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { confirm, intro, isCancel, log, multiselect, select, spinner, text } from "@clack/prompts";

import { scanRepo } from "@/discovery/scanner";
import { detectBridges, detectEnvFiles } from "@/discovery/heuristics";
import { printBanner } from "@/banner";
import { BOLD, DIM, ORANGE, RESET } from "@/output";
import type { ParserRegistry } from "@/graph/workspace";
import { loadPlugins } from "@/plugins/loader";
import { PluginRegistry } from "@/plugins/registry";
import { mergeMigratedConfig, migrateLintFormatConfig } from "@/commands/migrate";
import { buildConfigObject, renderYaml } from "@/commands/utils/config-render";
import {
  type BridgeWithWatch,
  CONFIG_FILENAME,
  MIN_ENV_FILES_FOR_PARITY,
  buildPackageMap,
  cleanupReplacedTooling,
  formatEcosystemList,
  groupDiscoveredByEcosystem,
  handleCancel,
  promptAdditionalBridges,
  promptNextSteps,
  promptWatchPaths,
  runPostInitCheck,
} from "@/commands/utils/shared";
import { runReconciliation } from "@/commands/reconcile";
import { isRecord } from "@/guards";

// ─── Prepare / gitignore wiring ──────────────────────────────────────────────

/**
 * Add "neutron generate" to the prepare script in root package.json.
 * If prepare already exists and doesn't mention neutron, chains with &&.
 */
async function wirePrepareScript(root: string): Promise<void> {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) {
    return;
  }

  const raw = await readFile(pkgPath, "utf-8");
  const pkg: unknown = JSON.parse(raw);
  if (!isRecord(pkg)) {
    return;
  }

  const scripts = isRecord(pkg["scripts"]) ? pkg["scripts"] : {};
  const current = typeof scripts["prepare"] === "string" ? scripts["prepare"] : "";

  if (current.includes("neutron generate")) {
    return; // Already wired
  }

  const newPrepare = current ? `${current} && neutron generate` : "neutron generate";
  scripts["prepare"] = newPrepare;
  pkg["scripts"] = scripts;

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  log.step(`Added ${BOLD}"prepare": "neutron generate"${RESET} to package.json`);
}

/**
 * Add generated/ to .gitignore for bridge source directories.
 */
async function wireGitignore(
  root: string,
  bridges: readonly { readonly source: string }[],
): Promise<void> {
  const gitignorePath = join(root, ".gitignore");
  let content = "";

  if (existsSync(gitignorePath)) {
    content = await readFile(gitignorePath, "utf-8");
  }

  // Collect unique source paths that need generated/ ignored
  const sources = new Set(bridges.map((b) => b.source));
  const linesToAdd: string[] = [];

  for (const source of sources) {
    const entry = `${source}/generated/`;
    if (!content.includes(entry)) {
      linesToAdd.push(entry);
    }
  }

  if (linesToAdd.length === 0) {
    return;
  }

  const section = "\n# neutron generated output\n" + linesToAdd.join("\n") + "\n";
  await writeFile(gitignorePath, content.trimEnd() + "\n" + section, "utf-8");
  log.step(`Added ${linesToAdd.length} generated path(s) to .gitignore`);
}

/**
 * Interactive setup that scans the repo and generates neutron.yml.
 * If neutron.yml already exists, runs reconciliation mode instead.
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
  intro("neutron init");

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
  const ecosystems = groupDiscoveredByEcosystem(supported);
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

  const finalEcosystems = groupDiscoveredByEcosystem(finalSupported);

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
    const { runInstall } = await import("@/commands/install");
    const installResult = await runInstall(root);
    if (installResult !== 0) {
      return installResult;
    }
    hooksInstalled = true;
  }

  // Clean up replaced tooling
  await cleanupReplacedTooling(root);

  // Wire prepare script if bridges exist
  if (bridgesWithWatch.length > 0) {
    await wirePrepareScript(root);
    await wireGitignore(root, bridgesWithWatch);
  }

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
