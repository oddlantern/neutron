import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { HooksConfig, MidoConfig } from "../config/schema.js";
import { HOOK_NAMES } from "../config/schema.js";
import { confirmAction } from "../prompt.js";

const HOOKS_DIR = ".git/hooks";
const MIDO_MARKER = "mido";
const HOOK_HEADER = `#!/usr/bin/env sh\n# mido — do not edit (regenerate with: mido install)\n`;

// ─── Default hook commands ──────────────────────────────────────────────────

const DEFAULT_HOOKS: Readonly<Record<string, readonly string[]>> = {
  "pre-commit": ["mido pre-commit"],
  "commit-msg": ['mido commit-msg "$1"'],
  "post-merge": [
    'mido check --quiet || echo "⚠ mido: workspace drift detected — run mido check --fix"',
  ],
  "post-checkout": [
    'mido check --quiet || echo "⚠ mido: workspace drift detected — run mido check --fix"',
  ],
};

// ─── Hook resolution ────────────────────────────────────────────────────────

interface ResolvedHook {
  readonly name: string;
  readonly steps: readonly string[] | false;
}

/**
 * Merge user hooks config with defaults.
 * - Omitted hooks section = all defaults
 * - Omitted hook key = that hook's default
 * - `false` = disabled
 * - Array = custom steps
 */
function resolveHooks(config?: MidoConfig): readonly ResolvedHook[] {
  const userHooks = config?.hooks;

  return HOOK_NAMES.map((name) => {
    const userValue = userHooks?.[name];

    if (userValue === false) {
      return { name, steps: false };
    }

    if (userValue) {
      return { name, steps: userValue };
    }

    return { name, steps: DEFAULT_HOOKS[name] ?? [] };
  });
}

// ─── Script generation ──────────────────────────────────────────────────────

function generateScript(name: string, steps: readonly string[]): string {
  if (name === "post-checkout") {
    const body = steps.map((s) => `  ${s}`).join("\n");
    return `${HOOK_HEADER}# Only on branch checkout, not file checkout\nif [ "$3" = "1" ]; then\n  set -e\n${body}\nfi\n`;
  }

  const body = steps.join("\n");
  return `${HOOK_HEADER}set -e\n${body}\n`;
}

// ─── Write hooks (shared between install and watcher) ────────────────────────

export interface WriteHooksResult {
  readonly installed: number;
  readonly disabled: number;
}

/**
 * Write hook scripts to .git/hooks/ based on resolved config.
 *
 * @param interactive - When true, prompts before overwriting non-mido hooks.
 *                      When false (watcher context), skips non-mido hooks silently.
 */
export async function writeHooks(
  root: string,
  config?: MidoConfig,
  interactive = true,
): Promise<WriteHooksResult> {
  const hooksDir = join(root, HOOKS_DIR);
  if (!existsSync(hooksDir)) {
    await mkdir(hooksDir, { recursive: true });
  }

  const resolved = resolveHooks(config);
  let installed = 0;
  let disabled = 0;

  for (const hook of resolved) {
    const hookPath = join(hooksDir, hook.name);

    // Disabled hook — remove if mido-owned
    if (hook.steps === false) {
      if (existsSync(hookPath)) {
        const existing = await readFile(hookPath, "utf-8");
        if (existing.includes(MIDO_MARKER)) {
          await unlink(hookPath);
          disabled++;
        }
      }
      continue;
    }

    const script = generateScript(hook.name, hook.steps);

    // Check for existing non-mido hooks
    if (existsSync(hookPath)) {
      const existing = await readFile(hookPath, "utf-8");

      if (existing.includes(MIDO_MARKER)) {
        await writeFile(hookPath, script, "utf-8");
        await chmod(hookPath, 0o755);
        installed++;
        continue;
      }

      // Non-mido hook
      if (!interactive) {
        continue;
      }

      const overwrite = await confirmAction(
        `Existing ${hook.name} hook found (not owned by mido). Overwrite?`,
        false,
      );

      if (!overwrite) {
        console.log(`  skipped ${hook.name}`);
        continue;
      }
    }

    await writeFile(hookPath, script, "utf-8");
    await chmod(hookPath, 0o755);
    installed++;
  }

  return { installed, disabled };
}

// ─── CLI entry point ────────────────────────────────────────────────────────

/**
 * Install git hooks to .git/hooks/. Idempotent — safe to run multiple times.
 *
 * @returns exit code (0 = success, 1 = error)
 */
export async function runInstall(root: string, config?: MidoConfig): Promise<number> {
  const gitDir = join(root, ".git");
  if (!existsSync(gitDir)) {
    console.error('Not a git repository. Run "git init" first.');
    return 1;
  }

  const { installed, disabled } = await writeHooks(root, config, true);

  const parts: string[] = [];
  if (installed > 0) parts.push(`${installed} installed`);
  if (disabled > 0) parts.push(`${disabled} disabled`);

  if (parts.length > 0) {
    console.log(`Git hooks: ${parts.join(", ")}`);
  } else {
    console.log("Git hooks: no changes");
  }

  return 0;
}
