import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { stringify as stringifyYaml } from 'yaml';

import { scanRepo, type DiscoveredPackage } from '../discovery/scanner.js';
import { detectBridges, detectEnvFiles, type BridgeCandidate } from '../discovery/heuristics.js';
import { ask, closePrompt } from '../prompt.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

const CONFIG_FILENAME = 'mido.yml';

interface EcosystemGroup {
  readonly manifest: string;
  readonly packages: string[];
}

/**
 * Interactive setup that scans the repo and generates mido.yml.
 *
 * @returns exit code (0 = success, 1 = error)
 */
export async function runInit(root: string): Promise<number> {
  const configPath = join(root, CONFIG_FILENAME);

  if (existsSync(configPath)) {
    const answer = await ask(`${CONFIG_FILENAME} already exists. Overwrite? [y/N] `);
    if (answer.toLowerCase() !== 'y') {
      console.log('Aborted.');
      closePrompt();
      return 0;
    }
  }

  console.log(`\n${CYAN}${BOLD}mido init${RESET} ${DIM}— scanning repo...${RESET}\n`);

  // 1. Scan for packages
  const discovered = await scanRepo(root);

  if (discovered.length === 0) {
    console.log('No ecosystem packages found. Nothing to configure.');
    closePrompt();
    return 1;
  }

  // Separate supported and unsupported
  const supported = discovered.filter((p) => p.supported);
  const unsupported = discovered.filter((p) => !p.supported);

  if (unsupported.length > 0) {
    for (const pkg of unsupported) {
      console.log(`  ${YELLOW}⚠${RESET} ${pkg.ecosystem} detected at ${pkg.path} (not yet supported)`);
    }
    console.log('');
  }

  if (supported.length === 0) {
    console.log('No supported ecosystem packages found.');
    closePrompt();
    return 1;
  }

  // 2. Group by ecosystem
  const ecosystems = groupByEcosystem(supported);

  // 3. Print discovered packages
  console.log('  Ecosystems:');
  for (const [name, group] of Object.entries(ecosystems)) {
    console.log(`    ${BOLD}${name}${RESET} (${group.packages.length} packages)`);
    for (const pkg of group.packages) {
      console.log(`      ${pkg}`);
    }
  }

  // 4. Detect bridges
  const bridges: BridgeCandidate[] = [...(await detectBridges(root, supported))];

  if (bridges.length > 0) {
    console.log(`\n  Bridges (auto-detected):`);
    for (const bridge of bridges) {
      console.log(`    ${bridge.source} → ${bridge.target}`);
      console.log(`      ${DIM}via ${bridge.artifact}${RESET}`);
    }
  }

  // 4b. Prompt for additional bridges
  const allPaths = supported.map((p) => p.path);
  const manualBridges = await promptAdditionalBridges(root, allPaths);
  bridges.push(...manualBridges);

  if (manualBridges.length > 0) {
    console.log(`\n  Bridges (manual):`);
    for (const bridge of manualBridges) {
      console.log(`    ${bridge.source} → ${bridge.target}`);
      console.log(`      ${DIM}via ${bridge.artifact}${RESET}`);
    }
  }

  // 5. Detect env files
  const envFiles = detectEnvFiles(root, supported);

  if (envFiles.length >= 2) {
    console.log(`\n  Env files:`);
    for (const env of envFiles) {
      console.log(`    ${env.path}`);
    }
  }

  // 6. Ask to write
  console.log('');
  const writeAnswer = await ask(`  Write ${CONFIG_FILENAME}? [Y/n] `);

  if (writeAnswer.toLowerCase() === 'n') {
    console.log('Aborted.');
    closePrompt();
    return 0;
  }

  // 7. Ask for workspace name
  const dirName = root.split('/').pop() ?? 'workspace';
  const workspaceName = await ask(`  Workspace name [${dirName}]: `);
  const name = workspaceName || dirName;

  // 8. Build config object
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

  // 9. Write config
  const yaml = stringifyYaml(config, { lineWidth: 120 });
  await writeFile(configPath, yaml, 'utf-8');
  console.log(`\n  ${BOLD}${CONFIG_FILENAME}${RESET} written\n`);

  // 10. Offer to install hooks
  const installAnswer = await ask('  Install git hooks? [Y/n] ');

  if (installAnswer.toLowerCase() !== 'n') {
    const { runInstall } = await import('./install.js');
    const installResult = await runInstall(root);
    if (installResult !== 0) {
      closePrompt();
      return installResult;
    }
  }

  // 11. Clean up replaced tooling (Husky, commitlint)
  await cleanupReplacedTooling(root);

  closePrompt();
  return 0;
}

