import type { ParserRegistry } from "@/graph/workspace";
import { STANDARD_ACTIONS } from "@/plugins/types";

import type { EcosystemRunnerOptions } from "@/commands/ecosystem-runner";
import { runEcosystemCommand } from "@/commands/ecosystem-runner";

export interface FmtOptions extends EcosystemRunnerOptions {
  readonly check?: boolean | undefined;
}

/**
 * Run formatting across all packages in the workspace.
 *
 * @returns exit code (0 = all formatted, 1 = unformatted files found in check mode)
 */
export async function runFmt(parsers: ParserRegistry, options: FmtOptions = {}): Promise<number> {
  const { check = false, ...rest } = options;
  const action = check ? STANDARD_ACTIONS.FORMAT_CHECK : STANDARD_ACTIONS.FORMAT;

  return runEcosystemCommand(parsers, rest, {
    action,
    ignoreSource: "format",
  });
}
