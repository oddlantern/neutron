// Central identity constants. Rename/rebrand = edit this file.
// Anywhere else in src/ that references these values imports from here.

export const PACKAGE_NAME = "@oddlantern/neutron";
export const BINARY_NAME = "neutron";
export const DISPLAY_NAME = "neutron";
export const REPO_URL = "https://github.com/oddlantern/neutron";

/** Config filenames the tool searches for (in priority order). */
export const CONFIG_FILENAMES = ["neutron.yml", "neutron.yaml"] as const;

/** Version policy source of truth, lives at workspace root. */
export const LOCK_FILENAME = "neutron.lock";

/** State directory for reports, graph HTML, artifacts. */
export const STATE_DIR = ".neutron";

/** Cache directory under workspace node_modules for temp configs. */
export const CACHE_DIR = "node_modules/.cache/neutron";

/** Marker substring in generated git-hook scripts identifying tool ownership. */
export const HOOK_MARKER = BINARY_NAME;

/** HTTP User-Agent sent to external registries (npm, crates.io, pub.dev). */
export const USER_AGENT = `${BINARY_NAME}-cli (${REPO_URL})`;
