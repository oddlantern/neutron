import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { BINARY_NAME, DISPLAY_NAME, HOOK_MARKER } from "@/branding";
import type { NeutronConfig } from "@/config/schema";
import { HOOK_NAMES } from "@/config/schema";
import { confirmAction } from "@/prompt";

const HOOKS_DIR = ".git/hooks";
const HOOK_HEADER = `#!/usr/bin/env sh\n# ${DISPLAY_NAME} — do not edit (regenerate with: ${BINARY_NAME} install)\n`;

// ─── Default hook commands ──────────────────────────────────────────────────

const CHECK_DRIFT_HOOK = `${BINARY_NAME} check --quiet || echo "⚠ ${BINARY_NAME}: workspace drift detected — run ${BINARY_NAME} check --fix"`;

const DEFAULT_HOOKS: Readonly<Record<string, readonly string[]>> = {
  "pre-commit": [`${BINARY_NAME} pre-commit`],
  "commit-msg": [`${BINARY_NAME} commit-msg "$1"`],
  "post-merge": [CHECK_DRIFT_HOOK],
  "post-checkout": [CHECK_DRIFT_HOOK],
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
function resolveHooks(config?: NeutronConfig): readonly ResolvedHook[] {
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
 * @param interactive - When true, prompts before overwriting non-neutron hooks.
 *                      When false (watcher context), skips non-neutron hooks silently.
 */
export async function writeHooks(
  root: string,
  config?: NeutronConfig,
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

    // Disabled hook — remove if neutron-owned
    if (hook.steps === false) {
      if (existsSync(hookPath)) {
        const existing = await readFile(hookPath, "utf-8");
        if (existing.includes(HOOK_MARKER)) {
          await unlink(hookPath);
          disabled++;
        }
      }
      continue;
    }

    const script = generateScript(hook.name, hook.steps);

    // Check for existing non-neutron hooks
    if (existsSync(hookPath)) {
      const existing = await readFile(hookPath, "utf-8");

      if (existing.includes(HOOK_MARKER)) {
        await writeFile(hookPath, script, "utf-8");
        await chmod(hookPath, 0o755);
        installed++;
        continue;
      }

      // Non-neutron hook
      if (!interactive) {
        continue;
      }

      const overwrite = await confirmAction(
        `Existing ${hook.name} hook found (not owned by neutron). Overwrite?`,
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
