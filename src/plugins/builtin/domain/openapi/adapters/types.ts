/** Framework adapter for auto-detecting and fetching OpenAPI specs */
export interface FrameworkAdapter {
  /** Framework name for display */
  readonly name: string;
  /**
   * Ecosystem this framework belongs to. Drives manifest reading
   * (package.json vs pyproject.toml vs Cargo.toml) and server-boot
   * command selection (node vs uvicorn vs cargo run). Defaults to
   * typescript when omitted so existing adapters don't need to set it.
   */
  readonly ecosystem?: "typescript" | "python" | "rust" | "go";
  /** Detect this framework from package dependencies */
  detect(deps: Record<string, string>): boolean;
  /** The OpenAPI plugin package name(s) to check for */
  readonly openapiPlugins: readonly string[];
  /** Default spec endpoint path */
  readonly defaultSpecPath: string;
  /** Alternative spec paths to try if default fails */
  readonly fallbackSpecPaths: readonly string[];
}
