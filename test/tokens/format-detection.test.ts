import { describe, expect, test } from "bun:test";

import type { WorkspacePackage } from "../../src/graph/types.js";
import { detectDesignFormat } from "../../src/plugins/builtin/domain/design/formats.js";

function makePkg(ecosystem: string, deps: string[] = []): WorkspacePackage {
  return {
    name: "test",
    path: "apps/test",
    ecosystem,
    version: "1.0.0",
    dependencies: deps.map((name) => ({ name, range: "^1.0.0", type: "production" as const })),
    localDependencies: [],
  };
}

describe("detectDesignFormat", () => {
  test("detects tailwind from tailwindcss dependency", () => {
    expect(detectDesignFormat(makePkg("typescript", ["tailwindcss", "react"]))).toBe("tailwind");
  });

  test("detects bootstrap from bootstrap dependency", () => {
    expect(detectDesignFormat(makePkg("typescript", ["bootstrap", "jquery"]))).toBe("bootstrap");
  });

  test("detects bootstrap from react-bootstrap", () => {
    expect(detectDesignFormat(makePkg("typescript", ["react-bootstrap"]))).toBe("bootstrap");
  });

  test("defaults to material3 for dart ecosystem", () => {
    expect(detectDesignFormat(makePkg("dart", ["flutter"]))).toBe("material3");
  });

  test("defaults to css for plain typescript", () => {
    expect(detectDesignFormat(makePkg("typescript", ["express"]))).toBe("css");
  });

  test("defaults to css for python", () => {
    expect(detectDesignFormat(makePkg("python", ["flask"]))).toBe("css");
  });

  test("tailwind takes precedence over bootstrap", () => {
    expect(detectDesignFormat(makePkg("typescript", ["tailwindcss", "bootstrap"]))).toBe("tailwind");
  });
});
