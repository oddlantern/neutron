import type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";
import { elysiaAdapter } from "@/plugins/builtin/domain/openapi/adapters/elysia";
import { honoAdapter } from "@/plugins/builtin/domain/openapi/adapters/hono";
import { fastifyAdapter } from "@/plugins/builtin/domain/openapi/adapters/fastify";
import { expressAdapter } from "@/plugins/builtin/domain/openapi/adapters/express";
import { nestjsAdapter } from "@/plugins/builtin/domain/openapi/adapters/nestjs";
import { koaAdapter } from "@/plugins/builtin/domain/openapi/adapters/koa";
import { fastapiAdapter } from "@/plugins/builtin/domain/openapi/adapters/fastapi";
import { axumAdapter } from "@/plugins/builtin/domain/openapi/adapters/axum";
import { humaAdapter } from "@/plugins/builtin/domain/openapi/adapters/huma";

export type { FrameworkAdapter } from "@/plugins/builtin/domain/openapi/adapters/types";

/**
 * Ordered list of framework adapters.
 * More specific frameworks come first to avoid false positives
 * (e.g., NestJS uses Express or Fastify underneath).
 */
const ADAPTERS: readonly FrameworkAdapter[] = [
  nestjsAdapter,
  elysiaAdapter,
  honoAdapter,
  fastifyAdapter,
  expressAdapter,
  koaAdapter,
  fastapiAdapter,
  axumAdapter,
  humaAdapter,
];

/**
 * Detect which framework adapter matches the given package dependencies.
 * Checks for both the framework dep and at least one OpenAPI plugin dep.
 * Returns the first match, or null if no adapter applies.
 */
export function detectAdapter(deps: Record<string, string>): FrameworkAdapter | null {
  for (const adapter of ADAPTERS) {
    if (!adapter.detect(deps)) {
      continue;
    }

    const hasOpenapiPlugin = adapter.openapiPlugins.some((plugin) => plugin in deps);
    if (hasOpenapiPlugin) {
      return adapter;
    }
  }

  return null;
}
