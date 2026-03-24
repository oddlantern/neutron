import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, parse as parsePath } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { configSchema, type MidoConfig } from './schema.js';

const CONFIG_FILENAMES = ['mido.yml', 'mido.yaml'] as const;

/**
 * Walk upward from `startDir` until we find a mido.yml/mido.yaml.
 * Returns the absolute path to the config file, or null if not found.
 */
function findConfigFile(startDir: string): string | null {
  let current = startDir;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const filename of CONFIG_FILENAMES) {
      const candidate = join(current, filename);
      if (existsSync(candidate)) return candidate;
    }

    const parent = dirname(current);
    // Reached filesystem root
    if (parent === current) return null;
    current = parent;
  }
}

export interface LoadedConfig {
  readonly config: MidoConfig;
  /** Absolute path to the workspace root (directory containing mido.yml) */
  readonly root: string;
  /** Absolute path to the config file itself */
  readonly configPath: string;
}

/**
 * Locate and parse the mido config file.
 * Searches upward from the given directory (defaults to cwd).
 *
 * @throws {Error} if no config file is found or validation fails
 */
export async function loadConfig(startDir?: string): Promise<LoadedConfig> {
  const searchFrom = startDir ?? process.cwd();
  const configPath = findConfigFile(searchFrom);

  if (configPath === null) {
    throw new Error(
      `No mido.yml found. Searched upward from ${searchFrom}\n` +
      'Create a mido.yml in your workspace root to get started.',
    );
  }

  const raw = await readFile(configPath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (cause) {
    throw new Error(`Invalid YAML in ${configPath}`, { cause });
  }

  const result = configSchema.safeParse(parsed);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');

    throw new Error(`Invalid mido config at ${configPath}:\n${issues}`);
  }

  const root = dirname(configPath);

  return { config: result.data, root, configPath };
}
