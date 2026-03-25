import type { FrameworkAdapter } from './types.js';
import { elysiaAdapter } from './elysia.js';
import { honoAdapter } from './hono.js';
import { fastifyAdapter } from './fastify.js';
import { expressAdapter } from './express.js';
import { nestjsAdapter } from './nestjs.js';
import { koaAdapter } from './koa.js';

export type { FrameworkAdapter } from './types.js';

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
