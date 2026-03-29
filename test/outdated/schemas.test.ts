import { describe, expect, test } from "bun:test";

import { parseNpmVersion, parsePubDevPackage } from "@/outdated/schemas";

describe("parseNpmVersion", () => {
  test("parses minimal valid response", () => {
    const result = parseNpmVersion({ version: "1.2.3" });
    expect(result).not.toBeNull();
    expect(result?.version).toBe("1.2.3");
  });

  test("parses full response with all fields", () => {
    const result = parseNpmVersion({
      version: "2.0.0",
      deprecated: "Use v3 instead",
      peerDependencies: { react: "^18.0.0" },
      repository: { type: "git", url: "https://github.com/org/repo.git" },
      dist: { tarball: "https://registry.npmjs.org/pkg/-/pkg-2.0.0.tgz" },
    });

    expect(result).not.toBeNull();
    expect(result?.version).toBe("2.0.0");
    expect(result?.deprecated).toBe("Use v3 instead");
    expect(result?.peerDependencies).toEqual({ react: "^18.0.0" });
    expect(result?.repository).toEqual({ type: "git", url: "https://github.com/org/repo.git" });
    expect(result?.dist?.tarball).toBe("https://registry.npmjs.org/pkg/-/pkg-2.0.0.tgz");
  });

  test("parses string repository", () => {
    const result = parseNpmVersion({
      version: "1.0.0",
      repository: "https://github.com/org/repo",
    });
    expect(result?.repository).toBe("https://github.com/org/repo");
  });

  test("returns null for invalid data", () => {
    expect(parseNpmVersion(null)).toBeNull();
    expect(parseNpmVersion("string")).toBeNull();
    expect(parseNpmVersion({})).toBeNull();
    expect(parseNpmVersion({ version: 123 })).toBeNull();
  });
});

describe("parsePubDevPackage", () => {
  test("parses valid response", () => {
    const result = parsePubDevPackage({
      latest: {
        version: "3.0.0",
        pubspec: { name: "my_package", dependencies: { http: "^1.0.0" } },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.latest.version).toBe("3.0.0");
  });

  test("parses response without pubspec", () => {
    const result = parsePubDevPackage({
      latest: { version: "1.0.0" },
    });

    expect(result).not.toBeNull();
    expect(result?.latest.version).toBe("1.0.0");
  });

  test("returns null for invalid data", () => {
    expect(parsePubDevPackage(null)).toBeNull();
    expect(parsePubDevPackage({})).toBeNull();
    expect(parsePubDevPackage({ latest: {} })).toBeNull();
    expect(parsePubDevPackage({ latest: { version: 123 } })).toBeNull();
  });
});
