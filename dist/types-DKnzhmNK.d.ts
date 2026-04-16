import { r as Dependency } from "./types-D_z_ZsKS.js";

//#region src/parsers/types.d.ts

/**
 * Result of parsing a single manifest file.
 * Every ecosystem parser must return this shape.
 */
interface ParsedManifest {
  readonly name: string;
  readonly version: string | undefined;
  readonly dependencies: readonly Dependency[];
  /** Paths to local/path dependencies within the workspace */
  readonly localDependencyPaths: readonly string[];
}
/**
 * A manifest parser for a specific ecosystem.
 *
 * To add support for a new language:
 * 1. Implement this interface
 * 2. Register it in the parser registry
 *
 * The parser receives the absolute path to the manifest file
 * and must return a ParsedManifest or throw if the file is invalid.
 */
interface ManifestParser {
  /** The manifest filename this parser handles (e.g., "package.json", "pubspec.yaml") */
  readonly manifestName: string;
  /** Parse a manifest file and extract dependency information */
  parse(manifestPath: string): Promise<ParsedManifest>;
}
//#endregion
export { ParsedManifest as n, ManifestParser as t };
//# sourceMappingURL=types-DKnzhmNK.d.ts.map