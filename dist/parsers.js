import { a as pubspecParser, i as pyprojectParser, n as goModParser, o as packageJsonParser, r as cargoParser, t as composerParser } from "./composer-DfQKH7d7.js";
//#region src/parsers/index.ts
/** All parsers shipped with neutron, keyed by their manifest filename. */
const defaultParsers = new Map([
	[packageJsonParser.manifestName, packageJsonParser],
	[pubspecParser.manifestName, pubspecParser],
	[pyprojectParser.manifestName, pyprojectParser],
	[cargoParser.manifestName, cargoParser],
	[goModParser.manifestName, goModParser],
	[composerParser.manifestName, composerParser]
]);
/**
* Parse a manifest by filename using the default parser registry.
* Throws if no parser is registered for the given manifest name.
*/
async function parseManifest(manifestPath, manifestName) {
	const parser = defaultParsers.get(manifestName);
	if (!parser) throw new Error(`No parser registered for manifest "${manifestName}"`);
	return parser.parse(manifestPath);
}
//#endregion
export { cargoParser, composerParser, defaultParsers, goModParser, packageJsonParser, parseManifest, pubspecParser, pyprojectParser };

//# sourceMappingURL=parsers.js.map