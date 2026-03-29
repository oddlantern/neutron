import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";

export const koaAdapter: FrameworkAdapter = {
  name: "koa",

  detect(deps: Record<string, string>): boolean {
    return "koa" in deps;
  },

  openapiPlugins: ["koa2-swagger-ui", "swagger-jsdoc"],
  defaultSpecPath: "/swagger.json",
  fallbackSpecPaths: ["/api-docs", "/openapi.json"],
};
