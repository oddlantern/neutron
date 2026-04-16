import { cargoParser } from "@/parsers/cargo";
import { composerParser } from "@/parsers/composer";
import { goModParser } from "@/parsers/go-mod";
import { packageJsonParser } from "@/parsers/package-json";
import { pubspecParser } from "@/parsers/pubspec";
import { pyprojectParser } from "@/parsers/pyproject";
import type { ManifestParser, ParsedManifest } from "@/parsers/types";

export type { ManifestParser, ParsedManifest } from "@/parsers/types";

export { cargoParser } from "@/parsers/cargo";
export { composerParser } from "@/parsers/composer";
export { goModParser } from "@/parsers/go-mod";
export { packageJsonParser } from "@/parsers/package-json";
export { pubspecParser } from "@/parsers/pubspec";
export { pyprojectParser } from "@/parsers/pyproject";

/** All parsers shipped with neutron, keyed by their manifest filename. */
export const defaultParsers: ReadonlyMap<string, ManifestParser> = new Map<string, ManifestParser>([
  [packageJsonParser.manifestName, packageJsonParser],
  [pubspecParser.manifestName, pubspecParser],
  [pyprojectParser.manifestName, pyprojectParser],
  [cargoParser.manifestName, cargoParser],
  [goModParser.manifestName, goModParser],
  [composerParser.manifestName, composerParser],
]);

/**
 * Parse a manifest by filename using the default parser registry.
 * Throws if no parser is registered for the given manifest name.
 */
export async function parseManifest(
  manifestPath: string,
  manifestName: string,
): Promise<ParsedManifest> {
  const parser = defaultParsers.get(manifestName);
  if (!parser) {
    throw new Error(`No parser registered for manifest "${manifestName}"`);
  }
  return parser.parse(manifestPath);
}
