import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "@/config/loader";
import { buildWorkspaceGraph } from "@/graph/workspace";
import type { ParserRegistry } from "@/graph/workspace";
import { BOLD, DIM, FAIL, GREEN, PASS, RED, RESET, YELLOW } from "@/output";
import { findExperimentalEcosystems, loadPlugins, loadPluginsWithExternal } from "@/plugins/loader";
import { VERSION } from "@/version";

const WARN = `${YELLOW}!${RESET}`;

interface DiagResult {
  readonly label: string;
  readonly status: "ok" | "warn" | "fail";
  readonly detail: string;
}

function getVersion(cmd: string): string | null {
  try {
    const result = spawnSync(cmd, ["--version"], { encoding: "utf-8", timeout: 5000 });
    if (result.status !== 0 || !result.stdout) {
      return null;
    }
    return result.stdout.trim();
  } catch {
    return null;
  }
}

function checkTool(name: string, cmd: string): DiagResult {
  const version = getVersion(cmd);
  if (version) {
    return { label: name, status: "ok", detail: version };
  }
  return { label: name, status: "warn", detail: "not found" };
}

/**
 * Run workspace diagnostics — check health of neutron installation,
 * tool availability, config validity, hooks, and generated output.
 *
 * @returns exit code (0 = all ok, 1 = issues found)
 */
