import type { FrameworkAdapter } from "./types.js";

export const nestjsAdapter: FrameworkAdapter = {
  name: "nestjs",

  detect(deps: Record<string, string>): boolean {
    return "@nestjs/core" in deps;
  },

  openapiPlugins: ["@nestjs/swagger"],
  defaultSpecPath: "/api-docs-json",
  fallbackSpecPaths: ["/swagger-json", "/openapi.json"],
};
