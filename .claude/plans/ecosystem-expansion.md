# mido-cli Ecosystem Expansion Plan

## Goal

Make mido work for any project — not just TS + Dart. Fix foundation issues, add parsers/plugins for Python/Rust/Go/PHP, and implement universal type synchronization across all ecosystems.

---

## Phase 1: Foundation Fixes

### 1A. Topological Sort + Cycle Detection
- **Problem:** `src/commands/build.ts:71` builds packages in arbitrary order. No cycle detection in graph.
- **Solution:** New file `src/graph/topo.ts` — Kahn's algorithm with cycle detection.
- **Wire into:** `build.ts` (before build loop), `ecosystem-runner.ts` (before parallel execution), `workspace.ts` (detect cycles at construction time).
- **Status:** DONE

### 1B. Glob Patterns in Package Paths
- **Problem:** `src/graph/workspace.ts:40` only accepts literal paths. Can't write `apps/*`.
- **Solution:** New file `src/graph/glob.ts` — simple `*` expansion via readdirSync.
- **Wire into:** `workspace.ts` (expand before iterating package paths).
- **Status:** DONE

### Files
| File | Action |
|------|--------|
| `src/graph/topo.ts` | NEW — topologicalSort() + detectCycles() |
| `src/graph/glob.ts` | NEW — expandPackageGlobs() |
| `src/graph/workspace.ts` | MODIFY — call detectCycles after graph build, expand globs before resolving |
| `src/commands/build.ts` | MODIFY — toposort each ecosystem group before build loop |
| `src/commands/ecosystem-runner.ts` | MODIFY — toposort each ecosystem group |
| `test/graph/topo.test.ts` | NEW |
| `test/graph/glob.test.ts` | NEW |

---

## Phase 2: Ecosystem Expansion

### New dependency: `smol-toml` (15KB, zero deps — for pyproject.toml + Cargo.toml)

### 2A. Python (pyproject.toml)
- **Parser:** `src/parsers/pyproject.ts` — PEP 621 + Poetry dual format, PEP 508 dep strings
- **Plugin:** `src/plugins/builtin/ecosystem/python/plugin.ts` — ruff (lint+format), pytest, mypy/pyright
- **Status:** DONE

### 2B. Rust (Cargo.toml)
- **Parser:** `src/parsers/cargo.ts` — TOML, shares smol-toml with Python
- **Plugin:** `src/plugins/builtin/ecosystem/rust/plugin.ts` — clippy, rustfmt, cargo test/build
- **Status:** DONE

### 2C. Go (go.mod)
- **Parser:** `src/parsers/go-mod.ts` — line-based format, no new deps
- **Plugin:** `src/plugins/builtin/ecosystem/go/plugin.ts` — golangci-lint, gofmt, go test/build/vet
- **Status:** DONE

### 2D. PHP (composer.json)
- **Parser:** `src/parsers/composer.ts` — JSON format, same approach as package-json.ts
- **Plugin:** `src/plugins/builtin/ecosystem/php/plugin.ts` — phpstan, php-cs-fixer, phpunit
- **Status:** DONE

### Registration (after all parsers pass)
| File | Change |
|------|--------|
| `src/discovery/scanner.ts` | Add to MANIFEST_MAP + SUPPORTED_ECOSYSTEMS |
| `src/bin.ts` | Add 4 parsers to registry |
| `src/plugins/loader.ts` | Import + register 4 plugins |
| `src/commands/ecosystem-runner.ts` | Add ECOSYSTEM_EXTENSIONS entries |
| `package.json` | Add smol-toml |

---

## Phase 3: Universal Type Sync

### New domain plugin: `schema`
- **Purpose:** JSON Schema → multi-language typed code (structs, classes, interfaces)
- **Files:** `src/plugins/builtin/domain/schema/plugin.ts`, `types.ts`
- **Detection:** `*.schema.json` artifacts

### Per-ecosystem codegen handlers
| Ecosystem | openapi | schema | design-tokens |
|-----------|---------|--------|---------------|
| Python | openapi-generator-cli | datamodel-code-generator | dataclass constants |
| Rust | openapi-generator-cli | typify / custom | — |
| Go | oapi-codegen | go-jsonschema / custom | — |
| PHP | openapi-generator-cli | custom | — |

- **Status:** DONE

---

## Implementation Order

1. Phase 1A + 1B (can parallel) → tests → wire into commands
2. Phase 2A (Python, establishes pattern) → 2B → 2C → 2D
3. Registration commit
4. Phase 3 (schema domain + per-ecosystem codegen)

## Verification

After each phase: `bun test` (522+ pass), `bun run build` (clean), `bun run typecheck` (no errors)
