# CLAUDE.md — mido

Cross-ecosystem monorepo workspace tool. Package: `@oddlantern/mido`. Binary: `mido`.

## Architecture

```
scripts/
  generate-schema.ts     # JSON schema generator → schema.json (derived from Zod, build-time)
src/
  bin.ts                 # CLI entry point, command router
  banner.ts              # ASCII banner renderer
  guards.ts              # isRecord type guard for safe narrowing
  hooks.ts               # Git hook resolution, conflict detection, file writing
  lock.ts                # mido.lock read/write/merge
  manifest-writer.ts     # Write version ranges back to manifests
  output.ts              # ANSI terminal formatting constants
  pm-detect.ts           # Package manager detection from lockfiles
  prompt.ts              # Interactive prompts (@clack/prompts wrappers)
  version.ts             # Package version + MIDO_ROOT path resolution
  config/
    defaults.ts          # Default config values (lint categories, format options, ignore patterns)
    schema.ts            # Zod schema for mido.yml (ecosystem-centric format/lint/commits)
    loader.ts            # Walk-up config finder + validator + auto-migration pipeline
  files/
    resolver.ts          # Central file resolution with ignore pattern support
  graph/
    types.ts             # WorkspacePackage, Bridge, WorkspaceGraph
    workspace.ts         # Build cross-ecosystem DAG from config + parsers
  parsers/
    types.ts             # ManifestParser interface (plugin boundary)
    package-json.ts      # npm/yarn/pnpm/bun manifest parser
    pubspec.ts           # Dart/Flutter manifest parser
  plugins/
    types.ts             # Plugin interfaces, pipeline types, ExecutionContext, STANDARD_ACTIONS
    registry.ts          # Plugin registry, context factory, watch path suggestions
    loader.ts            # Load builtin (and future external) plugins
    builtin/
      shared/
        exec.ts          # Shared runCommand, readPackageJson, hasDep helpers
      ecosystem/
        typescript/
          plugin.ts      # Ecosystem plugin: TS lint/fmt/build/test/typecheck
          openapi-codegen.ts  # OpenAPI TS + design token CSS/TS code generators
          token-codegen.ts # CSS custom properties + TS constants generators
          asset-codegen.ts # Asset path exports + inlined SVG generation
          lint-config.ts # Oxlint plugin detection + oxlintrc/oxfmtrc generation
        dart/
          plugin.ts      # Ecosystem plugin: Dart lint/fmt/build/test + design-tokens
          token-codegen.ts # Flutter code generators (ColorScheme, extensions, constants)
          token-theme.ts # Flutter ThemeData + theme extensions generation
          openapi-codegen.ts # Dart OpenAPI client generation (swagger_parser scaffold)
          asset-codegen.ts # Flutter typed asset wrappers + pubspec declarations
      domain/
        design/
          plugin.ts      # Domain plugin: design token validation + downstream delegation
          token-schema.ts # Zod schema for tokens.json + validation
          types.ts       # ValidatedTokens, ResolvedExtension, type detection
        openapi/
          plugin.ts      # Domain plugin: OpenAPI spec export, prepare, downstream delegation
          exporter.ts    # Export engine: boot server, fetch spec, write to disk
          server-boot.ts # Server spawning, port detection, readiness polling, graceful shutdown
          adapters/
            types.ts     # FrameworkAdapter interface
            index.ts     # Adapter registry + detectAdapter()
            elysia.ts    # Elysia adapter (spec at /openapi/json)
            hono.ts      # Hono adapter (spec at /openapi)
            express.ts   # Express adapter (spec at /api-docs)
            fastify.ts   # Fastify adapter (spec at /documentation/json)
            koa.ts       # Koa adapter (spec at /swagger.json)
            nestjs.ts    # NestJS adapter (spec at /api-docs-json)
        assets/
          plugin.ts      # Domain plugin: asset directory scanning + downstream delegation
          scanner.ts     # Filesystem scanner, category inference, theme variant detection
          types.ts       # AssetManifest, AssetEntry, AssetCategory, ThemeVariant
  checks/
    types.ts             # CheckResult, CheckIssue, Severity
    versions.ts          # Cross-package version consistency
    bridges.ts           # Cross-ecosystem edge validation
    env.ts               # Shared env key parity
    staleness.ts         # Generated output presence check
  commands/
    add.ts               # Scaffold new package + update mido.yml
    affected.ts          # Git diff → package graph walk → affected set
    build.ts             # Build library packages (skips apps unless --all)
    check.ts             # Orchestrates all checks, --fix flow, --quiet mode
    ci.ts                # Full CI pipeline: generate → build → lint → test → check
    commit-msg.ts        # Validate commit message against conventional commit rules
    doctor.ts            # Workspace diagnostics (config, hooks, tools, generated output)
    ecosystem-runner.ts  # Shared runner for lint/fmt/build/test commands
    fmt.ts               # Run formatters across all packages per ecosystem
    generate.ts          # Run all bridge pipelines with caching (fresh clone / CI)
    graph.ts             # D3.js interactive dependency graph (HTML/DOT/ASCII)
    group.ts             # Package grouping by ecosystem with filtering
    init.ts              # Scan repo, generate mido.yml interactively
    install.ts           # Write git hooks to .git/hooks/
    lint.ts              # Run linters across all packages per ecosystem
    migrate.ts           # Migrate external tool configs into mido.yml
    outdated.ts          # Progressive dependency analysis orchestrator (L1→L2→L3)
    upgrade.ts           # Interactive dependency upgrade with lock/manifest sync
    pre-commit.ts        # Full pre-commit suite: fmt --check → lint → check --quiet
    reconcile.ts         # Reconciliation mode when mido.yml already exists
    rename.ts            # Rename workspace — cascades to all manifests, warns about platform IDs
    test.ts              # Run tests across all packages per ecosystem
    why.ts               # Show which packages use a dependency
    utils/
      shared.ts          # Init types, constants, config helpers, re-exports
      prompts.ts         # Bridge prompt flows (watch, modify, additional)
      cleanup.ts         # Tool detection, migration table, dependency removal
      config-render.ts   # YAML rendering + default config builder
  outdated/
    types.ts             # All interfaces for the outdated analysis subsystem
    schemas.ts           # Zod schemas for npm/pub.dev API responses
    collect.ts           # Dependency collection, stripRange, classifyUpdate
    registry.ts          # Enhanced registry fetching (deprecation, peers, changelog)
    risk.ts              # Risk scoring algorithm (0-100 composite)
    level1.ts            # Level 1: registry scan with enriched metadata
    tarball.ts           # Tarball download + extraction (Node built-ins only)
    api-diff.ts          # Export extraction + diffing per ecosystem (TS/Dart)
    level2.ts            # Level 2: static API surface diff
    level3.ts            # Level 3: live validation (temp dir + typecheck + tests)
    display.ts           # Console output formatting for all levels
  discovery/
    scanner.ts           # Filesystem scanning for ecosystem markers
    heuristics.ts        # Bridge and ecosystem detection heuristics
  watcher/
    dev.ts               # File watcher daemon, bridge execution with pipeline support
    bridge-runner.ts     # Bridge resolution, grouping, pipeline execution
    pipeline.ts          # Pipeline runner: step sequences, output hashing, change detection
    pipeline-cache.ts    # Input hashing + cache hit/miss for generate command
    debouncer.ts         # Debounce file events before triggering bridges
  commit/
    validator.ts         # Conventional commit parsing and validation
```

