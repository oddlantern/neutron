import type { FrameworkAdapter } from './types.js';

export const elysiaAdapter: FrameworkAdapter = {
  name: 'elysia',

  detect(deps: Record<string, string>): boolean {
    return 'elysia' in deps;
  },

  openapiPlugins: ['@elysiajs/openapi', '@elysiajs/swagger'],
  defaultSpecPath: '/openapi/json',
  fallbackSpecPaths: ['/swagger/json'],
};
