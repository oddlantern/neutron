<!-- Thanks for contributing. A few things to check before submitting. -->

## What

<!-- What does this change? One paragraph. -->

## Why

<!-- The workflow or bug this unblocks. -->

## Verification

<!-- Tick every box that applies. -->

- [ ] `bun run typecheck` passes
- [ ] `bun run lint` passes (0 warnings)
- [ ] `bun run format:check` passes
- [ ] `bun test` passes (or only failures relate to environments you don't have)
- [ ] Touched codegen? New/updated tests actually compile the output (`cargo check` / `php -l` / `go build` / `python -m py_compile`)
- [ ] Touched a plugin surface? Considered whether this is a breaking change on the plugin API

## Plugin API / config schema impact

<!--
If this changes:
- EcosystemPlugin / DomainPlugin / ExecutionContext / STANDARD_ACTIONS
- neutron.yml fields
- bridge semantics
…document it here. Config changes need a migration in src/config/loader.ts.
-->

- [ ] No plugin API change
- [ ] No config schema change
- [ ] Plugin API changed — documented above
- [ ] Config schema changed — migration added

## Commit message scope

<!-- Conventional-commits scope used. Must be one of: config, graph, check, fix, lock, parsers, plugins, cli, ci, deps, init, hooks, commit, dev, rename, assets -->
