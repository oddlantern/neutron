/** Framework adapter for auto-detecting and fetching OpenAPI specs */
export interface FrameworkAdapter {
  /** Framework name for display */
  readonly name: string;
  /** Detect this framework from package dependencies */
  detect(deps: Record<string, string>): boolean;
  /** The OpenAPI plugin package name(s) to check for */
  readonly openapiPlugins: readonly string[];
  /** Default spec endpoint path */
  readonly defaultSpecPath: string;
  /** Alternative spec paths to try if default fails */
  readonly fallbackSpecPaths: readonly string[];
}
