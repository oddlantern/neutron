# mido-cli — Development Memory

## What was done (2026-04-06) — ALL THREE PHASES COMPLETE

### Competitive Analysis
Performed a full competitive analysis of mido-cli against the monorepo/workspace tooling landscape (Nx, Turborepo, Moon, Melos, Bazel, Biome, Oxlint, Syncpack, Changesets, Husky, Lefthook).

**Key findings:**
- mido's unique advantage is the bridge pipeline (cross-ecosystem code generation) — no other tool models this
- First-class TS + Dart in one graph is unique — no single competitor covers both
- Ecosystem-centric config and bundled lint/format (oxlint + oxfmt) are real DX wins

**Critical gaps identified:**
1. No topological sort for builds (correctness bug — build order is arbitrary)
2. No cycle detection in dependency graph
3. No glob patterns in package paths (`apps/*` doesn't work)
4. No task-level caching (only bridge pipelines are cached)
5. No `--affected` flag for lint/test/build
6. Hardcoded CI pipeline (can't skip/reorder steps)
7. No custom task definitions
8. No external plugin system (only 5 builtin plugins)
9. No remote caching
10. No version/release management

### Expansion Plan Created
Three-phase plan to make mido work for any project:
- **Phase 1:** Foundation fixes (topo sort, cycles, globs) — prerequisite for everything
- **Phase 2:** Ecosystem plugins for Python, Rust, Go, PHP — broadens language support
- **Phase 3:** Universal type sync via schema domain plugin — types/structs/classes stay in sync across all languages

Plan file: `.claude/plans/ecosystem-expansion.md`

## Why
The bridge pipeline moat only matters if mido speaks more than two languages. The user builds multiple projects across different language combinations and needs mido as a drop-in tool for any monorepo.

## How
All three phases implemented in one session:
- Phase 1: `src/graph/topo.ts`, `src/graph/glob.ts`, wired into workspace/build/ecosystem-runner, fixed 5 pre-existing type errors
- Phase 2: 4 parsers (pyproject, cargo, go-mod, composer), 4 plugins (python, rust, go, php), smol-toml dep, all registered
- Phase 3: schema domain plugin, 6 ecosystem codegen files (TS interfaces, Dart classes, Python dataclasses, Rust structs, Go structs, PHP classes)
- Tests: 522 → 593 (+71 new), 0 failures, clean typecheck, clean build
