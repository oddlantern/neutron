# neutron

Cross-ecosystem monorepo workspace tool. One config, every language, all bridges generated.

**neutron** scans your monorepo, builds a unified dependency graph across TypeScript and Dart, orchestrates code generation between ecosystems, and enforces consistency — versions, formatting, linting, commits, and environment parity.

## The problem

TypeScript monorepos have syncpack. Dart monorepos have melos. Neither sees the other. If your repo contains both — plus generated API clients and design tokens bridging them — version mismatches, stale artifacts, and env drift go undetected until something breaks at runtime.

## What neutron replaces

### Tools

| Tool | What it does | neutron equivalent |
|------|-------------|-----------------|
| Husky | Git hooks | `neutron install` + `hooks:` in neutron.yml |
| commitlint | Conventional commit validation | `neutron commit-msg` + `commits:` config |
| lint-staged | Run linters on staged files | `neutron pre-commit` |
| Prettier | Code formatting | `neutron fmt` (oxfmt, bundled) |
| ESLint | Linting | `neutron lint` (oxlint, bundled) |
| Biome | Lint + format | `neutron lint` + `neutron fmt` |
| syncpack | Version consistency across packages | `neutron check --fix` |
| npm outdated / dart pub outdated | Dependency freshness (per ecosystem) | `neutron outdated` (cross-ecosystem) |

### Scripts and workflows

| Manual workflow | What it does | neutron equivalent |
|----------------|-------------|-----------------|
| Per-package `generate` scripts | API codegen, design tokens | `neutron generate` (all bridges, cached) |
| `bun test` / `dart test` per package | Running tests | `neutron test` (cross-ecosystem, parallel) |
| Bespoke CI pipeline steps | Build + lint + test + check | `neutron ci` (single command) |
| Figuring out what changed | Deciding what to rebuild | `neutron affected --base origin/main` |
| Checking dependency versions manually | Finding outdated deps | `neutron outdated` (shared deps highlighted) |

### What neutron does NOT replace

