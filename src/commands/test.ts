import type { ParserRegistry } from "@/graph/workspace";
import { STANDARD_ACTIONS } from "@/plugins/types";

import type { EcosystemRunnerOptions } from "@/commands/ecosystem-runner";
import { runEcosystemCommand } from "@/commands/ecosystem-runner";

export type TestOptions = EcosystemRunnerOptions;

/**
 * Run tests across all packages in the workspace.
 *
 * @returns exit code (0 = all passed, 1 = failures)
 */
export async function runTest(parsers: ParserRegistry, options: TestOptions = {}): Promise<number> {
  return runEcosystemCommand(parsers, options, {
    action: STANDARD_ACTIONS.TEST,
    ignoreSource: "lint",
  });
}
