# mido

Cross-ecosystem monorepo workspace tool. One config, every language, all bridges generated.

**mido** scans your monorepo, builds a unified dependency graph across TypeScript and Dart, orchestrates code generation between ecosystems, and enforces consistency — versions, formatting, linting, commits, and environment parity.

## The problem

TypeScript monorepos have syncpack. Dart monorepos have melos. Neither sees the other. If your repo contains both — plus generated API clients and design tokens bridging them — version mismatches, stale artifacts, and env drift go undetected until something breaks at runtime.

## Install

```bash
bun add -D @oddlantern/mido   # or npm/pnpm/yarn
```

## Quick start

```bash
mido init         # Scan repo, generate mido.yml interactively
mido install      # Install git hooks
mido generate     # Run all bridge pipelines
mido dev          # Watch bridges and regenerate on changes
```

## Config

`mido init` scans your repo and proposes a `mido.yml`. Example:

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

| Command | Description |
|---------|-------------|
| `mido init` | Scan repo, detect ecosystems/bridges, generate mido.yml |
| `mido install` | Write git hooks to `.git/hooks/` |
| `mido generate` | Run all bridge pipelines (fresh clone / CI) |
| `mido dev [--verbose]` | Watch bridges and regenerate on changes |
| `mido check` | Run all workspace consistency checks |
| `mido check --fix` | Interactively resolve version mismatches |
| `mido check --quiet` | Silent on success (for hooks) |
| `mido lint [--fix]` | Run linters across all packages |
| `mido fmt [--check]` | Format all packages |
| `mido build` | Build all packages |
| `mido pre-commit` | Format check + lint + workspace check |
| `mido commit-msg <file>` | Validate conventional commit message |

### Flags (lint, fmt, build)

- `--quiet` — only show failures
- `--package <path>` — target a specific package
- `--ecosystem <name>` — target a specific ecosystem (lint, fmt only)

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
apps/server/generated/typescript/   # openapi-typescript output
apps/server/generated/dart/         # swagger_parser output
packages/design/generated/typescript/  # CSS + TS constants
packages/design/generated/dart/        # Flutter theme
```

The `generated/` directories are gitignored. Run `mido generate` after clone or in CI.

### Domain plugins

- **openapi** — detects OpenAPI/Swagger specs, boots server frameworks (Elysia, Hono, Express, Fastify, Koa, NestJS) to export specs, delegates to ecosystem plugins for client generation
- **design** — validates `tokens.json` schema, delegates to ecosystem plugins for theme/constant generation

### Ecosystem plugins

- **typescript** — oxlint, oxfmt (bundled), openapi-typescript, CSS/TS design token codegen
- **dart** — dart analyze, dart format, swagger_parser, Flutter theme codegen

## Checks

`mido check` validates workspace consistency:

- **versions** — flags dependencies with different version ranges across packages
- **bridges** — validates cross-ecosystem edges and artifact presence
- **env** — checks shared environment keys exist in all declared env files

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
