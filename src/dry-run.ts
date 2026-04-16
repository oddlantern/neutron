import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { relative } from "node:path";

import { GREEN, RESET, YELLOW } from "@/output";

/**
 * Filesystem operations that respect dry-run mode.
 *
 * When `dryRun` is true, operations log what would happen instead of
 * writing to disk. When false, they delegate to the real fs functions.
 *
 * Use `createDryFs(dryRun, root)` to create an instance.
 */
export interface DryFs {
  readonly isDryRun: boolean;
  writeFile(path: string, content: string, encoding?: BufferEncoding): void;
  mkdir(path: string, options?: { readonly recursive?: boolean }): void;
  cp(src: string, dest: string, options?: { readonly recursive?: boolean }): void;
}

/**
 * Format a path for display — show relative to root when possible.
 */
function displayPath(path: string, root: string): string {
  const rel = relative(root, path);
  return rel.startsWith("..") ? path : rel;
}

/**
 * Create a filesystem wrapper that respects dry-run mode.
 *
 * @param dryRun — when true, logs operations instead of executing them
 * @param root — workspace root for display path formatting
 */
export function createDryFs(dryRun: boolean, root: string): DryFs {
  if (!dryRun) {
    return {
      isDryRun: false,
      writeFile(path: string, content: string, encoding: BufferEncoding = "utf-8"): void {
        writeFileSync(path, content, encoding);
      },
      mkdir(path: string, options?: { readonly recursive?: boolean }): void {
        mkdirSync(path, options);
      },
      cp(src: string, dest: string, options?: { readonly recursive?: boolean }): void {
        cpSync(src, dest, options);
      },
    };
  }

  return {
    isDryRun: true,
    writeFile(path: string, _content: string): void {
      console.log(`  ${YELLOW}dry-run${RESET} write ${GREEN}${displayPath(path, root)}${RESET}`);
    },
    mkdir(path: string): void {
      console.log(`  ${YELLOW}dry-run${RESET} mkdir ${GREEN}${displayPath(path, root)}${RESET}`);
    },
    cp(src: string, dest: string): void {
      console.log(
        `  ${YELLOW}dry-run${RESET} copy  ${GREEN}${displayPath(src, root)}${RESET} → ${GREEN}${displayPath(dest, root)}${RESET}`,
      );
    },
  };
}
