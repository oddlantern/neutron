import { readFile } from "node:fs/promises";

import { loadConfig } from "../config/loader.js";
import { DEFAULT_COMMIT_TYPES } from "../config/schema.js";
import type { CommitsConfig } from "../config/schema.js";
import { validateCommitMessage } from "../commit/validator.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

const FAIL = `${RED}✗${RESET}`;
const WARN = `${YELLOW}⚠${RESET}`;

/** Default config used when no mido.yml commits section exists */
const FALLBACK_CONFIG: CommitsConfig = {
  types: [...DEFAULT_COMMIT_TYPES],
  header_max_length: 100,
  body_max_line_length: 200,
};

/**
 * Validate a commit message file against conventional commit rules.
 *
 * @returns exit code (0 = valid, 1 = invalid)
 */
export async function runCommitMsg(filePath: string): Promise<number> {
  const raw = await readFile(filePath, "utf-8");
  const message = raw.trim();

  if (!message) {
    console.error(`${FAIL} commit message is empty`);
    return 1;
  }

  // Load config — fall back to defaults if no mido.yml found
  let commitsConfig: CommitsConfig;
  try {
    const { config } = await loadConfig();
    commitsConfig = config.commits ?? FALLBACK_CONFIG;
  } catch {
    commitsConfig = FALLBACK_CONFIG;
  }

  const result = validateCommitMessage(message, commitsConfig);

  if (result.valid && result.issues.length === 0) {
    return 0;
  }

  // Show warnings even on valid commits
  if (result.valid) {
    for (const issue of result.issues) {
      console.error(`${WARN} ${YELLOW}${issue.field}:${RESET} ${issue.message}`);
    }
    return 0;
  }

  // Invalid — show header and all issues
  const header = message.split("\n")[0] ?? "";
  console.error(`\n${FAIL} ${BOLD}commit message invalid${RESET}\n`);
  console.error(`  header: ${DIM}"${header}"${RESET}`);

  for (const issue of result.issues) {
    const icon = issue.severity === "error" ? FAIL : WARN;
    console.error(`  ${icon} ${issue.field}: ${issue.message}`);
  }

  // Show helpful examples
  console.error("");
  console.error(`  ${DIM}Use: feat: add new feature${RESET}`);
  console.error(`  ${DIM}     fix(server): resolve auth timeout${RESET}`);
  console.error("");

  return 1;
}
