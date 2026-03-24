import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EnvConfig } from '../config/schema.js';
import type { CheckIssue, CheckResult } from './types.js';

/**
 * Parse a .env or .env.example file into a set of key names.
 * Handles comments, empty lines, and inline comments.
 */
function parseEnvKeys(content: string): Set<string> {
  const keys = new Set<string>();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    if (key.length > 0) keys.add(key);
  }

  return keys;
}

/**
 * Check that all shared keys exist in every declared env file.
 */
export async function checkEnvParity(
  envConfig: EnvConfig,
  root: string,
): Promise<CheckResult> {
  const issues: CheckIssue[] = [];
  const fileKeys = new Map<string, Set<string>>();

  // Parse each env file
  for (const filePath of envConfig.files) {
    const absPath = resolve(root, filePath);

    if (!existsSync(absPath)) {
      issues.push({
        severity: 'error',
        check: 'env',
        message: `Env file not found: ${filePath}`,
      });
      continue;
    }

    const content = await readFile(absPath, 'utf-8');
    fileKeys.set(filePath, parseEnvKeys(content));
  }

  // Check each shared key exists in all files
  for (const key of envConfig.shared) {
    const missingIn: string[] = [];

    for (const [filePath, keys] of fileKeys) {
      if (!keys.has(key)) {
        missingIn.push(filePath);
      }
    }

    if (missingIn.length > 0) {
      issues.push({
        severity: 'error',
        check: 'env',
        message: `Shared key "${key}" missing from: ${missingIn.join(', ')}`,
        details: `Expected in all of: ${envConfig.files.join(', ')}`,
      });
    }
  }

  return {
    check: 'env',
    passed: issues.length === 0,
    issues,
    summary: issues.length === 0
      ? `${envConfig.shared.length} shared key(s) verified across ${envConfig.files.length} file(s)`
      : `${issues.length} env parity issue(s) found`,
  };
}
