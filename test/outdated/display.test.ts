import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";

import {
  formatRiskBadge,
  formatJsonOutput,
  formatLevel1Results,
  formatLevel2Results,
  formatLevel3Results,
} from "@/outdated/display";
import type {
  OutdatedDep,
  RiskScore,
  StaticAnalysisResult,
  ValidationResult,
} from "@/outdated/types";

function makeRisk(total: number): RiskScore {
  return { total, severity: 0, affectedCount: 0, deprecation: 0, peerConflicts: 0 };
}

function makeOutdatedDep(overrides: Partial<OutdatedDep> = {}): OutdatedDep {
  return {
    name: "test-pkg",
    ecosystem: "typescript",
    workspaceRange: "^1.0.0",
    packages: ["apps/web"],
    latest: "2.0.0",
    severity: "major",
    metadata: {
      latest: "2.0.0",
      deprecated: undefined,
      peerDependencies: undefined,
      repositoryUrl: undefined,
      tarballUrl: undefined,
      changelogUrl: undefined,
    },
    peerConflicts: [],
    risk: makeRisk(45),
    ...overrides,
  };
}

describe("formatRiskBadge", () => {
  test("LOW for score 0-25", () => {
    expect(formatRiskBadge(makeRisk(0))).toContain("LOW");
    expect(formatRiskBadge(makeRisk(25))).toContain("LOW");
  });

  test("MODERATE for score 26-50", () => {
    expect(formatRiskBadge(makeRisk(26))).toContain("MODERATE");
    expect(formatRiskBadge(makeRisk(50))).toContain("MODERATE");
  });

  test("HIGH for score 51-75", () => {
    expect(formatRiskBadge(makeRisk(51))).toContain("HIGH");
    expect(formatRiskBadge(makeRisk(75))).toContain("HIGH");
  });

  test("CRITICAL for score 76-100", () => {
    expect(formatRiskBadge(makeRisk(76))).toContain("CRITICAL");
    expect(formatRiskBadge(makeRisk(100))).toContain("CRITICAL");
  });
});

describe("formatJsonOutput", () => {
  test("serializes outdated deps to JSON", () => {
    const dep = makeOutdatedDep();
    const json = formatJsonOutput([dep]);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("test-pkg");
    expect(parsed[0].latest).toBe("2.0.0");
    expect(parsed[0].severity).toBe("major");
    expect(parsed[0].risk.total).toBe(45);
  });

  test("includes metadata fields in JSON", () => {
    const dep = makeOutdatedDep({
      metadata: {
        latest: "2.0.0",
        deprecated: "Use v3",
        peerDependencies: { react: "^18.0.0" },
        repositoryUrl: "https://github.com/org/repo",
        tarballUrl: "https://registry.npmjs.org/pkg.tgz",
        changelogUrl: "https://github.com/org/repo/releases",
      },
      peerConflicts: [
        { peerName: "react", requiredRange: "^19.0.0", workspaceRange: "^18.0.0", conflicting: true },
      ],
    });

    const json = formatJsonOutput([dep]);
    const parsed = JSON.parse(json);

    expect(parsed[0].metadata.deprecated).toBe("Use v3");
    expect(parsed[0].metadata.changelogUrl).toBe("https://github.com/org/repo/releases");
    expect(parsed[0].peerConflicts).toHaveLength(1);
    expect(parsed[0].peerConflicts[0].peerName).toBe("react");
  });

  test("returns empty array for no outdated deps", () => {
    const json = formatJsonOutput([]);
    expect(JSON.parse(json)).toEqual([]);
  });
});

function makeStaticResult(overrides: Partial<StaticAnalysisResult> = {}): StaticAnalysisResult {
  return {
    dep: makeOutdatedDep(),
    typeDiff: undefined,
    usedRemovedExports: [],
    usedChangedExports: [],
    ...overrides,
  };
}

function makeValidationResult(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    dep: makeOutdatedDep(),
    typecheckPassed: true,
    testsPassed: true,
    typecheckOutput: undefined,
    testOutput: undefined,
    ...overrides,
  };
}