export async function runDoctor(parsers: ParserRegistry): Promise<number> {
  console.log(`\n${BOLD}neutron doctor${RESET} ${DIM}— v${VERSION}${RESET}\n`);

  const results: DiagResult[] = [];

  // 1. Config
  let root: string | null = null;
  try {
    const loaded = await loadConfig();
    root = loaded.root;
    const pkgCount = Object.values(loaded.config.ecosystems).reduce(
      (sum, eco) => sum + eco.packages.length,
      0,
    );
    results.push({
      label: "neutron.yml",
      status: "ok",
      detail: `${pkgCount} package(s), ${loaded.config.bridges?.length ?? 0} bridge(s)`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ label: "neutron.yml", status: "fail", detail: msg });
  }

  // 2. Git hooks
  if (root) {
    const hooksDir = join(root, ".git", "hooks");
    const hookNames = ["pre-commit", "commit-msg", "post-merge", "post-checkout"];
    let installedCount = 0;

    for (const hook of hookNames) {
      if (existsSync(join(hooksDir, hook))) {
        installedCount++;
      }
    }

    if (installedCount === hookNames.length) {
      results.push({
        label: "git hooks",
        status: "ok",
        detail: `${installedCount}/${hookNames.length} installed`,
      });
    } else if (installedCount > 0) {
      results.push({
        label: "git hooks",
        status: "warn",
        detail: `${installedCount}/${hookNames.length} installed — run \`neutron install\``,
      });
    } else {
      results.push({
        label: "git hooks",
        status: "warn",
        detail: "none installed — run `neutron install`",
      });
    }
  }

  // 3. Generated output
  if (root) {
    try {
      const loaded = await loadConfig();
      const graph = await buildWorkspaceGraph(loaded.config, root, parsers);
      const bridges = graph.bridges;
      let missingCount = 0;
      let presentCount = 0;

      for (const bridge of bridges) {
        for (const consumer of bridge.consumers) {
          const pkg = graph.packages.get(consumer.path);
          if (!pkg) {
            continue;
          }
          const genDir = join(root, bridge.source, "generated", pkg.ecosystem);
          if (existsSync(genDir)) {
            presentCount++;
          } else {
            missingCount++;
          }
        }
      }

      if (missingCount === 0 && presentCount > 0) {
        results.push({
          label: "generated output",
          status: "ok",
          detail: `${presentCount} output(s) present`,
        });
      } else if (missingCount > 0) {
        results.push({
          label: "generated output",
          status: "warn",
          detail: `${missingCount} missing — run \`neutron generate\``,
        });
      } else if (bridges.length === 0) {
        results.push({ label: "generated output", status: "ok", detail: "no bridges configured" });
      }
    } catch {
      // Config already reported as failing
    }
  }

  // 4. Experimental plugins in use
  if (root) {
    try {
      const loaded = await loadConfig();
      const ecosystemNames = Object.keys(loaded.config.ecosystems);
      const plugins = loadPlugins();
      const experimental = findExperimentalEcosystems(ecosystemNames, plugins.ecosystem);
      if (experimental.length > 0) {
        const names = experimental.map((p) => p.name).join(", ");
        results.push({
          label: "experimental plugins",
          status: "warn",
          detail: `${names} — feature parity in progress`,
        });
      }
    } catch {
      // Config failure already reported in section 1
    }
  }

  // 4b. External plugins — surface load results and errors
  if (root) {
    try {
      const loaded = await loadConfig();
      const declared = loaded.config.plugins ?? [];
      if (declared.length > 0) {
        const { external } = await loadPluginsWithExternal(declared, root);
        const failed = external.filter((e) => !e.loaded);
        const succeeded = external.filter((e) => e.loaded);

        if (succeeded.length > 0) {
          const names = succeeded.map((e) => `${e.packageName}[${e.plugins.length}]`).join(", ");
          results.push({
            label: "external plugins",
            status: "ok",
            detail: `${String(succeeded.length)} loaded — ${names}`,
          });
        }

        for (const entry of failed) {
          results.push({
            label: `external plugin ${entry.packageName}`,
            status: "fail",
            detail: entry.error ?? "unknown error",
          });
        }
      }
    } catch {
      // Config failure already reported in section 1
    }
  }

  // 5. Tool versions
  results.push(checkTool("node", "node"));

  const dartVersion = getVersion("dart");
  const flutterVersion = getVersion("flutter");
  if (dartVersion) {
    results.push({ label: "dart", status: "ok", detail: dartVersion });
  }
  if (flutterVersion) {
    results.push({ label: "flutter", status: "ok", detail: flutterVersion });
  }
  if (!dartVersion && !flutterVersion) {
    results.push({
      label: "dart/flutter",
      status: "warn",
      detail: "not found (only needed for Dart ecosystems)",
    });
  }

  // 6. Package manager
  if (root) {
    const lockfiles: ReadonlyArray<{ readonly file: string; readonly pm: string }> = [
      { file: "bun.lock", pm: "bun" },
      { file: "bun.lockb", pm: "bun" },
      { file: "pnpm-lock.yaml", pm: "pnpm" },
      { file: "yarn.lock", pm: "yarn" },
      { file: "package-lock.json", pm: "npm" },
    ];
    const detected = lockfiles.find((l) => existsSync(join(root, l.file)));
    if (detected) {
      const pmVersion = getVersion(detected.pm);
      results.push({
        label: "package manager",
        status: "ok",
        detail: `${detected.pm}${pmVersion ? ` (${pmVersion})` : ""}`,
      });
    } else {
      results.push({ label: "package manager", status: "warn", detail: "no lockfile detected" });
    }
  }

  // Print results — warnings are informational, only failures cause exit code 1
  let hasFailures = false;
  let hasWarnings = false;
  for (const r of results) {
    const icon = r.status === "ok" ? PASS : r.status === "warn" ? WARN : FAIL;
    if (r.status === "fail") {
      hasFailures = true;
    }
    if (r.status === "warn") {
      hasWarnings = true;
    }
    console.log(`  ${icon} ${BOLD}${r.label}${RESET} ${DIM}${r.detail}${RESET}`);
  }

  console.log();

  if (hasFailures) {
    console.log(`${RED}Issues found — fix errors above.${RESET}\n`);
    return 1;
  }

  if (hasWarnings) {
    console.log(`${GREEN}All good.${RESET} ${DIM}Warnings are informational.${RESET}\n`);
    return 0;
  }

  console.log(`${GREEN}All checks passed.${RESET}\n`);
  return 0;
}
