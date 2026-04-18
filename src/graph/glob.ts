import { globSync } from "tinyglobby";

import { YELLOW, RESET } from "@/output";

/**
 * Expand `packages:` patterns against the workspace root.
 *
 * Accepts the full glob grammar (via tinyglobby):
 *   - literals:        `apps/web`
 *   - single-level:    `apps/*`
 *   - recursive:       `services/**`
 *   - brace expansion: `{apps,tools}/*`
 *   - exclusions:      `!packages/experimental-*` (filters matches from earlier patterns)
 *
 * A pattern that resolves to zero packages emits a warning rather than an
 * error — users may be building toward packages that don't exist yet.
 */
export function expandPackageGlobs(patterns: readonly string[], root: string): readonly string[] {
  if (patterns.length === 0) {
    return [];
  }

  const includes: string[] = [];
  const excludes: string[] = [];
  for (const p of patterns) {
    if (p.startsWith("!")) {
      excludes.push(p.slice(1));
    } else {
      includes.push(p);
    }
  }

  const seen = new Set<string>();
  const results: string[] = [];

  for (const pattern of includes) {
    const matches = globSync(pattern, {
      cwd: root,
      onlyDirectories: true,
      ignore: excludes,
      dot: false,
      expandDirectories: false,
    });

    if (matches.length === 0) {
      console.error(`${YELLOW}warn:${RESET} packages pattern "${pattern}" matched no packages`);
      continue;
    }

    // Normalize: tinyglobby may return trailing slashes on directories; strip them.
    // Alphabetize for predictable ordering across runs.
    const normalized = matches.map((m) => (m.endsWith("/") ? m.slice(0, -1) : m)).sort();

    for (const path of normalized) {
      if (!seen.has(path)) {
        seen.add(path);
        results.push(path);
      }
    }
  }

  return results;
}