describe("formatLevel1Results", () => {
  let spy: ReturnType<typeof spyOn>;
  let logs: string[];

  beforeEach(() => {
    logs = [];
    spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  test("empty array prints up-to-date message", () => {
    formatLevel1Results([]);
    expect(logs.some((l) => l.includes("up to date"))).toBe(true);
  });

  test("prints shared deps section when packages.length > 1", () => {
    const dep = makeOutdatedDep({
      packages: ["apps/web", "apps/mobile"],
    });
    formatLevel1Results([dep]);
    expect(logs.some((l) => l.includes("Shared dependencies"))).toBe(true);
  });

  test("prints deprecation warning for deprecated deps", () => {
    const dep = makeOutdatedDep({
      metadata: {
        latest: "2.0.0",
        deprecated: "Use v3 instead",
        peerDependencies: undefined,
        repositoryUrl: undefined,
        tarballUrl: undefined,
        changelogUrl: undefined,
      },
    });
    formatLevel1Results([dep]);
    expect(logs.some((l) => l.includes("DEPRECATED") && l.includes("Use v3 instead"))).toBe(true);
  });

  test("prints peer conflict warning", () => {
    const dep = makeOutdatedDep({
      peerConflicts: [
        { peerName: "react", requiredRange: "^19.0.0", workspaceRange: "^18.0.0", conflicting: true },
      ],
    });
    formatLevel1Results([dep]);
    expect(logs.some((l) => l.includes("peer conflict") && l.includes("react"))).toBe(true);
  });

  test("prints changelog URL", () => {
    const dep = makeOutdatedDep({
      metadata: {
        latest: "2.0.0",
        deprecated: undefined,
        peerDependencies: undefined,
        repositoryUrl: undefined,
        tarballUrl: undefined,
        changelogUrl: "https://github.com/org/repo/releases",
      },
    });
    formatLevel1Results([dep]);
    expect(logs.some((l) => l.includes("https://github.com/org/repo/releases"))).toBe(true);
  });
});

describe("formatLevel2Results", () => {
  let spy: ReturnType<typeof spyOn>;
  let logs: string[];

  beforeEach(() => {
    logs = [];
    spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  test("empty results prints no static analysis message", () => {
    formatLevel2Results([]);
    expect(logs.some((l) => l.includes("No static analysis"))).toBe(true);
  });

  test("prints removed exports warning in red", () => {
    const result = makeStaticResult({
      typeDiff: { added: [], removed: ["deletedFn"], changed: [] },
      usedRemovedExports: ["deletedFn"],
    });
    formatLevel2Results([result]);
    expect(logs.some((l) => l.includes("-1 removed"))).toBe(true);
    expect(logs.some((l) => l.includes("removed export(s) used in codebase"))).toBe(true);
    expect(logs.some((l) => l.includes("deletedFn"))).toBe(true);
  });

  test("prints no API surface changes when diff is empty", () => {
    const result = makeStaticResult({
      typeDiff: { added: [], removed: [], changed: [] },
    });
    formatLevel2Results([result]);
    expect(logs.some((l) => l.includes("No API surface changes"))).toBe(true);
  });
});

describe("formatLevel3Results", () => {
  let spy: ReturnType<typeof spyOn>;
  let logs: string[];

  beforeEach(() => {
    logs = [];
    spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  test("empty results prints no validation results message", () => {
    formatLevel3Results([]);
    expect(logs.some((l) => l.includes("No validation results"))).toBe(true);
  });

  test("prints pass icons for typecheck and tests", () => {
    const result = makeValidationResult({
      typecheckPassed: true,
      testsPassed: true,
    });
    formatLevel3Results([result]);
    // U+2713 = checkmark
    expect(logs.some((l) => l.includes("\u2713") && l.includes("typecheck"))).toBe(true);
    expect(logs.some((l) => l.includes("\u2713") && l.includes("tests"))).toBe(true);
  });

  test("prints fail icons for typecheck and tests", () => {
    const result = makeValidationResult({
      typecheckPassed: false,
      testsPassed: false,
      typecheckOutput: "error TS2345: Argument of type...",
      testOutput: "FAIL src/app.test.ts",
    });
    formatLevel3Results([result]);
    // U+2717 = cross mark
    expect(logs.some((l) => l.includes("\u2717") && l.includes("typecheck"))).toBe(true);
    expect(logs.some((l) => l.includes("\u2717") && l.includes("tests"))).toBe(true);
  });
});
