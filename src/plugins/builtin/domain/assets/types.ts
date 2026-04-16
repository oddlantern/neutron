/** A single discovered asset file */
export interface AssetEntry {
  /** Filename without extension (e.g., "achievement_first_walk") */
  readonly name: string;
  /** File extension without dot (e.g., "svg", "png") */
  readonly ext: string;
  /** Path relative to the assets root (e.g., "svg/achievement_first_walk.svg") */
  readonly relativePath: string;
  /** Category inferred from filename prefix (e.g., "achievement", "genre", "ui") */
  readonly category: string;
  /** The key within the category (e.g., "first_walk" from "achievement_first_walk") */
  readonly key: string;
}

/** A group of assets sharing the same category */
export interface AssetCategory {
  readonly name: string;
  readonly entries: readonly AssetEntry[];
}

/** Theme variant detected from directory structure (e.g., light/dark map pins) */
export interface ThemeVariant {
  readonly category: string;
  readonly variants: ReadonlyMap<string, readonly AssetEntry[]>;
}

/** Full result of scanning an assets package */
export interface AssetManifest {
  /** Workspace name from neutron.yml (drives generated class prefixes) */
  readonly workspaceName: string;
  /** All discovered asset categories */
  readonly categories: readonly AssetCategory[];
  /** Theme-variant groups (e.g., map_pins with light/dark subdirs) */
  readonly themeVariants: readonly ThemeVariant[];
  /** All entries flat (for pubspec asset declarations) */
  readonly allEntries: readonly AssetEntry[];
  /** Top-level directories that contain assets (for pubspec asset directory declarations) */
  readonly assetDirectories: readonly string[];
}
