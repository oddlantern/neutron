import { typescriptPlugin } from "@/plugins/builtin/ecosystem/typescript/plugin";
import { dartPlugin } from "@/plugins/builtin/ecosystem/dart/plugin";
import { pythonPlugin } from "@/plugins/builtin/ecosystem/python/plugin";
import { rustPlugin } from "@/plugins/builtin/ecosystem/rust/plugin";
import { goPlugin } from "@/plugins/builtin/ecosystem/go/plugin";
import { phpPlugin } from "@/plugins/builtin/ecosystem/php/plugin";
import { assetsPlugin } from "@/plugins/builtin/domain/assets/plugin";
import { designPlugin } from "@/plugins/builtin/domain/design/plugin";
import { openapiPlugin } from "@/plugins/builtin/domain/openapi/plugin";
import { schemaPlugin } from "@/plugins/builtin/domain/schema/plugin";
import type { DomainPlugin, EcosystemPlugin } from "@/plugins/types";

export interface LoadedPlugins {
  readonly ecosystem: readonly EcosystemPlugin[];
  readonly domain: readonly DomainPlugin[];
}

/**
 * Load all plugins — builtins are always present.
 *
 * External plugins from devDependencies (neutron-plugin-*) will be loaded
 * on top of builtins when the external plugin system is implemented.
 */
export function loadPlugins(): LoadedPlugins {
  return {
    ecosystem: [typescriptPlugin, dartPlugin, pythonPlugin, rustPlugin, goPlugin, phpPlugin],
    domain: [designPlugin, openapiPlugin, assetsPlugin, schemaPlugin],
  };
}
