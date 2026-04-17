# Contributing to neutron

Thanks for considering a contribution. This document covers what we expect on the submission side — architecture, principles, and non-negotiables are in `CLAUDE.md`.

## Before you start

- Check `CLAUDE.md` for the architectural invariants and scope rules. If your change rubs against one of them, that's worth flagging up front in the issue.
- Open an issue for anything beyond a trivial bug fix. We'd rather align on approach before you write code than ask you to reshape a PR.
- Search existing issues and PRs first — the gap you've found may already be tracked.

## Local development

```bash
bun install
bun run typecheck      # tsc --noEmit
bun run lint           # oxlint src/
bun run format:check   # oxfmt --check src/
bun test               # all suites
bun run build          # tsdown → dist/bin.js
```

Some tests require ecosystem toolchains (rust, python, go, php). They skip gracefully when the tool isn't present. CI has the full matrix installed, so if your change doesn't break locally, push and check there.

For testing changes to the CLI against a real workspace, use `node dist/bin.js ...` from within a fixture directory.

## What we accept

**Welcomed:**
- Bug fixes with a failing test that's now passing.
- Framework adapters for OpenAPI export (add under `src/plugins/builtin/domain/openapi/adapters/`).
- Ecosystem parity improvements (Python/Rust/Go/PHP are still experimental).
- Documentation improvements.
- Performance fixes with a baseline and a new number.

**Triaged on a case-by-case basis:**
- Changes to `EcosystemPlugin` / `DomainPlugin` / `ExecutionContext` — breaking the plugin API is a semver commitment we don't make lightly.
- Changes to `neutron.yml` schema — requires a migration in `src/config/loader.ts` that's idempotent.
- New domain plugins — we're pushing these to the external plugin path first.

**Out of scope (closed without review):**
- Features that duplicate Nx/Turborepo value props (task-level caching, generators, remote caching). Neutron's moat is cross-ecosystem bridges.
- Deployment orchestration features.
- Web dashboards / GUIs.

## Commit discipline

We use conventional commits, enforced by `neutron commit-msg` (git hook installed via `neutron install`):

```
<type>(<scope>): <description>
```

- Types: `feat`, `fix`, `refactor`, `perf`, `docs`, `build`, `ci`, `chore`, `test`, `style`.
- Allowed scopes: `config`, `graph`, `check`, `fix`, `lock`, `parsers`, `plugins`, `cli`, `ci`, `deps`, `init`, `hooks`, `commit`, `dev`, `rename`, `assets`.
- Max header: 100 characters. Detail goes in the body.

Reasoning ("why") goes in the commit body, not the subject. The subject is what changed; the body is why it changed and any consequences a future reader needs to know.

## Tests

Every behavioral change has a test. If it can't be tested, the issue probably lives upstream or the code needs refactoring for testability — both are valid findings.

**Test style we like:**
- Integration tests that spawn the real `dist/bin.js` against `mkdtempSync` fixtures (see `test/commands/rename.test.ts`).
- Codegen tests that compile the output (`cargo check`, `php -l`, `python -m py_compile`, `go build`).
- Pure unit tests on extracted helpers where logic lives.

**Test style we reject:**
- Tests that assert generated code contains words you just wrote in a string constant.
- Tests of `plugin.name === "typescript"` — testing a constant against itself.

If you find one of these already in the codebase, a PR to delete it is welcome.

## Plugin API stability (pre-1.0)

We're pre-1.0 — the plugin API can still change. At 1.0 we freeze `EcosystemPlugin`, `DomainPlugin`, `ExecutionContext`, and `STANDARD_ACTIONS`; breaking changes become 2.0-only. If your change breaks the plugin contract, say so in the PR and include the rationale.

## Questions

Small stuff: open a [Discussion](https://github.com/oddlantern/neutron/discussions).
Bugs / concrete features: open an issue.
