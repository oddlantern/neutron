import { packageJsonParser } from './parsers/package-json.js';
import { pubspecParser } from './parsers/pubspec.js';
import type { ManifestParser } from './parsers/types.js';

// Parser registry — add new ecosystem parsers here
const parsers = new Map<string, ManifestParser>([
  [packageJsonParser.manifestName, packageJsonParser],
  [pubspecParser.manifestName, pubspecParser],
]);

const HELP = `
mido — cross-ecosystem monorepo workspace tool

Usage:
  mido <command> [options]

Commands:
  check    Run all workspace consistency checks
  help     Show this help message

Options:
  --help, -h       Show help
  --version, -v    Show version
`;

const VERSION = '0.0.1';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    console.log(HELP);
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    process.exit(0);
  }

  if (command === 'check') {
    const { runCheck } = await import('./commands/check.js');
    const exitCode = await runCheck(parsers);
    process.exit(exitCode);
  }

  console.error(`Unknown command: ${command}\nRun "mido help" for usage.`);
  process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\x1b[31merror:\x1b[0m ${message}`);
  process.exit(1);
});
