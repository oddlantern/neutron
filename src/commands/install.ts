import { existsSync } from "node:fs";
import { join } from "node:path";

import type { NeutronConfig } from "@/config/schema";
import { writeHooks } from "@/hooks";

export type { WriteHooksResult } from "@/hooks";
export { writeHooks } from "@/hooks";

// ─── CLI entry point ────────────────────────────────────────────────────────

/**
 * Install git hooks to .git/hooks/. Idempotent — safe to run multiple times.
 *
 * Loads config internally when not provided (e.g., when called from bin.ts).
 *
 * @returns exit code (0 = success, 1 = error)
 */
export async function runInstall(
  root: string,
  options?: { readonly dryRun?: boolean },
  config?: NeutronConfig,
): Promise<number> {
  const gitDir = join(root, ".git");
  if (!existsSync(gitDir)) {
    console.error('Not a git repository. Run "git init" first.');
    return 1;
  }

  // Load config if not provided (allows bin.ts to delegate fully)
  let resolvedConfig = config;
  if (!resolvedConfig) {
    try {
      const { loadConfig } = await import("@/config/loader");
      const loaded = await loadConfig();
      resolvedConfig = loaded.config;
    } catch {
      // No neutron.yml yet — install with defaults
    }
  }

  if (options?.dryRun) {
    console.log("dry-run: would install git hooks to .git/hooks/");
    return 0;
  }

  const { installed, disabled } = await writeHooks(root, resolvedConfig, true);

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