## Key Design Decisions

- **Parsers are the plugin boundary.** Adding a new ecosystem = one file implementing `ManifestParser`. Everything upstream is ecosystem-agnostic.
- **The graph is the core data structure.** Every command loads config → builds graph → operates on graph. Never bypass the graph.
- **`mido.lock` is the version policy.** When it exists, `mido check` validates manifests against the lock, not just against each other. `mido upgrade` updates manifests and the lock atomically.
- **Progressive dependency analysis.** `mido outdated` offers three incremental levels: Level 1 (registry scan — deprecation, peer conflicts, risk scores), Level 2 (static API surface diff — tarball download + export diffing), Level 3 (live validation — temp dir + typecheck + tests). Each level is offered after the previous completes. `--deep` forces L2, `--verify` forces L1+L2+L3, `--json`/`--ci` stop at L1.
- **No new runtime dependencies for outdated analysis.** Tarball extraction uses Node's built-in `zlib.gunzipSync()` + a minimal tar header parser. Export diffing uses regex heuristics on `.d.ts` / `.dart` files. No `tar`, `semver`, or other packages added.
- **mido owns git hooks.** `mido install` writes hooks to `.git/hooks/`. No Husky, no commitlint — mido handles pre-commit, commit-msg, post-merge, and post-checkout.
- **Config auto-migration pipeline.** The loader runs all migrations on every `loadConfig()` call. Each migration is idempotent — running an already-migrated config is a no-op. Migrations are defined in `src/config/loader.ts` as `Migration` objects with a `label` and `run` function. To add a new migration: write a `(doc: Document) => boolean` function and append it to `MIGRATIONS`. Current migrations: bridge field renames (v0.0.3), flat lint/format → ecosystem-centric (v0.0.32), commits-under-lint → top-level (v0.0.32).
- **Node.js target for distribution.** The published CLI must run on plain Node.js (>=20.19). No Bun-specific APIs in source. `#!/usr/bin/env node` shebang. Development uses Bun.
- **CLI UX uses `@clack/prompts`.** No other prompt/UI libraries. ANSI color codes in `src/output.ts` are still raw (no chalk) — `@clack/prompts` handles its own styling.
- **Plugins own pipeline steps.** Domain plugins (e.g., mido-openapi) decompose bridges into discrete steps via `buildPipeline()`. The pipeline runner executes steps sequentially with per-step timing and SHA-256 output hashing for change detection. The `run` field on bridges is a fallback for when no plugin claims the bridge.
- **Prepare step is auto-detected.** The openapi plugin checks source package scripts for spec preparation (e.g., `openapi:prepare`, or `prepare` containing "spec"/"openapi"/"dart"). This runs between export and downstream generation as a discrete pipeline step.
- **Plugins inform watch paths during init.** Domain plugins suggest watch paths based on framework detection (e.g., mido-openapi finds Elysia routes). Ecosystem plugins suggest based on package structure. Suggestions are presented for user confirmation, not applied blindly.
- **Ecosystem plugins invoke tools directly.** The TypeScript plugin parses existing `generate` scripts to extract `openapi-typescript` invocation parameters (input/output paths) and runs the tool directly instead of delegating to a shell script.
- **Framework adapters for zero-config export.** The openapi plugin detects server frameworks (Elysia, Hono, Express, Fastify, Koa, NestJS) and their OpenAPI plugins from dependencies. The exporter boots the server on a random free port, fetches the spec from the framework's known endpoint, writes it to disk, and kills the server. No export script needed. The `openapi:export` script is a fallback for unsupported frameworks.
- **Bridge-level overrides for edge cases.** Bridges support optional `entryFile` (server entry point) and `specPath` (custom spec endpoint) for when auto-detection fails.
- **Standard actions across ecosystems.** `STANDARD_ACTIONS` in `src/plugins/types.ts` defines lint, lint:fix, format, format:check, build, typecheck, codegen. Ecosystem plugins implement whichever actions apply. The `lint`, `fmt`, `build` commands dispatch these actions per-package.
- **Tool resolution for lint/format.** mido bundles oxlint and oxfmt as direct dependencies. TS plugin checks workspace `node_modules/.bin/` first (user override), then mido's own bundled `node_modules/.bin/`, then `eslint`/`prettier` as fallbacks. Dart plugin uses `dart analyze`/`dart format` from PATH. Missing tools produce a warning, not an error.
- **Config is ecosystem-centric, not tool-centric.** `format.typescript` holds oxfmt options, `format.dart` holds dart format options. `lint.typescript` holds oxlint categories/rules, `lint.dart` holds dart analyze options. Users never write tool names — mido picks the right tool per ecosystem. `format.ignore` and `lint.ignore` apply across all ecosystems.
- **Oxlint plugins are auto-enabled.** The TS plugin detects dependencies and enables oxlint plugins automatically: always `typescript`, `unicorn`, `oxc`, `import`; conditionally `react`, `jsx-a11y`, `react-perf` (if React/Preact), `jest`, `vitest`, `nextjs`.
- **Lint categories map to oxlint categories.** `lint.typescript.categories` (correctness, suspicious, pedantic, perf, style, restriction, nursery) map directly to oxlint's `--categories` config. Default: correctness=error, suspicious=warn, perf=warn.
- **Lint/format config lives in mido.yml.** The `lint` and `format` sections configure tools per ecosystem. The TS plugin generates temporary `.oxlintrc.json` and `.oxfmtrc.json` at runtime in `node_modules/.cache/mido/` and passes `--config` flags to the tools. No config files committed to the repo. `mido init` migrates existing configs into the ecosystem-centric structure.
- **JSON schema for VS Code autocomplete.** `scripts/generate-schema.ts` produces `schema.json` at build time. The `yaml-language-server` comment in generated mido.yml points to `node_modules/@oddlantern/mido/schema.json`. Schema ships with the npm package.
- **Commits is a top-level config section.** Not nested under lint. `mido init` auto-populates `commits.scopes` from detected package names.
- **Pre-commit is a single command.** `mido pre-commit` runs format check → lint → workspace check in sequence, stopping on first failure. The pre-commit hook installed by `mido install` is just `mido pre-commit`.
- **Parallel execution within ecosystems.** Lint and format run packages within the same ecosystem in parallel via `Promise.all`. Build runs sequentially (build order may matter).
- **mido-design is a domain plugin.** Same tier as mido-openapi. Owns the `tokens.json` schema (Zod), validates tokens, then delegates code generation to ecosystem plugins. mido-dart generates Flutter themes (ColorScheme, ThemeExtensions, constants, ThemeData). mido-typescript generates CSS custom properties and TS constants. One `tokens.json`, all ecosystems served.
- **Token schema is tool-agnostic.** Names like `color`, `spacing`, `radius`, `elevation`, `typography`, `extensions` are semantic — no Flutter, CSS, or framework terms. Each ecosystem plugin adapts naming to its framework idioms (e.g., `spacing.xs` → Dart: `DSSpacing.xs`, CSS: `--spacing-xs`).
- **Extensions support typed fields.** Extension values are detected by shape: `{ light, dark }` hex → themed color, `#hex` → static color, `number` → number, `{ light, dark }` numbers → themed number, `string` → string. Each ecosystem maps these to native types with proper lerp/interpolation.
- **Font provider controls typography output.** `typography.provider` is `"asset"` (default), `"google_fonts"`, or `"none"`. Dart codegen adapts: asset → `TextStyle(fontFamily: ...)`, google_fonts → `GoogleFonts.method(...)`, none → no font family.
- **Shared-artifact optimization in watcher.** When multiple bridges share the same artifact (e.g., dart and typescript bridges both pointing to `tokens.json`), the watcher groups them: single domain plugin validation, then parallel ecosystem generation in one pipeline run. Without this, editing `tokens.json` would trigger redundant validations.
- **Generated output convention: `<source>/generated/<ecosystem>/`.** Domain plugins (openapi, design) write generated code next to the source package, not into consumers. Consumers depend on the generated package via workspace links. The `generated/` directories are gitignored — they are derived output regenerated by `mido generate` (fresh clone, CI) or `mido dev` (watch mode). This is consistent across all domain plugins.
- **First-run package scaffolding.** When a generated output directory doesn't exist, the ecosystem plugin creates it with a minimal manifest (`pubspec.yaml` for Dart, `package.json` for TS) and the generated output structure.
- **`mido generate` runs all bridge pipelines.** Non-watch equivalent of what `mido dev` does on change. Used after fresh clone or in CI. Resolves all bridges, groups by artifact, executes each pipeline.
- **mido-assets is a domain plugin.** Same tier as mido-design and mido-openapi. Scans directories for asset files (SVG, PNG, etc.), infers categories from filename prefixes (e.g., `achievement_*`, `genre_*`, `ui_*`), detects theme variants (light/dark subdirs), then delegates to ecosystem plugins. mido-dart generates typed Flutter widget classes (SvgPicture wrappers) + pubspec asset declarations. mido-typescript generates path exports and inlined SVG strings. Class name prefixes are derived from the workspace name in mido.yml.
- **`mido rename` cascades workspace name.** Updates mido.yml, all package.json names (@scope), all pubspec.yaml names (prefix_), then reminds to run `mido generate` to propagate into generated code. Platform identifiers (iOS bundle ID, Android application ID, Firebase config) are detected and warned about but NOT renamed by default — they are deployment identities. `--include-platform-ids` overrides this for pre-release projects.
- **Plugin directory structure: ecosystem/ + domain/.** Ecosystem plugins live in `builtin/ecosystem/{name}/plugin.ts`. Domain plugins live in `builtin/domain/{name}/plugin.ts`. This makes the two-tier architecture visible in the filesystem. Naming convention for future extraction: `mido-{name}-ecosystem` and `mido-{name}-domain`.
- **No parent-relative imports.** All cross-directory imports use `@/` path aliases resolved via tsconfig `paths`. No `../` imports — use `@/` aliases instead. Same-directory imports (`./`) are allowed. Extensions are omitted (bundler resolution). This eliminates brittle path math when files move.

