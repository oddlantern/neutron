import { writeFile } from "node:fs/promises";
import { basename } from "node:path";

import {
  confirm,
  intro,
  isCancel,
  log,
  select,
  spinner,
} from "@clack/prompts";

import type { MidoConfig } from "@/config/schema";
import { loadConfig } from "@/config/loader";
import { scanRepo, type DiscoveredPackage } from "@/discovery/scanner";
import { printBanner } from "@/banner";
import { DIM, GREEN, ORANGE, RESET } from "@/output";
import type { ParserRegistry } from "@/graph/workspace";
import { loadPlugins } from "@/plugins/loader";
import { PluginRegistry } from "@/plugins/registry";
import type { WatchPathSuggestion } from "@/plugins/types";
import { mergeMigratedConfig, migrateLintFormatConfig } from "@/commands/migrate";
import { configToObject, renderYaml } from "@/commands/utils/config-render";
import {
  type BridgeWithWatch,
  CONFIG_FILENAME,
  addPackageToConfig,
  buildPackageMap,
  cleanupReplacedTooling,
  getAllPackagePaths,
  handleCancel,
  promptAdditionalBridges,
  promptModifyBridge,
  promptNextSteps,
  promptWatchPaths,
  removePackageFromConfig,
  runPostInitCheck,
} from "@/commands/utils/shared";

export async function runReconciliation(
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
  } catch (err: unknown) {
    s.stop("Failed to load existing config");
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`Could not parse existing ${CONFIG_FILENAME}: ${msg}`);

    const replace = await confirm({
      message: "Replace with a fresh scan?",
      initialValue: true,
    });
    if (isCancel(replace) || !replace) {
      handleCancel();
    }

    // Delete the broken config and re-run as first-time init
    const { unlink } = await import("node:fs/promises");
    await unlink(configPath);
    log.step(`Removed broken ${CONFIG_FILENAME}`);

    // Re-import to avoid circular — runInit delegates to runFirstTime
    const { runInit } = await import("@/commands/init");
    return runInit(root, parsers);
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
          // Plugin has a suggestion \u2014 show the full watch path menu
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
          // No suggestion \u2014 ask if they want to add paths manually
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
    const { runInstall } = await import("@/commands/install");
    const installResult = await runInstall(root, existing);
    if (installResult !== 0) {
      return installResult;
    }
    hooksInstalled = true;
  }

  // Clean up replaced tooling
  await cleanupReplacedTooling(root);

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
