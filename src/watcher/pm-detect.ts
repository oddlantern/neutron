import { existsSync } from 'node:fs';
import { join } from 'node:path';

const LOCKFILE_TO_PM: ReadonlyMap<string, string> = new Map([
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
]);

/** Detect package manager from lockfiles in the workspace root */
export function detectPackageManager(root: string): string {
  for (const [lockfile, pm] of LOCKFILE_TO_PM) {
    if (existsSync(join(root, lockfile))) {
      return pm;
    }
  }
  return 'npm';
}
