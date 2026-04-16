import { i as WorkspaceGraph } from "./types-D_z_ZsKS.js";
import { C as NeutronConfig } from "./schema-6LgP2m9L.js";
import { t as ManifestParser } from "./types-DKnzhmNK.js";

//#region src/graph/workspace.d.ts
/** Registry of parsers keyed by manifest filename */
type ParserRegistry = ReadonlyMap<string, ManifestParser>;
/**
 * Build the complete workspace graph from config and manifest parsers.
 *
 * Steps:
 * 1. For each ecosystem, resolve package paths
 * 2. Parse each manifest using the ecosystem's parser
 * 3. Resolve local dependency paths to workspace-relative paths
 * 4. Assemble bridges from config
 */
declare function buildWorkspaceGraph(config: NeutronConfig, root: string, parsers: ParserRegistry): Promise<WorkspaceGraph>;
//#endregion
export { buildWorkspaceGraph as n, ParserRegistry as t };
//# sourceMappingURL=workspace-Bb34gJ5L.d.ts.map