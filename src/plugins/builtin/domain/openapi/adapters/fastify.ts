import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";

export const fastifyAdapter: FrameworkAdapter = {
  name: "fastify",

  detect(deps: Record<string, string>): boolean {
    return "fastify" in deps;
  },

  openapiPlugins: ["@fastify/swagger"],
  defaultSpecPath: "/documentation/json",
  fallbackSpecPaths: ["/swagger/json", "/openapi.json"],
};
