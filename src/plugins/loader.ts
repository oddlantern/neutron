import { typescriptPlugin } from './builtin/typescript.js';
import { dartPlugin } from './builtin/dart.js';
import { openapiPlugin } from './builtin/openapi.js';
import type { DomainPlugin, EcosystemPlugin } from './types.js';

export interface LoadedPlugins {
  readonly ecosystem: readonly EcosystemPlugin[];
  readonly domain: readonly DomainPlugin[];
}

/**
 * Load all plugins — builtins are always present.
 *
 * External plugins from devDependencies (mido-plugin-*) will be loaded
 * on top of builtins when the external plugin system is implemented.
 */
export function loadPlugins(): LoadedPlugins {
  return {
    ecosystem: [typescriptPlugin, dartPlugin],
    domain: [openapiPlugin],
  };
}