- **Package managers** — bun, npm, yarn, dart, flutter (neutron calls them, doesn't replace them)
- **Compilers** — TypeScript, Dart (neutron orchestrates, doesn't compile)
- **App builds** — `flutter build`, Docker, deploy scripts (neutron builds library packages, not apps)
- **Infrastructure** — CI/CD config, Docker, k8s (neutron provides `neutron ci` but doesn't own your pipeline)

## Install

```bash
bun add -D @oddlantern/neutron   # or npm/pnpm/yarn
```

## Getting started

```bash
neutron init       # Scan repo, generate neutron.yml, install hooks, wire prepare script
neutron dev        # Start watching — you're ready to develop
```

That's it. `neutron init` handles everything:

- Detects ecosystems and packages
- Discovers bridges between them
- Generates `neutron.yml` with sensible defaults
- Installs git hooks (pre-commit, commit-msg, post-merge, post-checkout)
- Adds `"prepare": "neutron generate"` to your root `package.json`
- Adds `generated/` entries to `.gitignore` for bridge sources

After init, every `bun install` on a fresh clone automatically runs `neutron generate` to produce all generated code. No manual steps.

## Config

`neutron init` generates a `neutron.yml`. Example:

```yaml
workspace: my-project

ecosystems:
  typescript:
    manifest: package.json
    packages:
      - apps/server
      - apps/web
      - packages/shared

  dart:
    manifest: pubspec.yaml
    packages:
      - apps/flutter

bridges:
  - source: apps/server
    consumers: [apps/web, apps/flutter]
    artifact: openapi.json
    watch: [apps/server/src/routes/**]

  - source: packages/design
    consumers: [apps/flutter, apps/web]
    artifact: tokens.json

format:
  ignore: [node_modules, build, dist, .dart_tool]
  typescript:
    indent_style: space
    indent_width: 2
  dart:
    line_length: 80

lint:
  ignore: [node_modules, build, dist, .dart_tool]
  typescript:
    categories:
      correctness: error
      suspicious: warn
      perf: warn
  dart:
    strict: false

commits:
  types: [feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert]
  scopes: [server, web, flutter, design, shared]
  header_max_length: 100

hooks:
  pre-commit: [neutron pre-commit]
  commit-msg: ['neutron commit-msg "$1"']
```

## Commands

### Setup

| Command | Description |
|---------|-------------|
| `neutron init` | Scan repo, generate neutron.yml, install hooks |
| `neutron install [--dry-run]` | Write git hooks to `.git/hooks/` |
| `neutron add` | Scaffold a new package in the workspace |

### Development

| Command | Description |
|---------|-------------|
| `neutron dev [--verbose]` | Watch bridges and regenerate on changes |
| `neutron generate [--force] [--quiet] [--verbose] [--dry-run]` | Run all bridge pipelines (uses cache, `--force` to skip) |
| `neutron lint [--fix]` | Run linters across all packages |
| `neutron fmt [--check]` | Format all packages |
| `neutron test` | Run tests across all packages |
| `neutron build [--all]` | Build library packages (`--all` includes apps) |

### Workspace health

| Command | Description |
|---------|-------------|
| `neutron check [--fix] [--quiet] [--hook]` | Version consistency, bridge validation, env parity, staleness |
| `neutron doctor` | Diagnostic: config, hooks, tools, generated output |
| `neutron outdated [--json] [--deep] [--verify] [--ci]` | Check for newer dependency versions across ecosystems |
| `neutron upgrade [--all] [--verify] [--dry-run]` | Interactive dependency upgrade with lock and manifest sync |
| `neutron why <dep> [--json]` | Show which packages use a dependency |
| `neutron rename <name> [--include-platform-ids] [--dry-run]` | Rename workspace across all manifests |

### CI / automation

| Command | Description |
|---------|-------------|
| `neutron ci [--verbose]` | Full pipeline: generate, build, lint, test, check |
| `neutron affected [--base ref] [--json]` | Packages affected by changes (follows dependency + bridge edges) |
| `neutron graph [--dot] [--ascii] [--no-open]` | Interactive D3.js dependency graph |

### Git hooks

| Command | Description |
|---------|-------------|
| `neutron pre-commit` | Format check + lint + workspace check |
| `neutron commit-msg <file>` | Validate conventional commit message |

### Common flags

- `--quiet` — only show failures (lint, fmt, test, build, check)
- `--package <path>` — target a specific package (lint, fmt, test, build)
- `--ecosystem <name>` — target a specific ecosystem (lint, fmt, test)
- `--json` — machine-readable output (affected, outdated, why)
- `--dry-run` — preview changes without writing (generate, install, rename, upgrade)

## Bridges

Bridges declare cross-ecosystem dependencies linked by a shared artifact:

```yaml
bridges:
  - source: apps/server           # produces the artifact
    consumers: [apps/web, apps/flutter]  # depend on generated output
    artifact: openapi.json         # the bridge file
    watch: [apps/server/src/routes/**]   # trigger regeneration
    entryFile: src/index.ts        # server entry point (optional, for framework detection)
    specPath: /custom/openapi.json # custom spec endpoint (optional)
    exclude: [internal/]           # path prefixes to exclude from output (optional)
```

### How generation works

1. Source changes trigger the bridge pipeline
2. A **domain plugin** (openapi, design, assets) validates/exports the artifact
3. **Ecosystem plugins** (typescript, dart) generate code for each consumer
4. Generated output lands in `<source>/generated/<ecosystem>/`
5. Consumers import from the generated package via workspace dependencies

```
apps/server/generated/typescript/      # openapi-typescript output
apps/server/generated/dart/            # swagger_parser output
packages/design/generated/typescript/  # CSS + TS constants
packages/design/generated/dart/        # Flutter theme
packages/assets/generated/typescript/  # typed asset paths + inlined SVGs
packages/assets/generated/dart/        # typed asset wrappers
```

The `generated/` directories are gitignored — `neutron generate` runs automatically via the `prepare` script on `bun install`.

### Pipeline caching

`neutron generate` hashes bridge inputs (artifact + watched files) and skips unchanged bridges. Use `--force` to regenerate everything.

### Domain plugins

- **openapi** — detects OpenAPI/Swagger specs, boots server frameworks to export specs, delegates to ecosystem plugins for client generation
- **design** — validates `tokens.json` schema (colors, spacing, radius, elevation, typography, extensions), delegates to ecosystem plugins for theme/constant generation
- **assets** — scans asset directories (svg, icons, images), generates typed asset paths with SVG inlining support

#### OpenAPI framework adapters

neutron auto-detects your server framework from dependencies, spawns it to export the spec, and shuts it down. Supported frameworks:

| Framework | Spec endpoint |
|-----------|--------------|
| Elysia | `/openapi/json` |
| Hono | `/openapi` |
| Express | `/api-docs` |
| Fastify | `/documentation/json` |
| Koa | `/swagger.json` |
| NestJS | `/api-docs-json` |

Override with `entryFile` and `specPath` in the bridge config for edge cases.

#### Design tokens

`tokens.json` supports these token categories: color, spacing, radius, elevation, typography, and extensions.

Typography supports font providers:

| Provider | Output |
|----------|--------|
| `"asset"` (default) | `TextStyle(fontFamily: ...)` |
| `"google_fonts"` | `GoogleFonts.method(...)` |
| `"none"` | No font family |

Extensions support typed fields: themed colors (`{ light, dark }` hex), static colors (`#hex`), numbers, themed numbers (`{ light, dark }` numbers), and strings.

### Ecosystem plugins

- **typescript** — oxlint, oxfmt (bundled), openapi-typescript, CSS/TS design token codegen, typed asset paths
- **dart** — dart analyze, dart format, swagger_parser, Flutter theme codegen (M3 ColorScheme, ThemeExtensions), typed asset wrappers

Oxlint plugins are auto-enabled based on your dependencies: always `typescript`, `unicorn`, `oxc`, `import`; conditionally `react`, `jsx-a11y`, `react-perf` (if React/Preact), `jest`, `vitest`, `nextjs`.

## Dependency management

### Outdated analysis

`neutron outdated` provides three-level progressive dependency analysis:

**Level 1 — Registry scan** (always runs): checks npm/pub registries for newer versions, detects deprecations, peer conflicts, and computes a risk score (0–100) per dependency.

**Level 2 — Static API diff** (`--deep`): downloads tarballs, extracts `.d.ts` / `.dart` files, and diffs the export surface to detect breaking changes without installing anything.

**Level 3 — Live validation** (`--verify`): installs updates in a temp directory, runs typecheck and tests per ecosystem to confirm compatibility.

In interactive mode, neutron prompts to escalate levels after each pass. In CI, use `--ci` for Level 1 only with exit code 1 if outdated.

### Upgrade

`neutron upgrade` provides interactive dependency upgrades with automatic lock file and manifest sync. Use `--all` to upgrade everything, `--verify` to run Level 3 validation before applying, and `--dry-run` to preview changes.

### Version policy

`neutron check --fix` generates a `neutron.lock` file that records resolved version ranges, ensuring consistent versions across all packages in the workspace.

## Workspace rename

`neutron rename <name>` cascades the workspace name across all manifests (package.json, pubspec.yaml). Use `--include-platform-ids` to also update iOS bundle IDs, Android application IDs, and Firebase config. Use `--dry-run` to preview changes.

## CI integration

Single command replaces bespoke CI configs:

```yaml
# GitHub Actions example
- run: bun install      # triggers neutron generate via prepare script
- run: bunx neutron ci     # generate → build → lint → test → check
```

For monorepos with conditional builds:

```yaml
- run: bunx neutron affected --base origin/main --json > affected.json
# Use affected.json to conditionally trigger app-specific builds
```

## Checks

`neutron check` validates workspace consistency:

- **versions** — flags dependencies with different version ranges across packages
- **bridges** — validates cross-ecosystem edges and artifact presence
- **env** — checks shared environment keys exist in all declared env files
- **staleness** — warns when generated output is missing

All checks support `--fix` for automatic remediation and `--quiet` for failure-only output.

## Lint and format

neutron picks the right tool per ecosystem. All config lives in `neutron.yml`:

- **TypeScript** — oxlint + oxfmt (bundled with neutron, zero config). Falls back to eslint/prettier if installed.
- **Dart** — `dart analyze` + `dart format` from PATH.

Oxlint plugins are auto-enabled based on your dependencies (react, vitest, jest, nextjs, etc.).

Lint and format run packages within the same ecosystem in parallel. Build runs sequentially (build order may matter).

## Git hooks

`neutron install` writes hooks configured in the `hooks` section of `neutron.yml`:

- **pre-commit** — `neutron pre-commit` (format check + lint + workspace check)
- **commit-msg** — conventional commit validation
- **post-merge** / **post-checkout** — workspace drift detection

Set a hook to `false` to disable it. neutron detects conflicts with existing hooks and warns before overwriting.

## Adding ecosystem support

neutron is built around a parser plugin boundary. Adding a new ecosystem = one file implementing `ManifestParser`:

```typescript
interface ManifestParser {
  manifestName: string;
  parse(manifestPath: string): Promise<ParsedManifest>;
}
```

Currently supported: `package.json` (npm/yarn/pnpm/bun) and `pubspec.yaml` (Dart/Flutter).

## License

MIT
