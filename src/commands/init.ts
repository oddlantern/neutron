import { execSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  outro,
  path as clackPath,
  select,
  spinner,
  text,
} from '@clack/prompts';
import { Document, isMap, isScalar } from 'yaml';

import type { MidoConfig } from '../config/schema.js';
import { loadConfig } from '../config/loader.js';
import { scanRepo, type DiscoveredPackage } from '../discovery/scanner.js';
import { detectBridges, detectEnvFiles, type BridgeCandidate } from '../discovery/heuristics.js';
import { printBanner } from '../banner.js';
import { runCheck } from './check.js';
import type { ParserRegistry } from '../graph/workspace.js';

const CONFIG_FILENAME = 'mido.yml';

interface EcosystemGroup {
  readonly manifest: string;
  readonly packages: string[];
}

function handleCancel(): never {
  cancel('Aborted.');
  process.exit(0);
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

async function runFirstTime(root: string, configPath: string, parsers: ParserRegistry): Promise<number> {
  printBanner();
  intro('mido init');

  const s = spinner();
  s.start('Scanning repo...');
  const discovered = await scanRepo(root);
  s.stop('Scan complete');

  if (discovered.length === 0) {
    log.error('No ecosystem packages found. Nothing to configure.');
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
    log.error('No supported ecosystem packages found.');
    return 1;
  }

  // Group by ecosystem and display
  const ecosystems = groupByEcosystem(supported);
  const packageLines = formatEcosystemList(ecosystems);
  log.info(`Found ${supported.length} packages across ${Object.keys(ecosystems).length} ecosystems:\n${packageLines}`);

  // Confirm or adjust packages
  const adjustPackages = await select({
    message: 'Confirm packages?',
    options: [
      { value: 'yes', label: 'Yes, looks correct' },
      { value: 'adjust', label: 'Let me adjust' },
    ],
  });
  if (isCancel(adjustPackages)) {
    handleCancel();
  }

  let finalSupported = supported;
  if (adjustPackages === 'adjust') {
    const selected = await multiselect({
      message: 'Select packages to include:',
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
  const bridges: BridgeCandidate[] = [...(await detectBridges(root, finalSupported))];

  if (bridges.length > 0) {
    const bridgeLines = bridges.map((b) => `  ${b.source} \u2192 ${b.target} via ${b.artifact}`).join('\n');
    log.info(`Detected ${bridges.length} bridge(s):\n${bridgeLines}`);
  }

  // Prompt for additional bridges
  const manualBridges = await promptAdditionalBridges(root, finalSupported.map((p) => p.path));
  bridges.push(...manualBridges);

  // Detect env files
  const envFiles = detectEnvFiles(root, finalSupported);
  if (envFiles.length >= 2) {
    const envLines = envFiles.map((e) => `  ${e.path}`).join('\n');
    log.info(`Env files:\n${envLines}`);
  }

  // Workspace name
  const dirName = root.split('/').pop() ?? 'workspace';
  const nameResult = await text({
    message: 'Workspace name:',
    placeholder: dirName,
    defaultValue: dirName,
  });
  if (isCancel(nameResult)) {
    handleCancel();
  }
  const name = nameResult || dirName;

  // Build and write config
  const config = buildConfigObject(name, finalEcosystems, bridges, envFiles);
  const yaml = renderYaml(config);
  await writeFile(configPath, yaml, 'utf-8');
  log.success(`${CONFIG_FILENAME} written`);

  // Offer hooks
  const installHooks = await confirm({ message: 'Install git hooks?', initialValue: true });
  if (isCancel(installHooks)) {
    handleCancel();
  }

  if (installHooks) {
    const { runInstall } = await import('./install.js');
    const installResult = await runInstall(root);
    if (installResult !== 0) {
      return installResult;
    }
  }

  // Clean up replaced tooling
  await cleanupReplacedTooling(root);

  // Run health check and offer to fix mismatches
  await runPostInitCheck(parsers);

  outro('Workspace ready.');
  return 0;
}

// ─── Reconciliation mode ────────────────────────────────────────────────────

async function runReconciliation(root: string, configPath: string, parsers: ParserRegistry): Promise<number> {
  printBanner();
  intro('mido init \u2014 reconciling with existing config');

  const s = spinner();
  s.start('Scanning repo and comparing with mido.yml...');

  const discovered = await scanRepo(root);
  const supported = discovered.filter((p) => p.supported);

  let existing: MidoConfig;
  try {
    const loaded = await loadConfig(root);
    existing = loaded.config;
  } catch {
    s.stop('Failed to load existing config');
    log.error(`Could not parse existing ${CONFIG_FILENAME}. Delete it and run init again.`);
    return 1;
  }

  s.stop('Scan complete');

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
    const eco = existingEcosystemForPath.get(path) ?? '';
    statusLines.push(`  \u2713 ${path} (${eco})`);
  }
  for (const pkg of newPackages) {
    statusLines.push(`  + ${pkg.path} (${pkg.ecosystem}) \u2190 NEW`);
  }
  for (const path of missing) {
    const eco = existingEcosystemForPath.get(path) ?? '';
    statusLines.push(`  \u26A0 ${path} (${eco}) \u2190 NOT FOUND ON DISK`);
  }
  log.info(`Packages:\n${statusLines.join('\n')}`);

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
  const existingBridges = existing.bridges ?? [];
  const updatedBridges: Array<{ source: string; target: string; artifact: string }> = [];

  for (const bridge of existingBridges) {
    const action = await select({
      message: `${bridge.source} \u2192 ${bridge.target} via ${bridge.artifact}`,
      options: [
        { value: 'keep', label: 'Keep' },
        { value: 'modify', label: 'Modify' },
        { value: 'remove', label: 'Remove' },
      ],
    });
    if (isCancel(action)) {
      handleCancel();
    }

    if (action === 'keep') {
      updatedBridges.push(bridge);
    } else if (action === 'modify') {
      const modified = await promptModifyBridge(root, existing, bridge);
      if (modified) {
        updatedBridges.push(modified);
        configChanged = true;
      } else {
        updatedBridges.push(bridge);
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
      updatedBridges.push({ source: b.source, target: b.target, artifact: b.artifact });
    }
  }

  // Update bridges in config
  if (configChanged || updatedBridges.length !== existingBridges.length) {
    (existing as Record<string, unknown>)['bridges'] =
      updatedBridges.length > 0 ? updatedBridges : undefined;
    configChanged = true;
  }

  // Write if changed
  if (configChanged) {
    const yaml = renderYaml(configToObject(existing));
    await writeFile(configPath, yaml, 'utf-8');
    log.success('Config updated');
  } else {
    log.success('No changes needed');
  }

  // Run health check and offer to fix mismatches
  await runPostInitCheck(parsers);

  outro('Workspace ready.');
  return 0;
}

// ─── Post-init health check ─────────────────────────────────────────────────

async function runPostInitCheck(parsers: ParserRegistry): Promise<void> {
  // Run check quietly to detect issues
  const checkResult = await runCheck(parsers, { quiet: true });

  if (checkResult === 0) {
    log.success('All checks passed');
    return;
  }

  // There are failures — check specifically for version mismatches
  const { config, root } = await loadConfig();
  const { buildWorkspaceGraph } = await import('../graph/workspace.js');
  const { findVersionMismatches } = await import('../checks/versions.js');
  const { loadLock } = await import('../lock.js');

  const graph = await buildWorkspaceGraph(config, root, parsers);
  const lock = await loadLock(root);
  const mismatches = findVersionMismatches(graph, lock);

  if (mismatches.length === 0) {
    return;
  }

  const fix = await confirm({
    message: `Found ${mismatches.length} version mismatch(es). Fix now?`,
    initialValue: true,
  });
  if (isCancel(fix)) {
    handleCancel();
  }

  if (fix) {
    await runCheck(parsers, { fix: true });
  }
}

// ─── Bridge prompts ─────────────────────────────────────────────────────────

async function promptModifyBridge(
  root: string,
  config: MidoConfig,
  current: { readonly source: string; readonly target: string; readonly artifact: string },
): Promise<{ source: string; target: string; artifact: string } | null> {
  const allPaths = getAllPackagePaths(config);

  const source = await select({
    message: 'Source (who generates the file):',
    options: allPaths.map((p) => ({ value: p, label: p })),
    initialValue: current.source,
  });
  if (isCancel(source)) {
    handleCancel();
  }

  const targetPaths = allPaths.filter((p) => p !== source);
  const target = await select({
    message: 'Target (who depends on it):',
    options: targetPaths.map((p) => ({ value: p, label: p })),
    initialValue: current.target,
  });
  if (isCancel(target)) {
    handleCancel();
  }

  const artifact = await clackPath({
    message: 'Artifact (shared file):',
    root,
    initialValue: current.artifact,
  });
  if (isCancel(artifact)) {
    handleCancel();
  }

  // Make artifact relative to root
  const relArtifact = relative(root, join(root, artifact));

  return { source, target, artifact: relArtifact };
}

async function promptAdditionalBridges(
  root: string,
  packagePaths: readonly string[],
): Promise<BridgeCandidate[]> {
  const result: BridgeCandidate[] = [];

  const addMore = await confirm({ message: 'Any additional bridges?', initialValue: false });
  if (isCancel(addMore)) {
    handleCancel();
  }
  if (!addMore) {
    return result;
  }

  let adding = true;
  while (adding) {
    const source = await select({
      message: 'Source (who generates the file):',
      options: packagePaths.map((p) => ({ value: p, label: p })),
    });
    if (isCancel(source)) {
      handleCancel();
    }

    const targetPaths = packagePaths.filter((p) => p !== source);
    const target = await select({
      message: 'Target (who depends on it):',
      options: targetPaths.map((p) => ({ value: p, label: p })),
    });
    if (isCancel(target)) {
      handleCancel();
    }

    const artifact = await clackPath({
      message: 'Artifact (shared file, e.g. openapi.json):',
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
          log.warn('Artifact must be a file, not a directory. Skipping bridge.');
          const retry = await confirm({ message: 'Add another bridge?', initialValue: false });
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
        message: 'File not found — it may not be generated yet. Continue?',
        initialValue: false,
      });
      if (isCancel(proceed)) {
        handleCancel();
      }
      if (!proceed) {
        const retry = await confirm({ message: 'Add another bridge?', initialValue: false });
        if (isCancel(retry)) {
          handleCancel();
        }
        adding = retry;
        continue;
      }
    }

    result.push({ source, target, artifact: relArtifact, reason: 'manual' });
    log.step(`Bridge: ${source} \u2192 ${target} via ${relArtifact}`);

    const another = await confirm({ message: 'Add another bridge?', initialValue: false });
    if (isCancel(another)) {
      handleCancel();
    }
    adding = another;
  }

  return result;
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
    eco.packages.push(pkg.path);
    eco.packages.sort();
  } else {
    const manifestNames: Record<string, string> = {
      typescript: 'package.json',
      dart: 'pubspec.yaml',
    };
    (config.ecosystems as Record<string, { manifest: string; packages: string[] }>)[pkg.ecosystem] = {
      manifest: manifestNames[pkg.ecosystem] ?? pkg.manifest,
      packages: [pkg.path],
    };
  }
}

function removePackageFromConfig(config: MidoConfig, path: string): void {
  for (const [ecoName, group] of Object.entries(config.ecosystems)) {
    const idx = group.packages.indexOf(path);
    if (idx !== -1) {
      group.packages.splice(idx, 1);
      // Remove ecosystem if no packages left
      if (group.packages.length === 0) {
        delete (config.ecosystems as Record<string, unknown>)[ecoName];
      }
      return;
    }
  }
}

function configToObject(config: MidoConfig): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    workspace: config.workspace,
    ecosystems: config.ecosystems,
  };
  if (config.bridges && config.bridges.length > 0) {
    obj['bridges'] = config.bridges;
  }
  if (config.env) {
    obj['env'] = config.env;
  }
  if (config.commits) {
    obj['commits'] = config.commits;
  }
  return obj;
}

