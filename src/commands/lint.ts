import type { ParserRegistry } from "@/graph/workspace";
import { STANDARD_ACTIONS } from "@/plugins/types";

import type { EcosystemRunnerOptions } from "@/commands/ecosystem-runner";
import { runEcosystemCommand } from "@/commands/ecosystem-runner";

export interface LintOptions extends EcosystemRunnerOptions {
  readonly fix?: boolean | undefined;
}

/**
 * Run linters across all packages in the workspace.
 *
 * @returns exit code (0 = no errors, 1 = errors found)
 */
export async function runLint(parsers: ParserRegistry, options: LintOptions = {}): Promise<number> {
  const { fix = false, ...rest } = options;
  const action = fix ? STANDARD_ACTIONS.LINT_FIX : STANDARD_ACTIONS.LINT;

  return runEcosystemCommand(parsers, rest, {
    action,
    ignoreSource: "lint",
  });
}
