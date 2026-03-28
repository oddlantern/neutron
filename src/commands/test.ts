import type { ParserRegistry } from "../graph/workspace.js";
import { STANDARD_ACTIONS } from "../plugins/types.js";

import type { EcosystemRunnerOptions } from "./ecosystem-runner.js";
import { runEcosystemCommand } from "./ecosystem-runner.js";

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
    summary: ["All tests passed", "Test failures found"],
  });
}
