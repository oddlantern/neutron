# CLAUDE.md — mido

Cross-ecosystem monorepo workspace tool. Package: `@oddlantern/mido`. Binary: `mido`.

## Architecture

```
scripts/
  generate-schema.ts     # JSON schema generator → schema.json (build-time)
src/
  bin.ts                 # CLI entry point, command router
  output.ts              # ANSI terminal formatting
  lock.ts                # mido.lock read/write/merge
  prompt.ts              # Interactive prompts (@clack/prompts wrappers)
  manifest-writer.ts     # Write version ranges back to manifests
  config/
    schema.ts            # Zod schema for mido.yml (ecosystem-centric format/lint/commits)
    loader.ts            # Walk-up config finder + validator + auto-migration
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
    types.ts             # Plugin interfaces, pipeline types, execution context, STANDARD_ACTIONS
    registry.ts          # Plugin registry, context factory, watch path suggestions
    loader.ts            # Load builtin (and future external) plugins
    builtin/
      exec.ts            # Shared runCommand helper + isRecord guard
      openapi/
        plugin.ts        # Domain plugin: OpenAPI spec export, prepare, downstream delegation
        exporter.ts      # Export engine: boot server, fetch spec, write to disk
        adapters/
          types.ts       # FrameworkAdapter interface
          index.ts       # Adapter registry + detectAdapter()
          elysia.ts      # Elysia adapter (spec at /openapi/json)
          hono.ts        # Hono adapter (spec at /openapi)
          express.ts     # Express adapter (spec at /api-docs)
          fastify.ts     # Fastify adapter (spec at /documentation/json)
          koa.ts         # Koa adapter (spec at /swagger.json)
          nestjs.ts      # NestJS adapter (spec at /api-docs-json)
      typescript.ts      # Ecosystem plugin: TS lint/fmt/build/typecheck + openapi-typescript
      dart.ts            # Ecosystem plugin: Dart lint/fmt/build + swagger_parser + build_runner
  checks/
    types.ts             # CheckResult, CheckIssue, Severity
    versions.ts          # Cross-package version consistency
    bridges.ts           # Cross-ecosystem edge validation
    env.ts               # Shared env key parity
  commands/
    check.ts             # Orchestrates all checks, --fix flow, --quiet mode
    lint.ts              # Run linters across all packages per ecosystem
    fmt.ts               # Run formatters across all packages per ecosystem
    build.ts             # Run build actions across all packages per ecosystem
    pre-commit.ts        # Full pre-commit suite: fmt --check → lint → check --quiet
    init.ts              # Scan repo, generate mido.yml interactively (with plugin watch suggestions)
    install.ts           # Write git hooks to .git/hooks/
    commit-msg.ts        # Validate commit message against conventional commit rules
  discovery/
    scanner.ts           # Filesystem scanning for ecosystem markers
    heuristics.ts        # Bridge and ecosystem detection heuristics
  watcher/
    dev.ts               # File watcher daemon, bridge execution with pipeline support
    pipeline.ts          # Pipeline runner: step sequences, output hashing, change detection
    debouncer.ts         # Debounce file events before triggering bridges
    pm-detect.ts         # Package manager detection from lockfiles
  commit/
    validator.ts         # Conventional commit parsing and validation
```

## Key Design Decisions

- **Parsers are the plugin boundary.** Adding a new ecosystem = one file implementing `ManifestParser`. Everything upstream is ecosystem-agnostic.
- **The graph is the core data structure.** Every command loads config → builds graph → operates on graph. Never bypass the graph.
- **`mido.lock` is the version policy.** When it exists, `mido check` validates manifests against the lock, not just against each other.
- **mido owns git hooks.** `mido install` writes hooks to `.git/hooks/`. No Husky, no commitlint — mido handles pre-commit, commit-msg, post-merge, and post-checkout.
- **Config auto-migration.** The loader detects old schema formats (e.g., `from/to/via` bridges) and rewrites them in place, preserving YAML formatting.
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
3. Internal imports (`../graph/types.js`, `./schema.js`)

Each group separated by a blank line. Always use `.js` extensions on internal imports (required for ESM resolution).

## Naming

- Files: `kebab-case.ts`
- Types/interfaces: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` for true constants, `camelCase` for derived values

## Commits

Conventional commits enforced by `mido commit-msg` (via git hook).

- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Scopes: `config`, `graph`, `check`, `fix`, `lock`, `parsers`, `plugins`, `cli`, `ci`, `deps`, `init`, `hooks`, `commit`, `dev`
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
