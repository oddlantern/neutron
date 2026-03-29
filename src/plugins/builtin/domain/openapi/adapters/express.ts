import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";

export const expressAdapter: FrameworkAdapter = {
  name: "express",

  detect(deps: Record<string, string>): boolean {
    return "express" in deps;
  },

  openapiPlugins: ["swagger-jsdoc", "swagger-ui-express", "express-openapi-validator"],
  defaultSpecPath: "/api-docs",
  fallbackSpecPaths: ["/swagger.json", "/openapi.json", "/docs/json"],
};
