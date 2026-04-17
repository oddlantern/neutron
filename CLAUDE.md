# CLAUDE.md — neutron

Cross-ecosystem monorepo workspace tool. Package: `@oddlantern/neutron`. Binary: `neutron`. Config: `neutron.yml`.

## Architectural invariants

These shape every change. Violating any of them means either rethinking the change or rethinking the invariant. If you catch yourself arguing for an exception, that's a signal — raise it.

- **The graph is the core data structure.** Every command loads config → builds a `WorkspaceGraph` → operates on the graph. New commands accept `ParserRegistry` and pass through `buildWorkspaceGraph`. Never bypass it.
- **Parsers are the ecosystem boundary.** Manifest parsing is the only place ecosystem-specific knowledge lives upstream of plugins. Everything above a parser is ecosystem-agnostic.
- **Plugins come in two tiers.** *Ecosystem* plugins (TypeScript, Dart, Python, Rust, Go, PHP) implement `STANDARD_ACTIONS` for a language. *Domain* plugins (design, openapi, assets, schema) define artifact formats and orchestrate pipelines that delegate to ecosystem plugins for actual codegen. One artifact, many ecosystem consumers.
- **Domain plugins own pipelines.** A bridge's execution is a domain plugin's `buildPipeline()` — ordered steps with per-step hashing for change detection. The `run` field on a bridge is a fallback for when no domain plugin claims the artifact.
- **`neutron generate` and `neutron dev` run the same logic.** Same pipelines, different triggers. A bridge that works in `dev` works in `generate`, and vice versa.
- **Generated output lives adjacent to source.** `<source>/generated/<ecosystem>/` — gitignored, consumers link via workspace deps. Never write generated code into consumer packages.
- **Config is ecosystem-centric, not tool-centric.** Users write `format.typescript.*`, not `oxfmt.*`. The plugin picks the right tool per ecosystem. One rule set, many implementations.
- **`neutron.lock` is the version policy.** When present, `check` validates manifests against it. When absent, versions only need to be mutually consistent. `upgrade` edits manifests and the lock together.

## Extension points

| What | Where | Notes |
|---|---|---|
| New ecosystem | `src/parsers/<manifest>.ts` + `src/plugins/builtin/ecosystem/<name>/plugin.ts` | Parser registered in `src/bin.ts`. Plugin exports `experimental: true` until framework detection + codegen parity land. |
| Framework adapter (OpenAPI export) | `src/plugins/builtin/domain/openapi/adapters/<name>.ts` + register in `index.ts` | Set `ecosystem` to the target language. `detect(deps)` returns true when both framework and OpenAPI plugin are present. |
| New domain | `src/plugins/builtin/domain/<name>/plugin.ts` | Implement `detectBridge`, `exportArtifact`, `buildPipeline`. |
| New check | `src/checks/<n>.ts` | Function takes `WorkspaceGraph`, returns `CheckResult`. Wire in `src/commands/check.ts`. |
| New config migration | Append a `Migration` to `MIGRATIONS` in `src/config/loader.ts` | **Must be idempotent** — running on already-migrated config is a no-op. |
| New codegen path | `src/plugins/builtin/ecosystem/<lang>/<domain>-codegen.ts` | Route from the ecosystem plugin's `execute()` switch. |

## Operational rules

