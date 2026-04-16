//#region src/branding.ts
const PACKAGE_NAME = "@oddlantern/neutron";
const BINARY_NAME = "neutron";
const DISPLAY_NAME = "neutron";
const REPO_URL = "https://github.com/oddlantern/neutron";
/** Config filenames the tool searches for (in priority order). */
const CONFIG_FILENAMES = ["neutron.yml", "neutron.yaml"];
/** Version policy source of truth, lives at workspace root. */
const LOCK_FILENAME = "neutron.lock";
/** Cache directory under workspace node_modules for temp configs. */
const CACHE_DIR = "node_modules/.cache/neutron";
/** Marker substring in generated git-hook scripts identifying tool ownership. */
const HOOK_MARKER = BINARY_NAME;
/** HTTP User-Agent sent to external registries (npm, crates.io, pub.dev). */
const USER_AGENT = `${BINARY_NAME}-cli (${REPO_URL})`;
//#endregion
export { HOOK_MARKER as a, REPO_URL as c, DISPLAY_NAME as i, USER_AGENT as l, CACHE_DIR as n, LOCK_FILENAME as o, CONFIG_FILENAMES as r, PACKAGE_NAME as s, BINARY_NAME as t };

//# sourceMappingURL=branding-BIVXTc9K.js.map