import type { FrameworkAdapter } from "./types.js";

export const fastifyAdapter: FrameworkAdapter = {
  name: "fastify",

  detect(deps: Record<string, string>): boolean {
    return "fastify" in deps;
  },

  openapiPlugins: ["@fastify/swagger"],
  defaultSpecPath: "/documentation/json",
  fallbackSpecPaths: ["/swagger/json", "/openapi.json"],
};
