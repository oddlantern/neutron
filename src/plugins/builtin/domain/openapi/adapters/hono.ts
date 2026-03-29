import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";

export const honoAdapter: FrameworkAdapter = {
  name: "hono",

  detect(deps: Record<string, string>): boolean {
    return "hono" in deps;
  },

  openapiPlugins: ["hono-openapi", "@hono/zod-openapi", "@rcmade/hono-docs"],
  defaultSpecPath: "/openapi",
  fallbackSpecPaths: ["/doc", "/docs/open-api", "/api-docs"],
};
