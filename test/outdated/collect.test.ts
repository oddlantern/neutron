import { describe, expect, test } from "bun:test";

import { collectDeps, stripRange, classifyUpdate, buildWorkspaceDepsMap } from "@/outdated/collect";
import type { WorkspacePackage } from "@/graph/types";

function makePkg(
  name: string,
  path: string,
  ecosystem: string,
  deps: readonly { name: string; range: string; type: "production" | "dev" }[],
): WorkspacePackage {
  return {
    name,
    path,
    ecosystem,
    version: "1.0.0",
    dependencies: deps.map((d) => ({ ...d })),
    localDependencies: [],
  };
}

describe("collectDeps", () => {
  test("groups production deps by ecosystem::name", () => {
    const packages = new Map<string, WorkspacePackage>([
      ["apps/web", makePkg("web", "apps/web", "typescript", [
        { name: "react", range: "^18.0.0", type: "production" },
        { name: "typescript", range: "^5.0.0", type: "dev" },
      ])],
      ["apps/server", makePkg("server", "apps/server", "typescript", [
        { name: "react", range: "^18.0.0", type: "production" },
      ])],
    ]);

    const deps = collectDeps(packages);

    expect(deps).toHaveLength(1); // Only react (production), not typescript (dev)
    expect(deps[0]?.name).toBe("react");
    expect(deps[0]?.packages).toHaveLength(2);
  });

  test("skips dev dependencies", () => {
    const packages = new Map<string, WorkspacePackage>([
      ["apps/web", makePkg("web", "apps/web", "typescript", [
        { name: "vitest", range: "^1.0.0", type: "dev" },
      ])],
    ]);

    const deps = collectDeps(packages);
    expect(deps).toHaveLength(0);
  });

  test("sorts by package count descending", () => {
    const packages = new Map<string, WorkspacePackage>([
      ["a", makePkg("a", "a", "typescript", [
        { name: "lodash", range: "^4.0.0", type: "production" },
        { name: "zod", range: "^3.0.0", type: "production" },
      ])],
      ["b", makePkg("b", "b", "typescript", [
        { name: "zod", range: "^3.0.0", type: "production" },
      ])],
      ["c", makePkg("c", "c", "typescript", [
        { name: "zod", range: "^3.0.0", type: "production" },
      ])],
    ]);

    const deps = collectDeps(packages);
    expect(deps[0]?.name).toBe("zod"); // 3 packages
    expect(deps[1]?.name).toBe("lodash"); // 1 package
  });
});

describe("stripRange", () => {
  test("strips ^", () => expect(stripRange("^1.2.3")).toBe("1.2.3"));
  test("strips ~", () => expect(stripRange("~1.2.3")).toBe("1.2.3"));
  test("strips >=", () => expect(stripRange(">=1.2.3")).toBe("1.2.3"));
  test("handles bare version", () => expect(stripRange("1.2.3")).toBe("1.2.3"));
  test("handles range with space", () => expect(stripRange(">=1.0.0 <2.0.0")).toBe("1.0.0"));
});

describe("classifyUpdate", () => {
  test("detects major", () => expect(classifyUpdate("1.2.3", "2.0.0")).toBe("major"));
  test("detects minor", () => expect(classifyUpdate("1.2.3", "1.3.0")).toBe("minor"));
  test("detects patch", () => expect(classifyUpdate("1.2.3", "1.2.4")).toBe("patch"));
  test("returns null when same", () => expect(classifyUpdate("1.2.3", "1.2.3")).toBe(null));
  test("returns null for invalid", () => expect(classifyUpdate("abc", "1.0.0")).toBe(null));
});

describe("buildWorkspaceDepsMap", () => {
  test("builds flat map from all packages", () => {
    const packages = new Map<string, WorkspacePackage>([
      ["a", makePkg("a", "a", "typescript", [
        { name: "react", range: "^18.0.0", type: "production" },
        { name: "zod", range: "^3.0.0", type: "dev" },
      ])],
      ["b", makePkg("b", "b", "typescript", [
        { name: "lodash", range: "^4.0.0", type: "production" },
      ])],
    ]);

    const map = buildWorkspaceDepsMap(packages);
    expect(map.get("react")).toBe("^18.0.0");
    expect(map.get("zod")).toBe("^3.0.0");
    expect(map.get("lodash")).toBe("^4.0.0");
  });

  test("first occurrence wins for duplicate names", () => {
    const packages = new Map<string, WorkspacePackage>([
      ["a", makePkg("a", "a", "typescript", [
        { name: "react", range: "^18.0.0", type: "production" },
      ])],
      ["b", makePkg("b", "b", "typescript", [
        { name: "react", range: "^17.0.0", type: "production" },
      ])],
    ]);

    const map = buildWorkspaceDepsMap(packages);
    expect(map.get("react")).toBe("^18.0.0"); // First wins
  });
});
