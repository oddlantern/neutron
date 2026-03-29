import { typescriptPlugin } from "@/plugins/builtin/ecosystem/typescript/plugin";
import { dartPlugin } from "@/plugins/builtin/ecosystem/dart/plugin";
import { assetsPlugin } from "@/plugins/builtin/domain/assets/plugin";
import { designPlugin } from "@/plugins/builtin/domain/design/plugin";
import { openapiPlugin } from "@/plugins/builtin/domain/openapi/plugin";
import type { DomainPlugin, EcosystemPlugin } from "@/plugins/types";

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
    domain: [designPlugin, openapiPlugin, assetsPlugin],
  };
}
