import { Document, isMap, isScalar } from "yaml";

import {
  DART_FORMAT_DEFAULTS,
  DEFAULT_IGNORE,
  LINT_CATEGORY_DEFAULTS,
  OXFMT_DEFAULTS,
} from "@/config/defaults";
import type { MidoConfig } from "@/config/schema";
import type { BridgeWithWatch, EcosystemGroup } from "@/commands/utils/shared";
import { MIN_ENV_FILES_FOR_PARITY } from "@/commands/utils/shared";

export function configToObject(config: MidoConfig): Record<string, unknown> {
  const obj: Record<string, unknown> = {
    workspace: config.workspace,
    ecosystems: config.ecosystems,
  };
  if (config.bridges && config.bridges.length > 0) {
    obj["bridges"] = config.bridges;
  }
  if (config.env) {
    obj["env"] = config.env;
  }
  if (config.commits) {
    obj["commits"] = config.commits;
  }
  if (config.lint) {
    obj["lint"] = config.lint;
  }
  if (config.format) {
    obj["format"] = config.format;
  }
  return obj;
}

export function buildConfigObject(
  name: string,
  ecosystems: Record<string, EcosystemGroup>,
  bridges: readonly BridgeWithWatch[],
  envFiles: readonly { readonly path: string }[],
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    workspace: name,
    ecosystems,
  };

  if (bridges.length > 0) {
    config["bridges"] = bridges.map((b) => {
      const entry: Record<string, unknown> = {
        source: b.source,
        artifact: b.artifact,
        consumers: [...b.consumers],
      };
      if (b.watch?.length) {
        entry["watch"] = b.watch;
      }
      return entry;
    });
  }

  if (envFiles.length >= MIN_ENV_FILES_FOR_PARITY) {
    config["env"] = {
      shared: [],
      files: envFiles.map((e) => e.path),
    };
  }

  // Format defaults \u2014 ecosystem-centric
  const formatSection: Record<string, unknown> = {
    ignore: [...DEFAULT_IGNORE],
  };
  if (ecosystems["typescript"]) {
    formatSection["typescript"] = { ...OXFMT_DEFAULTS };
  }
  if (ecosystems["dart"]) {
    formatSection["dart"] = { ...DART_FORMAT_DEFAULTS };
  }
  config["format"] = formatSection;

  // Lint defaults \u2014 ecosystem-centric
  const lintSection: Record<string, unknown> = {
    ignore: [...DEFAULT_IGNORE],
  };
  if (ecosystems["typescript"]) {
    lintSection["typescript"] = {
      categories: { ...LINT_CATEGORY_DEFAULTS },
      rules: {},
    };
  }
  if (ecosystems["dart"]) {
    lintSection["dart"] = { strict: false };
  }
  config["lint"] = lintSection;

  // Commits defaults \u2014 auto-populate scopes from package names
  const scopes: string[] = [];
  for (const group of Object.values(ecosystems)) {
    for (const pkg of group.packages) {
      const scope = pkg.split("/").pop();
      if (scope && !scopes.includes(scope)) {
        scopes.push(scope);
      }
    }
  }
  config["commits"] = {
    types: [
      "feat",
      "fix",
      "docs",
      "style",
      "refactor",
      "perf",
      "test",
      "build",
      "ci",
      "chore",
      "revert",
    ],
    scopes: scopes.sort(),
    header_max_length: 100,
    body_max_line_length: 200,
  };

  // Hooks defaults
  config["hooks"] = {
    "pre-commit": ["mido pre-commit"],
    "commit-msg": ['mido commit-msg "$1"'],
    "post-merge": [
      'mido check --quiet || echo "\u26A0 mido: workspace drift detected \u2014 run mido check --fix"',
    ],
    "post-checkout": [
      'mido check --quiet || echo "\u26A0 mido: workspace drift detected \u2014 run mido check --fix"',
    ],
  };

  return config;
}

const YAML_COMMENTS: ReadonlyMap<string, string> = new Map([
  [
    "workspace",
    " \u2500\u2500\u2500 Workspace \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n Workspace name (used in generated package names and CLI output)",
  ],
  [
    "ecosystems",
    " \u2500\u2500\u2500 Ecosystems \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n Declare which languages your workspace uses and where\n packages live. mido auto-detects these during init.",
  ],
  [
    "bridges",
    " \u2500\u2500\u2500 Bridges \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n Cross-ecosystem dependencies linked by a shared artifact.\n\n source:    package that produces the artifact\n consumers: packages that consume the artifact\n artifact:  the file that connects them\n watch:    files to monitor for changes (used by mido dev)",
  ],
  [
    "env",
    " \u2500\u2500\u2500 Environment \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n Environment variable parity across packages",
  ],
  [
    "format",
    " \u2500\u2500\u2500 Formatting \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n Per-ecosystem formatting. mido picks the right tool:\n   TypeScript \u2192 oxfmt (bundled with mido)\n   Dart       \u2192 dart format\n\n All tool defaults are shown. Change any value to override.",
  ],
  [
    "lint",
    " \u2500\u2500\u2500 Linting \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n Per-ecosystem linting. mido picks the right tool:\n   TypeScript \u2192 oxlint (bundled with mido)\n   Dart       \u2192 dart analyze\n\n mido auto-enables appropriate oxlint plugins based on\n your dependencies (typescript, unicorn, oxc, import by\n default \u2014 react, jsx-a11y, react-perf if React detected).",
  ],
  [
    "commits",
    " \u2500\u2500\u2500 Commits \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n Conventional commit validation, enforced by mido's\n commit-msg git hook. Run `mido install` to set up hooks.",
  ],
  [
    "hooks",
    " \u2500\u2500\u2500 Hooks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n Git hooks installed by `mido install`. Each hook is a\n list of shell commands run sequentially (stops on first\n failure). Set a hook to `false` to disable it.\n Changes are applied on `mido install` or when mido.yml\n is saved during `mido dev`.",
  ],
]);

export function renderYaml(config: Record<string, unknown>): string {
  const doc = new Document(config);
  doc.commentBefore =
    " yaml-language-server: $schema=node_modules/@oddlantern/mido/schema.json\n\n \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n mido \u2014 Cross-ecosystem workspace configuration\n Docs: https://github.com/oddlantern/mido\n \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500";

  if (isMap(doc.contents)) {
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key)) {
        continue;
      }
      const comment = YAML_COMMENTS.get(String(pair.key.value));
      if (comment) {
        pair.key.commentBefore = comment;
      }
    }
  }

  return doc.toString({ lineWidth: 120 });
}
