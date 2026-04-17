import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";

/**
 * FastAPI provides OpenAPI export out of the box — there's no separate
 * OpenAPI plugin to install. Listing `fastapi` itself in openapiPlugins
 * satisfies the "framework + openapi capability present" contract used
 * by detectAdapter.
 */
export const fastapiAdapter: FrameworkAdapter = {
  name: "fastapi",
  ecosystem: "python",

  detect(deps: Record<string, string>): boolean {
    return "fastapi" in deps;
  },

  openapiPlugins: ["fastapi"],
  defaultSpecPath: "/openapi.json",
  fallbackSpecPaths: ["/api/openapi.json", "/docs/openapi.json"],
};
