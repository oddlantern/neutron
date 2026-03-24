import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { stringify as stringifyYaml } from 'yaml';

import { scanRepo, type DiscoveredPackage } from '../discovery/scanner.js';
import { detectBridges, detectEnvFiles } from '../discovery/heuristics.js';
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
  const bridgeCandidates = await detectBridges(root, supported);

  if (bridgeCandidates.length > 0) {
    console.log(`\n  Bridges:`);
    for (const bridge of bridgeCandidates) {
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

  if (bridgeCandidates.length > 0) {
    config['bridges'] = bridgeCandidates.map((b) => ({
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
  closePrompt();

  if (installAnswer.toLowerCase() !== 'n') {
    const { runInstall } = await import('./install.js');
    return runInstall(root);
  }

  return 0;
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
