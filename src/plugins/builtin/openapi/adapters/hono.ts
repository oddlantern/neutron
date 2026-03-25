import type { FrameworkAdapter } from './types.js';

export const honoAdapter: FrameworkAdapter = {
  name: 'hono',

  detect(deps: Record<string, string>): boolean {
    return 'hono' in deps;
  },

  openapiPlugins: ['hono-openapi', '@hono/zod-openapi', '@rcmade/hono-docs'],
  defaultSpecPath: '/openapi',
  fallbackSpecPaths: ['/doc', '/docs/open-api', '/api-docs'],
};
