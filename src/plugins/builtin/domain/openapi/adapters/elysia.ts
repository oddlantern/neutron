import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";

export const elysiaAdapter: FrameworkAdapter = {
  name: "elysia",

  detect(deps: Record<string, string>): boolean {
    return "elysia" in deps;
  },

  openapiPlugins: ["@elysiajs/openapi", "@elysiajs/swagger"],
  defaultSpecPath: "/openapi/json",
  fallbackSpecPaths: ["/swagger/json"],
};
