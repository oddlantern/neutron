import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { confirmAction } from '../prompt.js';

const HOOKS_DIR = '.git/hooks';

const HOOK_PRE_COMMIT = `#!/usr/bin/env sh
mido check --quiet
`;

const HOOK_COMMIT_MSG = `#!/usr/bin/env sh
mido commit-msg "$1"
`;

const HOOK_POST_MERGE = `#!/usr/bin/env sh
mido check --quiet || echo "⚠ mido: workspace drift detected — run mido check --fix"
`;

const HOOK_POST_CHECKOUT = `#!/usr/bin/env sh
# Only on branch checkout, not file checkout
if [ "$3" = "1" ]; then
  mido check --quiet || echo "⚠ mido: workspace drift detected — run mido check --fix"
fi
`;

interface HookDef {
  readonly name: string;
  readonly content: string;
}

const HOOKS: readonly HookDef[] = [
  { name: 'pre-commit', content: HOOK_PRE_COMMIT },
  { name: 'commit-msg', content: HOOK_COMMIT_MSG },
  { name: 'post-merge', content: HOOK_POST_MERGE },
  { name: 'post-checkout', content: HOOK_POST_CHECKOUT },
];

const MIDO_MARKER = 'mido';

/**
 * Install git hooks to .git/hooks/. Idempotent — safe to run multiple times.
 *
 * @returns exit code (0 = success, 1 = error)
 */
export async function runInstall(root: string): Promise<number> {
  const gitDir = join(root, '.git');
  if (!existsSync(gitDir)) {
    console.error('Not a git repository. Run "git init" first.');
    return 1;
  }

  const hooksDir = join(root, HOOKS_DIR);
  if (!existsSync(hooksDir)) {
    await mkdir(hooksDir, { recursive: true });
  }

  let installed = 0;

  for (const hook of HOOKS) {
    const hookPath = join(hooksDir, hook.name);

    // Check for existing non-mido hooks
    if (existsSync(hookPath)) {
      const existing = await readFile(hookPath, 'utf-8');

      // If it's already a mido hook, overwrite silently
      if (existing.includes(MIDO_MARKER)) {
        await writeFile(hookPath, hook.content, 'utf-8');
        await chmod(hookPath, 0o755);
        installed++;
        continue;
      }

      // Non-mido hook — warn and ask
      const overwrite = await confirmAction(`Existing ${hook.name} hook found (not owned by mido). Overwrite?`, false);

      if (!overwrite) {
        console.log(`  skipped ${hook.name}`);
        continue;
      }
    }

    await writeFile(hookPath, hook.content, 'utf-8');
    await chmod(hookPath, 0o755);
    installed++;
  }

  console.log(`Installed ${installed} git hook(s)`);
  return 0;
}
