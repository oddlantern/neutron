import { n as ParsedManifest, t as ManifestParser } from "./types-DKnzhmNK.js";

//#region src/parsers/cargo.d.ts
declare const cargoParser: ManifestParser;
//#endregion
//#region src/parsers/composer.d.ts
declare const composerParser: ManifestParser;
//#endregion
//#region src/parsers/go-mod.d.ts
declare const goModParser: ManifestParser;
//#endregion
//#region src/parsers/package-json.d.ts
declare const packageJsonParser: ManifestParser;
//#endregion
//#region src/parsers/pubspec.d.ts
declare const pubspecParser: ManifestParser;
//#endregion
//#region src/parsers/pyproject.d.ts
declare const pyprojectParser: ManifestParser;
//#endregion
//#region src/parsers/index.d.ts
/** All parsers shipped with neutron, keyed by their manifest filename. */
declare const defaultParsers: ReadonlyMap<string, ManifestParser>;
/**
 * Parse a manifest by filename using the default parser registry.
 * Throws if no parser is registered for the given manifest name.
 */
declare function parseManifest(manifestPath: string, manifestName: string): Promise<ParsedManifest>;
//#endregion
export { packageJsonParser as a, cargoParser as c, pubspecParser as i, parseManifest as n, goModParser as o, pyprojectParser as r, composerParser as s, defaultParsers as t };
//# sourceMappingURL=index-BrsRxT0h.d.ts.map