import { C as NeutronConfig } from "./schema-6LgP2m9L.js";

//#region src/config/loader.d.ts
interface LoadedConfig {
  readonly config: NeutronConfig;
  /** Absolute path to the workspace root (directory containing neutron.yml) */
  readonly root: string;
  /** Absolute path to the config file itself */
  readonly configPath: string;
}
/**
 * Locate and parse the neutron config file.
 * Searches upward from the given directory (defaults to cwd).
 *
 * @throws {Error} if no config file is found or validation fails
 */
declare function loadConfig(startDir?: string): Promise<LoadedConfig>;
//#endregion
export { loadConfig as n, LoadedConfig as t };
//# sourceMappingURL=loader-k3pySxPb.d.ts.map