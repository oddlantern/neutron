import type { ParserRegistry } from '../graph/workspace.js';
import { GREEN, RED, RESET } from '../output.js';
import { runFmt } from './fmt.js';
import { runLint } from './lint.js';
import { runCheck } from './check.js';

const PASS = `${GREEN}✓${RESET}`;
const FAIL = `${RED}✗${RESET}`;

interface PreCommitStep {
  readonly name: string;
  readonly run: () => Promise<number>;
}

/**
 * Run the full pre-commit validation suite.
 * Stops on first failure for fast feedback.
 *
 * Order: format check → lint → workspace check
 *
 * @returns exit code (0 = all pass, 1 = any failure)
 */
export async function runPreCommit(parsers: ParserRegistry): Promise<number> {
  const steps: readonly PreCommitStep[] = [
    {
      name: 'format',
      run: () => runFmt(parsers, { check: true, quiet: true }),
    },
    {
      name: 'lint',
      run: () => runLint(parsers, { quiet: true }),
    },
    {
      name: 'workspace',
      run: () => runCheck(parsers, { quiet: true }),
    },
  ];

  for (const step of steps) {
    const exitCode = await step.run();

    if (exitCode !== 0) {
      console.log(`${FAIL} ${step.name}`);
      return 1;
    }

    console.log(`${PASS} ${step.name}`);
  }

  return 0;
}
