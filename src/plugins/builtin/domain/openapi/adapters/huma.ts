import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";

/**
 * Huma — Go's modern OpenAPI-first framework. Handlers are regular Go
 * functions with struct-based input/output; huma derives the OpenAPI
 * 3.1 spec from those signatures and serves it directly.
 *
 * Works on top of gin, echo, chi, fiber, and net/http via humagin,
 * humaecho, humachi, humafiber packages — so detecting `huma` alone is
 * sufficient. The underlying router varies per user but the OpenAPI
 * endpoint lives on the huma API, not the router.
 *
 * Default spec path is `/openapi.json`. Apps can mount it elsewhere via
 * `config.OpenAPIPath`, so fallbacks cover common alternatives.
 *
 * Note: gin + swaggo/swag is a separate workflow (generate
 * docs/swagger.json at build time via the swag CLI) that doesn't match
 * neutron's boot-and-fetch pipeline. That integration can ship as a
 * later adapter that reads from the generated file instead of a live
 * endpoint.
 */
export const humaAdapter: FrameworkAdapter = {
  name: "huma",
  ecosystem: "go",

  detect(deps: Record<string, string>): boolean {
    // Huma releases under github.com/danielgtaylor/huma/v2. Match on
    // the import prefix so any v2+ version triggers detection.
    return Object.keys(deps).some((dep) => dep.startsWith("github.com/danielgtaylor/huma"));
  },

  openapiPlugins: ["github.com/danielgtaylor/huma/v2", "github.com/danielgtaylor/huma"],
  defaultSpecPath: "/openapi.json",
  fallbackSpecPaths: ["/api/openapi.json", "/docs/openapi.json", "/swagger/doc.json"],
};
