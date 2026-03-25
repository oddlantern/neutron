const VERSION = '0.0.8';

// ANSI 256-color: \x1b[38;5;208m = warm orange
const ORANGE = '\x1b[38;5;208m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const ART = `\
░███     ░███ ░██████░███████     ░██████
░████   ░████   ░██  ░██   ░██   ░██   ░██
░██░██ ░██░██   ░██  ░██    ░██ ░██     ░██
░██ ░████ ░██   ░██  ░██    ░██ ░██     ░██
░██  ░██  ░██   ░██  ░██    ░██ ░██     ░██
░██       ░██   ░██  ░██   ░██   ░██   ░██
░██       ░██ ░██████░███████     ░██████`;

const ART_WIDTH = 43;

export function printBanner(): void {
  const versionLine = `v${VERSION}`.padStart(ART_WIDTH);
  const tagLine = 'workspace guardian'.padStart(
    Math.floor((ART_WIDTH + 'workspace guardian'.length) / 2),
  );

  console.log(
    `\n${ORANGE}${ART}${RESET}\n${DIM}${versionLine}\n${tagLine}${RESET}\n`,
  );
}
