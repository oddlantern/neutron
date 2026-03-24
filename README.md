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

## Setup

Create `mido.yml` in your workspace root:

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
  - from: packages/api/clients/dart
    to: packages/api
    via: packages/api/openapi.json

env:
  shared:
    - API_URL
  files:
    - apps/server/.env.example
    - apps/mobile/.env.example
```

## Usage

```bash
mido check
```

Runs all workspace checks with a unified pass/fail exit code:

- **versions** — flags any dependency that appears in 2+ packages with different version ranges, across all ecosystems
- **bridges** — validates cross-ecosystem dependency edges and their bridge artifacts
- **env** — checks that shared environment keys exist in all declared env files

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
  - from: packages/api/clients/dart   # the consumer
    to: packages/api                   # the producer
    via: packages/api/openapi.json     # the bridge artifact
```

This tells mido that the Dart client depends on the TypeScript API package through the OpenAPI spec. `mido check` validates that both packages exist in the workspace and that the bridge artifact is present on disk.

## License

MIT © [Odd Lantern](https://oddlantern.dev)
