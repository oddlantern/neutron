import { describe, expect, test } from "bun:test";

import { findExperimentalEcosystems } from "@/plugins/loader";
import type { EcosystemPlugin } from "@/plugins/types";

// findExperimentalEcosystems drives the warnings shown by `neutron doctor`
// and `neutron init`. Misreporting means users either miss the warning
// or get spooked about a stable plugin — both bad. Test the matrix
// explicitly.

function mkPlugin(name: string, experimental: boolean): EcosystemPlugin {
  return {
    type: "ecosystem",
    name,
    manifest: `${name}.manifest`,
    experimental,
    detect: async () => false,
    getWatchPatterns: async () => [],
    getActions: async () => [],
    execute: async () => ({ success: true, duration: 0, summary: "" }),
  };
}

describe("findExperimentalEcosystems", () => {
  const typescript = mkPlugin("typescript", false);
  const python = mkPlugin("python", true);
  const rust = mkPlugin("rust", true);
  const go = mkPlugin("go", true);

  test("returns only experimental plugins that are in use", () => {
    const result = findExperimentalEcosystems(
      ["typescript", "python"],
      [typescript, python, rust, go],
    );
    expect(result.map((p) => p.name)).toEqual(["python"]);
  });

  test("returns empty when no used ecosystems are experimental", () => {
    const result = findExperimentalEcosystems(["typescript"], [typescript, python]);
    expect(result).toHaveLength(0);
  });

  test("returns empty when experimental plugins exist but aren't used", () => {
    // Rust plugin is experimental but not declared in this workspace.
    const result = findExperimentalEcosystems(["typescript"], [typescript, rust]);
    expect(result).toHaveLength(0);
  });

  test("returns multiple when several experimental ecosystems are in use", () => {
    const result = findExperimentalEcosystems(
      ["python", "rust", "go"],
      [typescript, python, rust, go],
    );
    expect(result.map((p) => p.name).sort()).toEqual(["go", "python", "rust"]);
  });

  test("treats experimental=false the same as undefined (stable)", () => {
    const explicitStable = { ...mkPlugin("foo", false) };
    const implicitStable: EcosystemPlugin = { ...explicitStable };
    // Manually strip the experimental field to simulate a plugin that
    // omitted the flag entirely — should be treated as stable.
    delete (implicitStable as { experimental?: boolean }).experimental;

    expect(findExperimentalEcosystems(["foo"], [explicitStable])).toHaveLength(0);
    expect(findExperimentalEcosystems(["foo"], [implicitStable])).toHaveLength(0);
  });

  test("empty inputs produce empty output", () => {
    expect(findExperimentalEcosystems([], [python, rust])).toHaveLength(0);
    expect(findExperimentalEcosystems(["python"], [])).toHaveLength(0);
  });
});
