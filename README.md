# mido

Cross-ecosystem monorepo workspace tool. One config, every language, all bridges generated.

**mido** scans your monorepo, builds a unified dependency graph across TypeScript and Dart, orchestrates code generation between ecosystems, and enforces consistency — versions, formatting, linting, commits, and environment parity.

## The problem

TypeScript monorepos have syncpack. Dart monorepos have melos. Neither sees the other. If your repo contains both — plus generated API clients and design tokens bridging them — version mismatches, stale artifacts, and env drift go undetected until something breaks at runtime.

## What mido replaces

### Tools

| Tool | What it does | mido equivalent |
|------|-------------|-----------------|
| Husky | Git hooks | `mido install` + `hooks:` in mido.yml |
| commitlint | Conventional commit validation | `mido commit-msg` + `commits:` config |
| lint-staged | Run linters on staged files | `mido pre-commit` |
| Prettier | Code formatting | `mido fmt` (oxfmt, bundled) |
| ESLint | Linting | `mido lint` (oxlint, bundled) |
| Biome | Lint + format | `mido lint` + `mido fmt` |
| syncpack | Version consistency across packages | `mido check --fix` |
| npm outdated / dart pub outdated | Dependency freshness (per ecosystem) | `mido outdated` (cross-ecosystem) |

### Scripts and workflows

| Manual workflow | What it does | mido equivalent |
|----------------|-------------|-----------------|
| Per-package `generate` scripts | API codegen, design tokens | `mido generate` (all bridges, cached) |
| `bun test` / `dart test` per package | Running tests | `mido test` (cross-ecosystem, parallel) |
| Bespoke CI pipeline steps | Build + lint + test + check | `mido ci` (single command) |
| Figuring out what changed | Deciding what to rebuild | `mido affected --base origin/main` |
| Checking dependency versions manually | Finding outdated deps | `mido outdated` (shared deps highlighted) |

### What mido does NOT replace

