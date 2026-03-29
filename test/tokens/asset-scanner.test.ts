import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { scanAssets } from "@/plugins/builtin/domain/assets/scanner";

describe("asset scanner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mido-assets-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty manifest for empty directory", () => {
    const manifest = scanAssets(tmpDir, "testapp");
    expect(manifest.allEntries).toHaveLength(0);
    expect(manifest.categories).toHaveLength(0);
    expect(manifest.themeVariants).toHaveLength(0);
  });

  test("discovers SVG files and infers categories from prefixes", () => {
    const svgDir = join(tmpDir, "svg");
    mkdirSync(svgDir);
    writeFileSync(join(svgDir, "achievement_first_walk.svg"), "<svg/>", "utf-8");
    writeFileSync(join(svgDir, "achievement_explorer.svg"), "<svg/>", "utf-8");
    writeFileSync(join(svgDir, "ui_search.svg"), "<svg/>", "utf-8");

    const manifest = scanAssets(tmpDir, "testapp");
    expect(manifest.allEntries).toHaveLength(3);

    const categoryNames = manifest.categories.map((c) => c.name).sort();
    expect(categoryNames).toEqual(["achievement", "ui"]);

    const achievementCat = manifest.categories.find((c) => c.name === "achievement");
    expect(achievementCat?.entries).toHaveLength(2);

    const uiCat = manifest.categories.find((c) => c.name === "ui");
    expect(uiCat?.entries).toHaveLength(1);
    expect(uiCat?.entries[0]?.key).toBe("search");
  });

  test("discovers PNG files", () => {
    const imgDir = join(tmpDir, "images");
    mkdirSync(imgDir);
    writeFileSync(join(imgDir, "bg_dark.png"), Buffer.from([0x89, 0x50]), "binary");

    const manifest = scanAssets(tmpDir, "testapp");
    expect(manifest.allEntries).toHaveLength(1);
    expect(manifest.allEntries[0]?.ext).toBe("png");
  });

  test("ignores non-asset files", () => {
    mkdirSync(join(tmpDir, "svg"));
    writeFileSync(join(tmpDir, "svg", "icon.svg"), "<svg/>", "utf-8");
    writeFileSync(join(tmpDir, "svg", "readme.txt"), "hello", "utf-8");
    writeFileSync(join(tmpDir, "svg", "data.json"), "{}", "utf-8");

    const manifest = scanAssets(tmpDir, "testapp");
    // Only .svg should be picked up, not .txt or .json
    expect(manifest.allEntries).toHaveLength(1);
    expect(manifest.allEntries[0]?.ext).toBe("svg");
  });

  test("detects theme variants from light/dark subdirs", () => {
    const lightDir = join(tmpDir, "map_pins", "light");
    const darkDir = join(tmpDir, "map_pins", "dark");
    mkdirSync(lightDir, { recursive: true });
    mkdirSync(darkDir, { recursive: true });

    writeFileSync(join(lightDir, "map_pins_waypoint.svg"), "<svg/>", "utf-8");
    writeFileSync(join(darkDir, "map_pins_waypoint.svg"), "<svg/>", "utf-8");
    writeFileSync(join(lightDir, "map_pins_poi.svg"), "<svg/>", "utf-8");
    writeFileSync(join(darkDir, "map_pins_poi.svg"), "<svg/>", "utf-8");

    const manifest = scanAssets(tmpDir, "testapp");
    expect(manifest.themeVariants).toHaveLength(1);
    expect(manifest.themeVariants[0]?.variants.size).toBe(2);
    expect(manifest.themeVariants[0]?.variants.has("light")).toBe(true);
    expect(manifest.themeVariants[0]?.variants.has("dark")).toBe(true);
  });

  test("collects asset directories for pubspec declarations", () => {
    const svgDir = join(tmpDir, "svg");
    const imgDir = join(tmpDir, "images", "auth");
    mkdirSync(svgDir);
    mkdirSync(imgDir, { recursive: true });

    writeFileSync(join(svgDir, "ui_search.svg"), "<svg/>", "utf-8");
    writeFileSync(join(imgDir, "bg.png"), Buffer.from([0x89]), "binary");

    const manifest = scanAssets(tmpDir, "testapp");
    expect(manifest.assetDirectories.length).toBeGreaterThanOrEqual(2);
    expect(manifest.assetDirectories).toContain("svg/");
    expect(manifest.assetDirectories).toContain("images/auth/");
  });

  test("uses parent dir as category when no prefix underscore", () => {
    const iconsDir = join(tmpDir, "icons");
    mkdirSync(iconsDir);
    writeFileSync(join(iconsDir, "wren-head.svg"), "<svg/>", "utf-8");

    const manifest = scanAssets(tmpDir, "testapp");
    expect(manifest.allEntries).toHaveLength(1);
    // "wren-head" has a hyphen but no underscore prefix, so parent dir "icons" is category
    expect(manifest.allEntries[0]?.category).toBe("icons");
    expect(manifest.allEntries[0]?.key).toBe("wren-head");
  });

  test("stores workspace name in manifest", () => {
    const manifest = scanAssets(tmpDir, "nextsaga");
    expect(manifest.workspaceName).toBe("nextsaga");
  });

  test("handles deeply nested directories", () => {
    const deep = join(tmpDir, "a", "b", "c");
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, "ui_icon.svg"), "<svg/>", "utf-8");

    const manifest = scanAssets(tmpDir, "testapp");
    expect(manifest.allEntries).toHaveLength(1);
    expect(manifest.allEntries[0]?.relativePath).toBe("a/b/c/ui_icon.svg");
  });
});