async function promptAdditionalBridges(
  root: string,
  packagePaths: readonly string[],
): Promise<BridgeCandidate[]> {
  const result: BridgeCandidate[] = [];

  console.log('');
  const addMore = await ask('  Any additional bridges? [y/N] ');
  if (addMore.toLowerCase() !== 'y') {
    return result;
  }

  const listLines = packagePaths.map((p, i) => `    ${i + 1}) ${p}`).join('\n');

  let adding = true;
  while (adding) {
    console.log(`\n${listLines}`);
    const sourceAnswer = await ask('\n  Source package (produces the artifact): ');
    const sourceIdx = parseInt(sourceAnswer, 10);
    if (isNaN(sourceIdx) || sourceIdx < 1 || sourceIdx > packagePaths.length) {
      console.log('  Invalid choice, skipping bridge.');
      break;
    }
    const source = packagePaths[sourceIdx - 1]!;

    console.log(`\n${listLines}`);
    const targetAnswer = await ask('\n  Target package (consumes the artifact): ');
    const targetIdx = parseInt(targetAnswer, 10);
    if (isNaN(targetIdx) || targetIdx < 1 || targetIdx > packagePaths.length) {
      console.log('  Invalid choice, skipping bridge.');
      break;
    }
    const target = packagePaths[targetIdx - 1]!;

    const artifact = await ask('  Artifact path (relative to repo root): ');
    if (!artifact) {
      console.log('  No artifact path given, skipping bridge.');
      break;
    }

    if (!existsSync(join(root, artifact))) {
      console.log(`  ${YELLOW}⚠${RESET} ${artifact} does not exist yet — adding anyway`);
    }

    result.push({ source, target, artifact, reason: 'manual' });

    const another = await ask('  Add another bridge? [y/N] ');
    adding = another.toLowerCase() === 'y';
  }

  return result;
}

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
  // 1. Remove .husky/ directory
  const huskyDir = join(root, '.husky');
  if (existsSync(huskyDir)) {
    const answer = await ask('  mido replaces Husky. Remove .husky/ directory? [Y/n] ');
    if (answer.toLowerCase() !== 'n') {
      await rm(huskyDir, { recursive: true });
      console.log(`  ${DIM}removed .husky/${RESET}`);
    }
  }

  // 2. Remove commitlint config files
  const foundConfigs: string[] = [];
  for (const name of COMMITLINT_CONFIGS) {
    if (existsSync(join(root, name))) {
      foundConfigs.push(name);
    }
  }

  if (foundConfigs.length > 0) {
    const answer = await ask('  mido replaces commitlint. Remove commitlint config? [Y/n] ');
    if (answer.toLowerCase() !== 'n') {
      for (const name of foundConfigs) {
        await unlink(join(root, name));
        console.log(`  ${DIM}removed ${name}${RESET}`);
      }
    }
  }

  // 3. Remove Husky/commitlint from devDependencies
  const pkgJsonPath = join(root, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return;
  }

  const pkgRaw = await readFile(pkgJsonPath, 'utf-8');
  const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
  const devDeps = pkg['devDependencies'] as Record<string, unknown> | undefined;

  const depsToRemove = devDeps ? HUSKY_DEPS.filter((d) => d in devDeps) : [];

  if (depsToRemove.length > 0) {
    const answer = await ask('  Remove Husky and commitlint from devDependencies? [Y/n] ');
    if (answer.toLowerCase() !== 'n') {
      const cmd = detectRemoveCommand(root);
      const full = `${cmd} ${depsToRemove.join(' ')}`;
      console.log(`  ${DIM}$ ${full}${RESET}`);
      execSync(full, { cwd: root, stdio: 'inherit' });
    }
  }

  // 4. Replace scripts.prepare if it's "husky"
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
    console.log(`  ${DIM}updated scripts.prepare → "mido install"${RESET}`);
  }
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

  // Sort packages within each ecosystem
  for (const group of Object.values(groups)) {
    group.packages.sort();
  }

  return groups;
}