## Bridge Fields

Bridges use `source/target/artifact`:
- `source` — the package that **produces** the artifact
- `target` — the package that **consumes** the artifact
- `artifact` — path to the bridge file (e.g., `openapi.json`)
- `entryFile` — (optional) server entry file relative to server package dir
- `specPath` — (optional) custom OpenAPI spec endpoint path

## Code Rules

- No magic strings or numbers — use named constants.
- No `any` types — no exceptions. Use `unknown` and narrow.
- All exports named, never default (config files exempt: `tsdown.config.ts`, `commitlint.config.js`).
- No `as` type casting — parse external data with Zod, narrow with type guards.
- `readonly` on all interface properties and array types.
- Explicit return types on exported functions.
- `import type` for type-only imports.
- Prefer early returns over nested conditionals.
- Functions do one thing. Files contain one concept.

### Console Output

This is a CLI tool — `console.log` and `console.error` are the output mechanism. Use them intentionally:
- `console.log` for user-facing output (check results, help text, summaries)
- `console.error` for errors
- All formatting goes through `src/output.ts` — never inline ANSI codes in commands or checks

### Import Order (enforced by oxfmt)

1. Node.js built-ins (`node:fs`, `node:path`, etc.)
2. Third-party packages (`yaml`, `zod`)
3. `@/` aliased imports (`@/graph/types`, `@/plugins/types`)