function buildConfigObject(
  name: string,
  ecosystems: Record<string, EcosystemGroup>,
  bridges: readonly BridgeCandidate[],
  envFiles: readonly { readonly path: string }[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    workspace: name,
    ecosystems,
  };

  if (bridges.length > 0) {
    config['bridges'] = bridges.map((b) => ({
      source: b.source,
      target: b.target,
      artifact: b.artifact,
    }));
  }

  if (envFiles.length >= 2) {
    config['env'] = {
      shared: [],
      files: envFiles.map((e) => e.path),
    };
  }

  return config;
}

function renderYaml(config: Record<string, unknown>): string {
  const doc = new Document(config);
  doc.commentBefore =
    ' yaml-language-server: $schema=https://raw.githubusercontent.com/oddlantern/mido/main/schema.json';

  const comments: ReadonlyMap<string, string> = new Map([
    ['workspace', ' Workspace name'],
    ['ecosystems', ' Language ecosystems and their packages'],
    ['bridges', ' Cross-ecosystem dependencies linked by a shared artifact'],
    ['env', ' Environment variable parity across packages'],
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
    lines.push(`  ${name} (${group.packages.length} packages)`);
    for (const pkg of group.packages) {
      lines.push(`    ${pkg}`);
    }
  }
  return lines.join('\n');
}

function groupByEcosystem(
  packages: readonly DiscoveredPackage[],
): Record<string, EcosystemGroup> {
  const groups: Record<string, EcosystemGroup> = {};

  const manifestNames: Record<string, string> = {
    typescript: 'package.json',
    dart: 'pubspec.yaml',
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

const HUSKY_DEPS = ['husky', '@commitlint/cli', '@commitlint/config-conventional'];
const COMMITLINT_CONFIGS = ['commitlint.config.js', '.commitlintrc.js', '.commitlintrc.json'];

const LOCKFILE_TO_REMOVE_CMD: ReadonlyMap<string, string> = new Map([
  ['bun.lock', 'bun remove'],
  ['bun.lockb', 'bun remove'],
  ['pnpm-lock.yaml', 'pnpm remove'],
  ['yarn.lock', 'yarn remove'],
  ['package-lock.json', 'npm uninstall'],
]);

function detectRemoveCommand(root: string): string {
  for (const [lockfile, cmd] of LOCKFILE_TO_REMOVE_CMD) {
    if (existsSync(join(root, lockfile))) {
      return cmd;
    }
  }
  return 'npm uninstall';
}

async function cleanupReplacedTooling(root: string): Promise<void> {
  const huskyDir = join(root, '.husky');
  if (existsSync(huskyDir)) {
    const answer = await confirm({
      message: 'mido replaces Husky. Remove .husky/ directory?',
      initialValue: true,
    });
    if (isCancel(answer)) {
      handleCancel();
    }
    if (answer) {
      await rm(huskyDir, { recursive: true });
      log.step('Removed .husky/');
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
      message: 'mido replaces commitlint. Remove commitlint config?',
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

  const pkgJsonPath = join(root, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return;
  }

  const pkgRaw = await readFile(pkgJsonPath, 'utf-8');
  const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
  const devDeps = pkg['devDependencies'] as Record<string, unknown> | undefined;

  const depsToRemove = devDeps ? HUSKY_DEPS.filter((d) => d in devDeps) : [];

  if (depsToRemove.length > 0) {
    const answer = await confirm({
      message: 'Remove Husky and commitlint from devDependencies?',
      initialValue: true,
    });
    if (isCancel(answer)) {
      handleCancel();
    }
    if (answer) {
      const cmd = detectRemoveCommand(root);
      const full = `${cmd} ${depsToRemove.join(' ')}`;
      log.step(`$ ${full}`);
      execSync(full, { cwd: root, stdio: 'inherit' });
    }
  }

  // Re-read package.json in case it was modified by the uninstall step
  if (!existsSync(pkgJsonPath)) {
    return;
  }

  const freshRaw = await readFile(pkgJsonPath, 'utf-8');
  const freshPkg = JSON.parse(freshRaw) as Record<string, unknown>;
  const scripts = freshPkg['scripts'] as Record<string, unknown> | undefined;

  if (scripts && scripts['prepare'] === 'husky') {
    scripts['prepare'] = 'mido install';
    await writeFile(pkgJsonPath, JSON.stringify(freshPkg, null, 2) + '\n', 'utf-8');
    log.step('Updated scripts.prepare \u2192 "mido install"');
  }
}
