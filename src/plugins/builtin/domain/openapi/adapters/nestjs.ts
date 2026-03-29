import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";

export const nestjsAdapter: FrameworkAdapter = {
  name: "nestjs",

  detect(deps: Record<string, string>): boolean {
    return "@nestjs/core" in deps;
  },

  openapiPlugins: ["@nestjs/swagger"],
  defaultSpecPath: "/api-docs-json",
  fallbackSpecPaths: ["/swagger-json", "/openapi.json"],
};
