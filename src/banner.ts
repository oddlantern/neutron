import { DIM, ORANGE, RESET } from "@/output";
import { VERSION } from "@/version";

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
  const tagLine = "workspace guardian".padStart(
    Math.floor((ART_WIDTH + "workspace guardian".length) / 2),
  );

  console.log(`\n${ORANGE}${ART}${RESET}\n${DIM}${versionLine}\n${tagLine}${RESET}\n`);
}
