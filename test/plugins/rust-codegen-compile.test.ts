import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "@/graph/types";
import type { ValidatedTokens } from "@/plugins/builtin/domain/design/types";
import { executeOpenapiModelGeneration } from "@/plugins/builtin/ecosystem/rust/openapi-codegen";
import { executeTokenGeneration } from "@/plugins/builtin/ecosystem/rust/token-codegen";
import type { ExecutionContext } from "@/plugins/types";

// End-to-end assertion that the Rust code our generators emit actually
// compiles under `cargo check`. Substring-level structure tests in the
// sibling codegen files are fast but don't catch syntax drift — a
// missing semicolon in a template would pass every structural test
// and break for real users. This closes that gap.
//
// `cargo check` reads the generated Cargo.toml, fetches any declared
// deps (serde for OpenAPI, none for tokens), and runs the type
// checker. It doesn't link or emit a binary, so it's fast enough to
// run per-test.

/** Returns true if `cargo` is on PATH. */
function hasCargo(): boolean {
  const result = spawnSync("cargo", ["--version"], { encoding: "utf-8" });
  return result.status === 0;
}

/** Returns true if there's network connectivity — `cargo check` needs
 *  to fetch serde for the OpenAPI tests. CI always has it; a dev on a
 *  plane doesn't, and the test should skip gracefully in that case. */
function hasNetwork(): boolean {
  const result = spawnSync("ping", ["-c", "1", "-t", "2", "crates.io"], {
    encoding: "utf-8",
  });
  return result.status === 0;
}

function makeTokens(): ValidatedTokens {
  return {
    standard: {
      brand: {},
      color: {
        primary: { light: "#0066ff", dark: "#4488ff" },
        accentColor: { light: "#ff6600", dark: "#ffaa44" },
      },
      spacing: { xs: 4, md: 16 },
      radius: { sm: 4, full: 9999 },
      elevation: {},
      shadowCard: undefined,
      iconSize: { md: 24 },
      typography: undefined,
    },
    extensions: {
      genres: {
        meta: { className: "GenreColors", getter: "genres" },
        fields: {
          fantasy: { light: "#aabbcc", dark: "#112233" },
        },
      },
    },
  };
}

function makePkg(): WorkspacePackage {
  return {
    name: "rust-codegen-compile",
    path: "packages/compile-check",
    ecosystem: "rust",
    version: "1.0.0",
    dependencies: [],
    localDependencies: [],
  };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "neutron-rust-compile-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeContext(outputDir: string, overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    graph: { name: "ws", root, packages: new Map(), bridges: [] },
    packageManager: "bun",
    root,
    findEcosystemHandlers: async () => [],
    outputDir,
    sourceName: "compile-check",
    ...overrides,
  };
}

/**
 * Run `cargo check` on a generated crate. Returns the child output.
 *
 * `offline` controls whether cargo is allowed to fetch. The tokens
 * crate has no deps so it runs offline for speed; the OpenAPI crate
 * depends on serde, which cargo resolves from crates.io on a cold
 * cache.
 */
function cargoCheck(
  cratePath: string,
  offline: boolean,
): { readonly status: number; readonly output: string } {
  const args = ["check", "--manifest-path", join(cratePath, "Cargo.toml")];
  if (offline) args.push("--offline");
  const result = spawnSync("cargo", args, { encoding: "utf-8", timeout: 180_000 });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

const cargoAvailable = hasCargo();
const networkAvailable = cargoAvailable && hasNetwork();

describe("rust codegen compile-check — tokens", () => {
  // Tokens crate declares no dependencies, so cargo check works
  // offline. Only gate on cargo presence.
  test.skipIf(!cargoAvailable)("generated tokens crate compiles under cargo check", () => {
    const outDir = join(root, "out");
    const result = executeTokenGeneration(makePkg(), root, makeContext(outDir, { domainData: makeTokens() }));
    expect(result.success).toBe(true);

    const check = cargoCheck(outDir, true);
    if (check.status !== 0) {
      // Surface cargo's error output in the test failure so diagnosing
      // a syntax regression doesn't require a local repro.
      throw new Error(`cargo check failed (exit ${String(check.status)}):\n${check.output}`);
    }
    expect(check.status).toBe(0);
  }, 60_000);
});

describe("rust codegen compile-check — openapi models", () => {
  // OpenAPI crate depends on serde + serde_json, so cargo check needs
  // network on a cold cache. Gate on both.
  test.skipIf(!networkAvailable)("generated openapi crate compiles under cargo check", async () => {
    const artifactPath = "openapi.json";
    writeFileSync(
      join(root, artifactPath),
      JSON.stringify({
        openapi: "3.1.0",
        components: {
          schemas: {
            User: {
              type: "object",
              properties: {
                id: { type: "string" },
                age: { type: "integer" },
                active: { type: "boolean" },
              },
              required: ["id"],
            },
            Order: {
              type: "object",
              properties: {
                total: { type: "number" },
                items: { type: "array", items: { type: "string" } },
              },
            },
          },
        },
      }),
      "utf-8",
    );

    const outDir = join(root, "out");
    const result = await executeOpenapiModelGeneration(
      makePkg(),
      root,
      makeContext(outDir, { artifactPath }),
    );
    expect(result.success).toBe(true);

    const check = cargoCheck(outDir, false);
    if (check.status !== 0) {
      throw new Error(`cargo check failed (exit ${String(check.status)}):\n${check.output}`);
    }
    expect(check.status).toBe(0);
  }, 180_000);
});
