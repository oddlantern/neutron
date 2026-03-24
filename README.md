# mido

Cross-ecosystem monorepo workspace tool. One config, one command, all your languages checked.

**mido** scans `package.json` and `pubspec.yaml` manifests across your entire monorepo, builds a unified dependency graph, and runs consistency checks that no single-ecosystem tool can catch.

## The problem

TypeScript monorepos have syncpack. Dart monorepos have melos. Neither sees the other. If your repo contains both — and a generated API client bridging them — version mismatches, stale artifacts, and env drift go undetected until something breaks at runtime.

## Install

```bash
npm install -D @oddlantern/mido

# or globally
npm install -g @oddlantern/mido
```

## Quick start

```bash
mido init       # Scan repo, generate mido.yml interactively
mido install    # Install git hooks (pre-commit, commit-msg, post-merge, post-checkout)
mido check      # Run all workspace consistency checks
```

## Setup

`mido init` scans your repo and proposes a `mido.yml`. You can also create one manually:

```yaml
workspace: my-project

ecosystems:
  typescript:
    manifest: package.json
    lockfile: bun.lock
    packages:
      - apps/server
      - packages/api
      - packages/shared

  dart:
    manifest: pubspec.yaml
    lockfile: pubspec.lock
    packages:
      - apps/mobile
      - packages/api/clients/dart

bridges:
  - source: packages/api                  # produces the artifact
    target: packages/api/clients/dart      # consumes the artifact
    artifact: packages/api/openapi.json    # the bridge file

env:
  shared:
    - API_URL
  files:
    - apps/server/.env.example
    - apps/mobile/.env.example

commits:
  types:
    - feat
    - fix
    - docs
    - style
    - refactor
    - perf
    - test
    - build
    - ci
    - chore
    - revert
  scopes:
    - server
    - api
    - flutter
  header_max_length: 100
  body_max_line_length: 200
```

## Commands

### `mido check`

Runs all workspace checks with a unified pass/fail exit code:

- **versions** — flags any dependency that appears in 2+ packages with different version ranges, across all ecosystems
- **bridges** — validates cross-ecosystem dependency edges and their bridge artifacts
- **env** — checks that shared environment keys exist in all declared env files

```bash
mido check           # Full output
mido check --quiet   # Silent on success, errors only on failure (for hooks)
mido check --fix     # Interactively resolve version mismatches
```

### `mido init`

Scans your repo for ecosystem markers (`package.json`, `pubspec.yaml`, etc.), detects bridges and env files, and generates `mido.yml` interactively.

### `mido install`

Writes git hooks to `.git/hooks/`. Idempotent — safe to run multiple times. Warns before overwriting existing non-mido hooks.

Installs:
- **pre-commit** — runs `mido check --quiet`
- **commit-msg** — runs `mido commit-msg` (conventional commit validation)
- **post-merge** — warns on workspace drift
- **post-checkout** — warns on workspace drift (branch checkout only)

### `mido commit-msg <file>`

Validates a commit message against conventional commit rules. Configured via the `commits` section in `mido.yml`. Falls back to sensible defaults if no config exists.

### Example output

```
mido — workspace: nextsaga (5 packages)

✗ versions — 2 version mismatch(es) found across 4 shared dependencies
  ✗ "zod" has 2 different version ranges across 2 packages
      apps/server (typescript): ^3.25.0 [production]
      packages/api (typescript): ^3.24.0 [production]
  ✗ "freezed_annotation" has 2 different version ranges across 2 packages
      apps/mobile (dart): ^3.2.0 [production]
      packages/api/clients/dart (dart): >=2.2.0 [production]
✓ bridges — 2 bridge(s) validated
✓ env — 1 shared key(s) verified across 2 file(s)

────────────────────────────────────────────────
1 check(s) failed, 2 passed
```

## Adding ecosystem support

mido is built around a parser plugin boundary. Each ecosystem needs one parser that implements:

```typescript
interface ManifestParser {
  manifestName: string;
  parse(manifestPath: string): Promise<ParsedManifest>;
}
```

Currently supported: `package.json` (npm/yarn/pnpm/bun) and `pubspec.yaml` (Dart/Flutter).

## Bridges

Bridges declare cross-ecosystem dependency edges that can't be inferred from manifest files alone:

```yaml
bridges:
  - source: packages/api                # the producer
    target: packages/api/clients/dart    # the consumer
    artifact: packages/api/openapi.json  # the bridge artifact
```

This tells mido that the TypeScript API package produces an OpenAPI spec consumed by the Dart client. `mido check` validates that both packages exist in the workspace and that the bridge artifact is present on disk.

## License

MIT © [Odd Lantern](https://oddlantern.dev)
