import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

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
import { isRecord } from "@/guards";
import type { DomainPlugin, EcosystemPlugin } from "@/plugins/types";

export interface LoadedPlugins {
  readonly ecosystem: readonly EcosystemPlugin[];
  readonly domain: readonly DomainPlugin[];
}

/** Per-package outcome of external plugin loading. Surfaced by doctor. */
export interface ExternalPluginReport {
  readonly packageName: string;
  readonly loaded: boolean;
  readonly plugins: readonly { readonly name: string; readonly type: "ecosystem" | "domain" }[];
  readonly error?: string | undefined;
}

export interface LoadedPluginsWithReport {
  readonly loaded: LoadedPlugins;
  readonly external: readonly ExternalPluginReport[];
}

const BUILTIN_ECOSYSTEM: readonly EcosystemPlugin[] = [
  typescriptPlugin,
  dartPlugin,
  pythonPlugin,
  rustPlugin,
  goPlugin,
  phpPlugin,
];
const BUILTIN_DOMAIN: readonly DomainPlugin[] = [
  designPlugin,
  openapiPlugin,
  assetsPlugin,
  schemaPlugin,
];

/**
 * Load builtin plugins only. Prefer `loadPluginsFromConfig` when a
 * config is available — this stays for tests and paths that have no
 * workspace context.
 */
export function loadPlugins(): LoadedPlugins {
  return { ecosystem: BUILTIN_ECOSYSTEM, domain: BUILTIN_DOMAIN };
}

/**
 * Load builtin plugins plus externals declared in `neutron.yml.plugins`.
 *
 * Every command that uses plugins should go through this helper so
 * external plugins declared by the user actually take effect.
 * Load failures are surfaced to stderr — users need to know their
 * declared plugin didn't load even from commands that don't render a
 * full per-plugin report.
 *
 * Runs doctor's full reporting? Use `loadPluginsWithExternal` directly
 * to get the structured report.
 */
export async function loadPluginsFromConfig(
  config: { readonly plugins?: readonly string[] | undefined },
  root: string,
): Promise<LoadedPlugins> {
  const declared = config.plugins ?? [];
  if (declared.length === 0) {
    return loadPlugins();
  }
  const { loaded, external } = await loadPluginsWithExternal(declared, root);
  for (const report of external) {
    if (!report.loaded) {
      console.error(
        `[neutron] external plugin "${report.packageName}" failed to load: ${report.error ?? "unknown error"}`,
      );
    }
  }
  return loaded;
}

/**
 * Validate that an unknown value has the minimum shape of a plugin.
 * Broad enough to let reasonable plugins through; strict enough to
 * catch wrong default exports and missing methods up front.
 */
export function classifyPlugin(value: unknown): EcosystemPlugin | DomainPlugin | null {
  if (!isRecord(value)) return null;
  if (typeof value["name"] !== "string") return null;

  const type = value["type"];
  if (type === "ecosystem") {
    if (
      typeof value["manifest"] === "string" &&
      typeof value["detect"] === "function" &&
      typeof value["execute"] === "function"
    ) {
      return value as unknown as EcosystemPlugin;
    }
  }
  if (type === "domain") {
    if (
      typeof value["detectBridge"] === "function" &&
      typeof value["exportArtifact"] === "function"
    ) {
      return value as unknown as DomainPlugin;
    }
  }
  return null;
}

/**
 * Extract plugin(s) from an imported module. Supports three shapes so
 * plugin authors can pick what fits their package layout:
 *   - `export default <plugin>` — single plugin default export
 *   - `export const plugin = ...` — named `plugin` export
 *   - `export const plugins = [...]` — array of plugins in one package
 */
export function extractPlugins(mod: unknown): readonly (EcosystemPlugin | DomainPlugin)[] {
  if (!isRecord(mod)) return [];
  const found: (EcosystemPlugin | DomainPlugin)[] = [];

  const defaultPlugin = classifyPlugin(mod["default"]);
  if (defaultPlugin) found.push(defaultPlugin);

  const pluginExport = classifyPlugin(mod["plugin"]);
  if (pluginExport && !found.includes(pluginExport)) found.push(pluginExport);

  const pluginsArr = mod["plugins"];
  if (Array.isArray(pluginsArr)) {
    for (const entry of pluginsArr) {
      const plugin = classifyPlugin(entry);
      if (plugin && !found.includes(plugin)) found.push(plugin);
    }
  }

  return found;
}

/**
 * Resolve a package name through the workspace's module resolution
 * (not neutron's own) and import it. Returns both the report and the
 * extracted plugin instances when successful.
 */
async function loadOne(
  packageName: string,
  root: string,
): Promise<{
  readonly report: ExternalPluginReport;
  readonly plugins: readonly (EcosystemPlugin | DomainPlugin)[];
}> {
  try {
    const req = createRequire(`${root}/__neutron_external_plugin_loader__.js`);
    const resolved = req.resolve(packageName);
    const mod: unknown = await import(pathToFileURL(resolved).href);
    const plugins = extractPlugins(mod);

    if (plugins.length === 0) {
      return {
        report: {
          packageName,
          loaded: false,
          plugins: [],
          error:
            "package loaded but exports no plugin. Expected default export, `plugin` named export, or `plugins` array.",
        },
        plugins: [],
      };
    }

    return {
      report: {
        packageName,
        loaded: true,
        plugins: plugins.map((p) => ({ name: p.name, type: p.type })),
      },
      plugins,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      report: { packageName, loaded: false, plugins: [], error: msg },
      plugins: [],
    };
  }
}

/**
 * Load builtin plugins plus any external plugins declared in
 * `neutron.yml`. Returns both the merged plugin set and a per-package
 * report so doctor/init can surface load failures clearly.
 *
 * External plugins override builtins on name collision — user-installed
 * plugins are explicit choices; silently ignoring them on conflict
 * would be more surprising than letting them replace the builtin.
 */
export async function loadPluginsWithExternal(
  pluginPackages: readonly string[],
  root: string,
): Promise<LoadedPluginsWithReport> {
  const reports: ExternalPluginReport[] = [];
  const externalEcosystem: EcosystemPlugin[] = [];
  const externalDomain: DomainPlugin[] = [];

  for (const pkg of pluginPackages) {
    const { report, plugins } = await loadOne(pkg, root);
    reports.push(report);
    for (const plugin of plugins) {
      if (plugin.type === "ecosystem") {
        externalEcosystem.push(plugin);
      } else {
        externalDomain.push(plugin);
      }
    }
  }

  return {
    loaded: {
      ecosystem: mergeByName(BUILTIN_ECOSYSTEM, externalEcosystem),
      domain: mergeByName(BUILTIN_DOMAIN, externalDomain),
    },
    external: reports,
  };
}

/**
 * Merge two plugin lists, preferring the second list's entries on
 * name collision. External plugins override builtins.
 */
function mergeByName<T extends { readonly name: string }>(
  builtin: readonly T[],
  external: readonly T[],
): readonly T[] {
  const externalNames = new Set(external.map((p) => p.name));
  return [...builtin.filter((p) => !externalNames.has(p.name)), ...external];
}

/**
 * Return the experimental ecosystem plugins that are actually used in
 * the workspace (i.e. have matching ecosystem entries in the config).
 * Callers render warnings so users know which parts of the tool haven't
 * reached feature parity yet.
 */
export function findExperimentalEcosystems(
  usedEcosystems: readonly string[],
  plugins: readonly EcosystemPlugin[],
): readonly EcosystemPlugin[] {
  const used = new Set(usedEcosystems);
  return plugins.filter((p) => p.experimental === true && used.has(p.name));
}