- **Package managers** — bun, npm, yarn, dart, flutter (mido calls them, doesn't replace them)
- **Compilers** — TypeScript, Dart (mido orchestrates, doesn't compile)
- **App builds** — `flutter build`, Docker, deploy scripts (mido builds library packages, not apps)
- **Infrastructure** — CI/CD config, Docker, k8s (mido provides `mido ci` but doesn't own your pipeline)

## Install

```bash
bun add -D @oddlantern/mido   # or npm/pnpm/yarn
```

## Getting started

```bash
mido init       # Scan repo, generate mido.yml, install hooks, wire prepare script
mido dev        # Start watching — you're ready to develop
```

That's it. `mido init` handles everything:

- Detects ecosystems and packages
- Discovers bridges between them
- Generates `mido.yml` with sensible defaults
- Installs git hooks (pre-commit, commit-msg, post-merge, post-checkout)
- Adds `"prepare": "mido generate"` to your root `package.json`
- Adds `generated/` entries to `.gitignore` for bridge sources

After init, every `bun install` on a fresh clone automatically runs `mido generate` to produce all generated code. No manual steps.

## Config

`mido init` generates a `mido.yml`. Example:

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
  pre-commit: [mido pre-commit]
  commit-msg: ['mido commit-msg "$1"']
```

## Commands

### Setup

| Command | Description |
|---------|-------------|
| `mido init` | Scan repo, generate mido.yml, install hooks |
| `mido install` | Write git hooks to `.git/hooks/` |
| `mido add` | Scaffold a new package in the workspace |

### Development

| Command | Description |
|---------|-------------|
| `mido dev [--verbose]` | Watch bridges and regenerate on changes |
| `mido generate [--force]` | Run all bridge pipelines (uses cache, `--force` to skip) |
| `mido lint [--fix]` | Run linters across all packages |
| `mido fmt [--check]` | Format all packages |
| `mido test` | Run tests across all packages |
| `mido build [--all]` | Build library packages (`--all` includes apps) |

### Workspace health

| Command | Description |
|---------|-------------|
| `mido check [--fix] [--quiet]` | Version consistency, bridge validation, env parity, staleness |
| `mido doctor` | Diagnostic: config, hooks, tools, generated output |
| `mido outdated [--json]` | Check for newer dependency versions across ecosystems |
| `mido why <dep>` | Show which packages use a dependency |

### CI / automation

| Command | Description |
|---------|-------------|
| `mido ci` | Full pipeline: generate, build, lint, test, check |
| `mido affected [--base ref] [--json]` | Packages affected by changes (follows dependency + bridge edges) |
| `mido graph [--dot] [--ascii]` | Interactive D3.js dependency graph |

### Git hooks

| Command | Description |
|---------|-------------|
| `mido pre-commit` | Format check + lint + workspace check |
| `mido commit-msg <file>` | Validate conventional commit message |

### Other

| Command | Description |
|---------|-------------|
| `mido help` | Show all commands and flags |
| `mido --version` | Show version |

### Common flags

- `--quiet` — only show failures (lint, fmt, test, build, check)
- `--package <path>` — target a specific package (lint, fmt, test, build)
- `--ecosystem <name>` — target a specific ecosystem (lint, fmt, test)
- `--json` — machine-readable output (affected, outdated, why)

## Bridges

Bridges declare cross-ecosystem dependencies linked by a shared artifact:

```yaml
bridges:
  - source: apps/server           # produces the artifact
    consumers: [apps/web, apps/flutter]  # depend on generated output
    artifact: openapi.json         # the bridge file
    watch: [apps/server/src/routes/**]   # trigger regeneration
```

### How generation works

1. Source changes trigger the bridge pipeline
2. A **domain plugin** (openapi, design) validates/exports the artifact
3. **Ecosystem plugins** (typescript, dart) generate code for each consumer
4. Generated output lands in `<source>/generated/<ecosystem>/`
5. Consumers import from the generated package via workspace dependencies

```
apps/server/generated/typescript/      # openapi-typescript output
apps/server/generated/dart/            # swagger_parser output
packages/design/generated/typescript/  # CSS + TS constants
packages/design/generated/dart/        # Flutter theme
```

The `generated/` directories are gitignored — `mido generate` runs automatically via the `prepare` script on `bun install`.

### Pipeline caching

`mido generate` hashes bridge inputs (artifact + watched files) and skips unchanged bridges. Use `--force` to regenerate everything.

### Domain plugins

- **openapi** — detects OpenAPI/Swagger specs, boots server frameworks (Elysia, Hono, Express, Fastify, Koa, NestJS) to export specs, delegates to ecosystem plugins for client generation
- **design** — validates `tokens.json` schema, delegates to ecosystem plugins for theme/constant generation

### Ecosystem plugins

- **typescript** — oxlint, oxfmt (bundled), openapi-typescript, CSS/TS design token codegen
- **dart** — dart analyze, dart format, swagger_parser, Flutter theme codegen

## CI integration

Single command replaces bespoke CI configs:

```yaml
# GitHub Actions example
- run: bun install      # triggers mido generate via prepare script
- run: bunx mido ci     # generate → build → lint → test → check
```

For monorepos with conditional builds:

```yaml
- run: bunx mido affected --base origin/main --json > affected.json
# Use affected.json to conditionally trigger app-specific builds
```

## Checks

`mido check` validates workspace consistency:

- **versions** — flags dependencies with different version ranges across packages
- **bridges** — validates cross-ecosystem edges and artifact presence
- **env** — checks shared environment keys exist in all declared env files
- **staleness** — warns when generated output is missing

## Lint and format

mido picks the right tool per ecosystem. All config lives in `mido.yml`:

- **TypeScript** — oxlint + oxfmt (bundled with mido, zero config). Falls back to eslint/prettier if installed.
- **Dart** — `dart analyze` + `dart format` from PATH.

Oxlint plugins are auto-enabled based on your dependencies (react, vitest, jest, nextjs, etc.).

## Git hooks

`mido install` writes hooks configured in the `hooks` section of `mido.yml`:

- **pre-commit** — `mido pre-commit` (format check + lint + workspace check)
- **commit-msg** — conventional commit validation
- **post-merge** / **post-checkout** — workspace drift detection

Set a hook to `false` to disable it.

## Adding ecosystem support

mido is built around a parser plugin boundary. Adding a new ecosystem = one file implementing `ManifestParser`:

```typescript
interface ManifestParser {
  manifestName: string;
  parse(manifestPath: string): Promise<ParsedManifest>;
}
```

Currently supported: `package.json` (npm/yarn/pnpm/bun) and `pubspec.yaml` (Dart/Flutter).

## License

MIT
