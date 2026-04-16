import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Expand package path patterns that contain `*` wildcards.
 * Supports single-level `*` expansion (e.g., `apps/*`, `packages/*`).
 * Literal paths (no `*`) are returned as-is.
 *
 * @returns Deduplicated list of expanded paths.
 */
export function expandPackageGlobs(patterns: readonly string[], root: string): readonly string[] {
  const results: string[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    if (!pattern.includes("*")) {
      // Literal path — pass through unchanged
      if (!seen.has(pattern)) {
        seen.add(pattern);
        results.push(pattern);
      }
      continue;
    }

    const segments = pattern.split("/");
    const starIndex = segments.findIndex((s) => s.includes("*"));

    if (starIndex === -1) {
      // No star found (shouldn't happen given the includes check above)
      if (!seen.has(pattern)) {
        seen.add(pattern);
        results.push(pattern);
      }
      continue;
    }

    // Build the parent directory path (segments before the star)
    const parentSegments = segments.slice(0, starIndex);
    const parentDir = parentSegments.length > 0 ? resolve(root, parentSegments.join("/")) : root;

    // Build regex from the star segment (e.g., "app-*" → /^app-[^/]+$/)
    const starSegment = segments[starIndex]!;
    const regexSource = starSegment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+");
    const segmentRegex = new RegExp(`^${regexSource}$`);

    // Remaining segments after the star
    const suffixSegments = segments.slice(starIndex + 1);

    let entries: string[];
    try {
      entries = readdirSync(parentDir);
    } catch {
      // Parent directory doesn't exist — skip this pattern
      continue;
    }

    for (const entry of entries) {
      if (!segmentRegex.test(entry)) {
        continue;
      }

      const fullPath = join(parentDir, entry);
      try {
        if (!statSync(fullPath).isDirectory()) {
          continue;
        }
      } catch {
        continue;
      }

      // If there are suffix segments, append them
      const expandedSegments = [...parentSegments, entry, ...suffixSegments];
      const expanded = expandedSegments.join("/");

      if (!seen.has(expanded)) {
        seen.add(expanded);
        results.push(expanded);
      }
    }
  }

  return results;
}
