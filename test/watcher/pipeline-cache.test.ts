import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearCache,
  computeInputHash,
  isCacheHit,
  updateCache,
} from "@/bridges/cache";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(import.meta.dir, "..", ".tmp-cache-" + Date.now());
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
});

describe("computeInputHash", () => {
  test("returns consistent hash for same input", async () => {
    writeFileSync(join(tmpDir, "tokens.json"), '{"color": "red"}', "utf-8");
    const hash1 = await computeInputHash(tmpDir, "tokens.json", []);
    const hash2 = await computeInputHash(tmpDir, "tokens.json", []);
    expect(hash1).toBe(hash2);
  });

  test("returns different hash when artifact changes", async () => {
    writeFileSync(join(tmpDir, "tokens.json"), '{"color": "red"}', "utf-8");
    const hash1 = await computeInputHash(tmpDir, "tokens.json", []);

    writeFileSync(join(tmpDir, "tokens.json"), '{"color": "blue"}', "utf-8");
    const hash2 = await computeInputHash(tmpDir, "tokens.json", []);

    expect(hash1).not.toBe(hash2);
  });

  test("includes watch pattern files in hash", async () => {
    writeFileSync(join(tmpDir, "tokens.json"), '{"color": "red"}', "utf-8");
    mkdirSync(join(tmpDir, "src"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "index.ts"), "export const x = 1;", "utf-8");

    const hash1 = await computeInputHash(tmpDir, "tokens.json", ["src/**"]);

    writeFileSync(join(tmpDir, "src", "index.ts"), "export const x = 2;", "utf-8");
    const hash2 = await computeInputHash(tmpDir, "tokens.json", ["src/**"]);

    expect(hash1).not.toBe(hash2);
  });
});

describe("isCacheHit / updateCache", () => {
  test("returns false on empty cache", async () => {
    writeFileSync(join(tmpDir, "tokens.json"), "data", "utf-8");
    const hit = await isCacheHit(tmpDir, "test-bridge", "tokens.json", []);
    expect(hit).toBe(false);
  });

  test("returns true after updateCache with same input", async () => {
    writeFileSync(join(tmpDir, "tokens.json"), "data", "utf-8");
    await updateCache(tmpDir, "test-bridge", "tokens.json", []);

    const hit = await isCacheHit(tmpDir, "test-bridge", "tokens.json", []);
    expect(hit).toBe(true);
  });

  test("returns false after input changes", async () => {
    writeFileSync(join(tmpDir, "tokens.json"), "data-v1", "utf-8");
    await updateCache(tmpDir, "test-bridge", "tokens.json", []);

    writeFileSync(join(tmpDir, "tokens.json"), "data-v2", "utf-8");
    const hit = await isCacheHit(tmpDir, "test-bridge", "tokens.json", []);
    expect(hit).toBe(false);
  });

  test("different bridge keys are independent", async () => {
    writeFileSync(join(tmpDir, "tokens.json"), "data", "utf-8");
    await updateCache(tmpDir, "bridge-a", "tokens.json", []);

    const hitA = await isCacheHit(tmpDir, "bridge-a", "tokens.json", []);
    const hitB = await isCacheHit(tmpDir, "bridge-b", "tokens.json", []);
    expect(hitA).toBe(true);
    expect(hitB).toBe(false);
  });
});

describe("clearCache", () => {
  test("clears all entries", async () => {
    writeFileSync(join(tmpDir, "tokens.json"), "data", "utf-8");
    await updateCache(tmpDir, "bridge-a", "tokens.json", []);

    clearCache(tmpDir);

    const hit = await isCacheHit(tmpDir, "bridge-a", "tokens.json", []);
    expect(hit).toBe(false);
  });
});