Each group separated by a blank line. No `.js` extensions — bundler module resolution handles this. No parent-relative imports (`../`) — use `@/` aliases. Same-directory imports (`./`) are allowed.

## Naming

- Files: `kebab-case.ts`
- Types/interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` for true constants, `camelCase` for derived values

## Commits

Conventional commits enforced by `mido commit-msg` (via git hook).

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Scopes: `config`, `graph`, `check`, `fix`, `lock`, `parsers`, `plugins`, `cli`, `ci`, `deps`, `init`, `hooks`, `commit`, `dev`, `rename`, `assets`
- Max header: 100 chars

## Build

```bash
bun run build          # tsdown → dist/bin.js
bun run typecheck      # tsc --noEmit
bun run lint           # oxlint src/
bun run format         # oxfmt src/
bun run format:check   # oxfmt --check src/ (CI mode)
```

Build output is `dist/bin.js` (ESM, Node 20 target, sourcemaps). The `bin` field in `package.json` points to `./dist/bin.js`.

## Testing

- Test fixtures in `test/fixture/` (has intentional errors) and `test/fixture-clean/` (passes all checks)
- Run from fixture dirs: `cd test/fixture && node ../../dist/bin.js check`
- After any change, verify both fixtures produce expected results
- Design token tests in `test/tokens/` — schema validation, Dart codegen, CSS/TS codegen, shared-artifact grouping
- Token test fixture in `test/fixture-tokens/tokens.json` — minimal valid token set
- Run token tests: `bun test test/tokens/`

## Adding a New Ecosystem Parser

1. Create `src/parsers/<manifest-name>.ts` implementing `ManifestParser`
2. Register in `src/bin.ts` parser registry map
3. Add ecosystem to `mido.yml` schema in `src/config/schema.ts` (if new manifest keys needed)
4. Add test fixture packages with the new manifest format
5. Verify `mido check` discovers and parses them

## Adding a New Check

1. Create `src/checks/<n>.ts` exporting a function that takes `WorkspaceGraph` and returns `CheckResult`
2. Wire into `src/commands/check.ts` in the results array
3. Add fixture test cases that exercise both pass and fail paths

## Things NOT to Do

- Do not add runtime dependencies without discussion. The dep count should stay minimal.
- Do not use `process.exit()` anywhere except `src/bin.ts`. Commands return exit codes, the entry point exits.
- Do not write Bun-specific code in `src/`. The published binary runs on Node.js.
- Do not auto-format on commit hooks. The pre-commit hook runs `mido pre-commit` (format check + lint + workspace check). It checks formatting but does not auto-fix.
- Do not add CLI framework deps (commander, yargs, etc). The command router is ~30 lines and that's intentional.
- Do not create separate `.oxlintrc.json`, `.oxfmtrc.json`, or `.oxfmtignore` files. All lint and format config lives in the ecosystem-centric `lint` and `format` sections of `mido.yml` (e.g., `format.typescript`, `lint.typescript.categories`). The TS plugin generates temporary config files at runtime in `node_modules/.cache/mido/`.
