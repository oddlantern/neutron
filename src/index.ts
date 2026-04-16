// Root barrel — curated highlights for one-line consumers.
// For tree-shakable subpath imports, use the per-domain entries:
//   "@oddlantern/neutron/config", "/graph", "/parsers", "/plugins", "/checks"

export { VERSION } from "@/version";

// Config
export { loadConfig, type LoadedConfig } from "@/config/loader";
export { configSchema, type NeutronConfig } from "@/config/schema";

// Graph
export { buildWorkspaceGraph, type ParserRegistry } from "@/graph/workspace";
export type {
  Bridge,
  BridgeConsumer,
  Dependency,
  WorkspaceGraph,
  WorkspacePackage,
} from "@/graph/types";

// Parsers
export { defaultParsers, parseManifest } from "@/parsers/index";
export type { ManifestParser, ParsedManifest } from "@/parsers/types";

// Plugins
export {
  STANDARD_ACTIONS,
  type DomainPlugin,
  type EcosystemPlugin,
  type ExecuteResult,
  type ExecutionContext,
  type NeutronPlugin,
} from "@/plugins/types";

// Checks
export type { CheckIssue, CheckResult, Severity } from "@/checks/types";