- **Node.js target for distribution.** Published CLI runs on Node >=20.19. No Bun-specific APIs in `src/`. Development uses Bun; CI installs both.
- **No CLI framework deps.** The command router in `src/bin.ts` is ~30 lines. Keep it that way. No commander, no yargs.
- **No new runtime deps without discussion.** Dep count is a liability. Outdated analysis specifically uses only Node built-ins — no `tar`, no `semver`.
- **neutron owns git hooks.** `install` writes them directly. No Husky, no commitlint.
- **`process.exit` only in `src/bin.ts`.** Commands return exit codes; the entry point exits.
- **Interactive-by-default for mutations; silent for reads.** `install`, `rename`, `generate`, `upgrade`, `init` prompt. `check`, `affected`, `why`, `outdated --json` don't. `--yes` skips prompts; `--dry-run` previews without writing.
- **`--dry-run` is a cross-cutting concern.** Flows through `ExecutionContext.dryRun`. Use `createDryFs(dryRun, root)` for any plugin I/O instead of direct `fs` calls.
- **Tool resolution is a fallback chain.** Each ecosystem defines its own. TypeScript: workspace `node_modules/.bin/` → bundled `node_modules/.bin/` → global PATH. Python: `.venv/bin/` → `venv/bin/` → workspace `.venv/bin/` → PATH. Rust: PATH (cargo is assumed when Rust is in the workspace).
- **Bundled tools: oxlint + oxfmt only.** Other ecosystems rely on user installs (ruff, cargo, dart, etc.). The bundling boundary matches "where is there no community convention for per-project installs."
- **Framework adapters are the zero-config path.** The openapi plugin boots the server on a random free port, fetches from the adapter's `defaultSpecPath`, writes to disk, kills the process. Bridge-level `entryFile` and `specPath` overrides exist for edge cases. An `openapi:export` script is the ultimate fallback when no adapter matches.
- **First-run scaffolding is the codegen contract.** When a generated output directory doesn't exist, the ecosystem plugin creates it with a minimal manifest (pubspec.yaml / package.json / pyproject.toml / Cargo.toml) and the expected structure. Subsequent runs preserve user edits to that manifest.
- **Config auto-migration on every load.** Each `Migration` in the pipeline is idempotent. Users never need to run a migration command — `loadConfig` handles it.
- **JSON schema ships with the package.** `scripts/generate-schema.ts` derives `schema.json` from Zod at build time. `neutron init` wires the `yaml-language-server` comment so VS Code autocompletes against it.

## Code rules

- `readonly` on interface properties and array types.
- Explicit return types on exported functions.
- `import type` for type-only imports.
- Early returns over nested conditionals.
- Functions do one thing. Files contain one concept.
- All ANSI formatting through `src/output.ts`. `console.log` for user output, `console.error` for errors. Never inline color codes.
- No comments that describe what the code does — the name already does. Comments carry WHY: a constraint, an invariant, a workaround for a specific bug.

## Naming

- Files: `kebab-case.ts`
- Types / interfaces: `PascalCase`
- Functions / variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` for immutable values, `camelCase` for derived

## Commits

Enforced by `neutron commit-msg` (git hook).

- Conventional commits: `type(scope): description`.
- Allowed scopes: `config`, `graph`, `check`, `fix`, `lock`, `parsers`, `plugins`, `cli`, `ci`, `deps`, `init`, `hooks`, `commit`, `dev`, `rename`, `assets`.
- Max header: 100 chars.
- `feat`, `fix`, `refactor`, `perf`, `docs`, `build` surface in CHANGELOG via release-please. `chore`, `ci`, `test`, `style` are hidden.

## Build

```bash
bun run build          # tsdown → dist/bin.js
bun run typecheck      # tsc --noEmit
bun run lint           # oxlint src/
bun run format:check   # oxfmt --check src/
bun test               # all suites
```

Build output is `dist/bin.js` (ESM, Node 20 target, sourcemaps). `#!/usr/bin/env node` shebang. The `bin` field in `package.json` points to it.

## Testing principles

- **Test behavior, not string-interpolation.** Asserting that generated code contains the words you just wrote has zero regression value. Test: does it compile? does the error path surface the hint? does the fallback chain pick the right tier?
- **Codegen tests compile the output.** Python: `python -m py_compile`. Rust: `cargo check`. Dart: `dart analyze`. Substring assertions alone are insufficient — a syntax regression must fail a test.
- **Skip gracefully when tools are absent.** `test.skipIf(!whichTool())` on integration tests; CI installs the toolchains.
- **Two fixtures.** `test/fixture/` (intentional errors) and `test/fixture-clean/` (passes every check). New commands smoke-test both.
- **Both paths, always.** When a check function exists, there's a test that exercises pass AND a test that exercises fail.
- **Commands that touch shared state are integration-tested via the built binary.** `neutron rename`, `neutron install`, `neutron pre-commit` spawn `dist/bin.js` against a `mkdtempSync` workspace. Unit tests on helper functions are a supplement, not a replacement.

## Things NOT to do

- No runtime deps added without discussion.
- No `process.exit()` outside `src/bin.ts`.
- No Bun-specific APIs in `src/`.
- No CLI framework deps.
- No auto-format on commit hooks. Pre-commit checks; it doesn't fix.
- No separate `.oxlintrc.json` / `.oxfmtrc.json` / `.oxfmtignore` committed. The TS plugin writes these at runtime to `node_modules/.cache/neutron/`.
- No generated-code edits committed — dist/, generated/, schema.json are produced by tooling.
- No describing-what-it-does comments. Rename the thing instead.
- No file-tree enumeration in CLAUDE.md. Drifts on every change. Point at invariants and extension points; let the code be the map.
