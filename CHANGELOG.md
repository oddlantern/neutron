# Changelog

## [0.1.5](https://github.com/oddlantern/neutron/compare/v0.1.4...v0.1.5) (2026-04-17)


### Documentation

* rewrite CLAUDE.md as principles, drop file-tree enumeration ([9d3e89a](https://github.com/oddlantern/neutron/commit/9d3e89a2a15ad39842f5621208286f0ad7861440))

## [0.1.4](https://github.com/oddlantern/neutron/compare/v0.1.3...v0.1.4) (2026-04-17)

### Features

- **plugins:** axum + utoipa framework adapter for Rust OpenAPI export ([1205037](https://github.com/oddlantern/neutron/commit/1205037a451f2a695987a24f17171a01d7ac9cbc))
- **plugins:** rust design token codegen ([1565383](https://github.com/oddlantern/neutron/commit/15653832a00915ae1cf32f25d2a94c37829331a2))
- **plugins:** rust OpenAPI models codegen — types only by convention ([54b3d79](https://github.com/oddlantern/neutron/commit/54b3d79490979495a388e59c8415c936b4f20aa1))

## [0.1.3](https://github.com/oddlantern/neutron/compare/v0.1.2...v0.1.3) (2026-04-17)

### Bug Fixes

- **ci:** upgrade npm for OIDC trusted-publisher auth ([e6dea8e](https://github.com/oddlantern/neutron/commit/e6dea8eb2e09e1c5bde4aea5c317320e135c86f7))

## [0.1.2](https://github.com/oddlantern/neutron/compare/v0.1.1...v0.1.2) (2026-04-17)

### Bug Fixes

- **ci:** skip npm lifecycle scripts on publish — CI already ran them ([93901e6](https://github.com/oddlantern/neutron/commit/93901e6aadf85561b5a465631b92f8ea13e4e100))

## [0.1.1](https://github.com/oddlantern/neutron/compare/v0.1.0...v0.1.1) (2026-04-17)

### Features

- **cli:** surface experimental plugins in doctor + init ([b2c50dd](https://github.com/oddlantern/neutron/commit/b2c50dd9e8d336ec2291584de56f4a96124be77c))
- **plugins:** add experimental flag; wire python tool resolution chain ([d025893](https://github.com/oddlantern/neutron/commit/d0258939b21b605efb591b950028def909a8c469))
- **plugins:** FastAPI adapter for Python OpenAPI export ([c265514](https://github.com/oddlantern/neutron/commit/c265514b50dd6bbb1221f2fcb333aef72a12afad))
- **plugins:** python design token codegen ([6a46342](https://github.com/oddlantern/neutron/commit/6a463423b8f23b8d251d4523c4e1dfe49eb38f40))
- **plugins:** python OpenAPI client codegen via openapi-python-client ([fa78d1b](https://github.com/oddlantern/neutron/commit/fa78d1b0a3d477dce4afc7917db62b0a55a0b038))

## 0.1.0 (2026-04-17)

### Features

- **check:** add --fix flow with mido.lock and interactive version resolution ([1277919](https://github.com/oddlantern/neutron/commit/12779196c5cc17cb00bcd8cdb35397879859f3ec))
- **cli:** add --dry-run support across generate, rename, install, upgrade (v1.3.0) ([a743788](https://github.com/oddlantern/neutron/commit/a7437881f83c9e08494cf4d243adb39d70f52e60))
- **cli:** add init, install, commit-msg commands and bridge rename ([f4b7b67](https://github.com/oddlantern/neutron/commit/f4b7b673d6236dbed14affe76de1276c79afca89))
- **cli:** add lint, fmt, build, and pre-commit commands ([ef715bd](https://github.com/oddlantern/neutron/commit/ef715bd1545796bf67bf30c79e2902205154e4f6))
- **cli:** replace readline with @clack/prompts, add init reconciliation and banner ([f99d1d3](https://github.com/oddlantern/neutron/commit/f99d1d31ad51416be53b192efab39cd05d201503))
- **config:** absorb oxlint and oxfmt configuration into mido.yml ([0789324](https://github.com/oddlantern/neutron/commit/0789324748efb1cd396265523e7c8f35ffc050a5))
- **config:** add lint/format config schemas for Python, Rust, Go, PHP ([be3be00](https://github.com/oddlantern/neutron/commit/be3be0006b3dcd8da17d6b9ff5a5673952e76a49))
- **config:** auto-migration pipeline for config schema changes ([432a237](https://github.com/oddlantern/neutron/commit/432a237d90e48f6c7b91e4899e6b8a1377e7b924))
- **config:** ecosystem-centric lint/format config + JSON schema ([744f8ed](https://github.com/oddlantern/neutron/commit/744f8edef7fc2b543a5fbf6070e890719bc74523))
- configurable hooks, deprecation lifecycle, HSL colors (v0.5.0) ([8b00291](https://github.com/oddlantern/neutron/commit/8b00291aac8e4c2bbd34ecb71eadf01b241f5a1b))
- **design:** rewrite token schema from NextSaga spec ([f54f9b9](https://github.com/oddlantern/neutron/commit/f54f9b97aa04c7d76b62627435c6eddb950c5c6f))
- **dev:** reload config on mido.yml change, prompt for watch paths in init ([4fc0823](https://github.com/oddlantern/neutron/commit/4fc0823336ddd6051955809ed1454b4f4dba4773))
- generate byKey lookup on theme extensions, non-nullable return (v1.0.1) ([ec3e96d](https://github.com/oddlantern/neutron/commit/ec3e96db330d0146697892d512c133b4fcf5386f))
- **init:** add commented YAML output, JSON schema, and tab-completing artifact prompt ([ddcceb7](https://github.com/oddlantern/neutron/commit/ddcceb77c39258e2a0ba34b0dd8f81b70e453378))
- **init:** add manual bridge prompt and Husky/commitlint cleanup ([83d8983](https://github.com/oddlantern/neutron/commit/83d89832c9c4a5549f098228f874e6652abc5589))
- initial mido PoC — cross-ecosystem workspace checker ([90e1fb0](https://github.com/oddlantern/neutron/commit/90e1fb0cc0dd2426b028971677118df41c13b6f1))
- **init:** replace watch path text input with select menu and file browser ([62ce6cd](https://github.com/oddlantern/neutron/commit/62ce6cd1dc666ebde18541f7b6aeb49467510556))
- **init:** show plugin watch suggestion in modify flow, preserve current paths ([499acf8](https://github.com/oddlantern/neutron/commit/499acf8bb9f58aaef0325a6140d157cb1aa1ba5a))
- mido generate, outputDir convention, build skips apps (v0.6.0) ([3732526](https://github.com/oddlantern/neutron/commit/373252628e43922fb1f59a7d05b1fa1265157e8f))
- mido.lock V2 with integrity hashing, V1 migration, and 80% test coverage ([30e589a](https://github.com/oddlantern/neutron/commit/30e589a6a0b9886e8f4760eea246801fa8961d98))
- **plugins,rename,assets:** reorganize plugin architecture, add assets domain, rename command (v1.2.0) ([1fa1057](https://github.com/oddlantern/neutron/commit/1fa1057ed754cd1b2aad52398f1a39b633d804ad))
- **plugins:** add mido-design domain plugin for design token generation ([5afa6ed](https://github.com/oddlantern/neutron/commit/5afa6eda1816dc70af5f074a2613972bd1a6ad71))
- **plugins:** add pipeline steps, watch path suggestions, and styled init outro ([be97007](https://github.com/oddlantern/neutron/commit/be97007ac03f28632ef7706defb00a33f6136e73))
- **plugins:** add plugin architecture and mido dev watcher ([f8f3bc4](https://github.com/oddlantern/neutron/commit/f8f3bc47c0dd007816d5eb9b85a7e81d8c70cd16))
- **plugins:** add Python, Rust, Go, PHP ecosystems + schema domain + format-aware design bridges ([fa4a461](https://github.com/oddlantern/neutron/commit/fa4a461462d0d9e39ecbce1ccf48d30b9431689f))
- **plugins:** built-in OpenAPI spec normalizer, bridge exclude config (v1.5.0) ([bcf221f](https://github.com/oddlantern/neutron/commit/bcf221f871c63b78a3829e3cba9350158cbe55b7))
- **plugins:** bundle oxlint and oxfmt as direct dependencies ([229814b](https://github.com/oddlantern/neutron/commit/229814bade740fe3e8e74dec7c5d033e021c7a39))
- **plugins:** centralize file resolution for lint and format ([51dce68](https://github.com/oddlantern/neutron/commit/51dce68b101dc9c943c8fcbfffc2cc08b2a85759))
- **plugins:** framework adapters for zero-config OpenAPI spec export ([0967b98](https://github.com/oddlantern/neutron/commit/0967b982171428d61496d62ac3b21ad8f250ad97))
- **plugins:** generate full M3 widget theme from design tokens (v1.4.0) ([7fcb95d](https://github.com/oddlantern/neutron/commit/7fcb95dfbc1ad8c2cc781684b080a6462adba9f2))
- **plugins:** verbose export diagnostics and --verbose flag for mido dev ([8760134](https://github.com/oddlantern/neutron/commit/87601342f34a9adb6553235d5941ee4fc77341c3))
- progressive outdated analysis, upgrade command, diagnostic system (v1.1.0) ([3ada237](https://github.com/oddlantern/neutron/commit/3ada237fe3ae720630b0893f0ee7feab8bf2806a))
- pure ecosystem matching, no consumer I/O, scanner excludes generated/ (v1.0.0) ([5bb1845](https://github.com/oddlantern/neutron/commit/5bb184515ffc81b8afad594b80fb10d1fd21dd3b))
- source-based naming, openapi outputDir, 7 UX fixes, 27 new tests (v0.8.0) ([be53c34](https://github.com/oddlantern/neutron/commit/be53c3458c94e733ac7429a17b80f348b46d924b))
- test, ci, affected, graph, outdated, add, why, doctor, pipeline cache, full tool migration (v0.7.0) ([13b8785](https://github.com/oddlantern/neutron/commit/13b8785d86548d8840df39dd250d8a658de335a0))

### Bug Fixes

- always auto-migrate old config formats, graceful recovery on broken mido.yml (v0.7.1) ([dd20631](https://github.com/oddlantern/neutron/commit/dd206312a933157e4fb6b86f19b1fefd03fdfb4b))
- **config:** complete lint/format config migration in mido init ([234f261](https://github.com/oddlantern/neutron/commit/234f261ab0cc21e3d02299acef1becbf6f02f43d))
- **config:** use z.unknown() for lint rule values ([50ce154](https://github.com/oddlantern/neutron/commit/50ce154e39c73f6197fea6ef3af1c40562fb24b4))
- correct from/to/via migration semantics, remove oxlint/oxfmt/husky/commitlint deps during cleanup (v0.7.2) ([6ef3126](https://github.com/oddlantern/neutron/commit/6ef31267da5a1aaf8049243f65aaccb0d8ae82da))
- **dev:** fix chokidar not detecting file changes, add --verbose flag and tests ([ea493c1](https://github.com/oddlantern/neutron/commit/ea493c1ce77623dbe21acc8652ea434da4649c34))
- ecosystem plugins accept openapi domain without consumer deps (v0.9.2) ([abe1ccb](https://github.com/oddlantern/neutron/commit/abe1ccb7ca0eed4e9ac7b6b530361bec12d96a39))
- filter generated/node_modules/dart_tool paths in watcher event handler (v0.7.6) ([4c2c504](https://github.com/oddlantern/neutron/commit/4c2c50457e37c56b9ef1bfd363f65563cfb9087f))
- ignore generated/ directories in watcher to prevent infinite loop (v0.7.3) ([c996119](https://github.com/oddlantern/neutron/commit/c996119404c4a09b98e50cd7ada0985f6d33bd6b))
- **init:** expand ignored dirs and skip workspace root in scanner ([f62236a](https://github.com/oddlantern/neutron/commit/f62236aeea87f2d660f8317ca69a5492d153828b))
- **init:** improve bridge prompt readability in reconciliation mode ([ce710f8](https://github.com/oddlantern/neutron/commit/ce710f82755b6dec093c9b040edc26e9da68f60b))
- **init:** improve bridge prompt validation, dedup, and help text ([ede7485](https://github.com/oddlantern/neutron/commit/ede7485680d9761075f2216edae90fbe0a833243))
- **init:** load plugins in reconciliation mode for watch path suggestions ([64d8906](https://github.com/oddlantern/neutron/commit/64d89066500bb013e244275970789600fa977d6a))
- **init:** pre-select plugin suggestion and browse from workspace root ([308b926](https://github.com/oddlantern/neutron/commit/308b926ca55797b7bbbe8c2f8adb41fb609abfcb))
- **init:** show current values in bridge modify prompts ([dbbb42e](https://github.com/oddlantern/neutron/commit/dbbb42e29de9b6b82764acc706b64fc4853c3efb))
- **lock:** enrich V1-migrated ecosystems from workspace graph ([3327467](https://github.com/oddlantern/neutron/commit/33274675f1da2669d4bfb6407860cded5c973653))
- **openapi:** re-export spec on --force even when artifact exists ([8a70ecb](https://github.com/oddlantern/neutron/commit/8a70ecb26011af0932c395ed384a1147c0833830))
- **plugins:** always regenerate dart pubspec on token changes ([d580fe2](https://github.com/oddlantern/neutron/commit/d580fe2a03f96790eda61d2375d330eede2a104e))
- **plugins:** don't fail export when server exits after serving spec ([c823d0a](https://github.com/oddlantern/neutron/commit/c823d0a3c99f1155bec961516e5cc07a10284fbf))
- **plugins:** exclude generated/ and hidden dirs from asset scanner ([e82fc09](https://github.com/oddlantern/neutron/commit/e82fc09dd150b3aba5a075c60c3e1bd6a9ac7fe1))
- **plugins:** fall through to export scripts when adapter returns 404 ([09af9e1](https://github.com/oddlantern/neutron/commit/09af9e1944dd90473d71506ae006e36d3a7c18ba))
- **plugins:** fix 4 reviewer findings in asset codegen ([ef85de9](https://github.com/oddlantern/neutron/commit/ef85de9515da93592663411629b17d25ccc5b27c))
- **plugins:** fix byKey path interpolation and themed entry deduplication ([09cc8b1](https://github.com/oddlantern/neutron/commit/09cc8b1720bfe81d2480c9827c7d8036f581e151))
- **plugins:** fix ColorToHex Dart string interpolation ([df8e955](https://github.com/oddlantern/neutron/commit/df8e95521cc4d390986a5d7cd52b44958411269a))
- **plugins:** handle path separators in asset class names, improve prefix derivation ([b859497](https://github.com/oddlantern/neutron/commit/b8594976973f28fd4fe36c30ef5c5dc3d1f65a1f))
- **plugins:** normalize hyphens to underscores in asset scanner ([4f15d47](https://github.com/oddlantern/neutron/commit/4f15d478e8a214df4d920f37a3311f1e61ffb00a))
- **plugins:** run dart pub get after generating dart packages ([1cc6271](https://github.com/oddlantern/neutron/commit/1cc6271d5ab57c7c6bb2db2bba921558e2e991c3))
- **plugins:** widen google_fonts constraint to &gt;=6.0.0 ([e333cc8](https://github.com/oddlantern/neutron/commit/e333cc8dd9951459c0273c5538dde34330efb4ca))
- **schema:** enable VS Code autocomplete for oxlint rules and format options ([3c51e40](https://github.com/oddlantern/neutron/commit/3c51e40fe4c106ab77aeda71dd761be2f4cfe1ef))
- skip server boot when spec exists, validate cache against output dirs, prepare is generate-only (v0.9.1) ([7813d06](https://github.com/oddlantern/neutron/commit/7813d06ed1a1400366a0e3070f7bf2451cac0a7a))
- update bridge schema to use consumers instead of target (v0.7.4) ([b32484a](https://github.com/oddlantern/neutron/commit/b32484a34d24f791e83212f77382e4a9b506b6b0))

### Refactoring

- address all review findings from v0.0.32 ([07e38ee](https://github.com/oddlantern/neutron/commit/07e38ee951629cd795425f6f77139cc115a2ec3c))
- address analysis findings — eliminate as casts, centralize ANSI, add 90 tests ([3f9dc04](https://github.com/oddlantern/neutron/commit/3f9dc042bd812d267a705413eb695dbea711d5c4))
- **cli:** eradicate legacy mido references; clear lint; format ([064c0d8](https://github.com/oddlantern/neutron/commit/064c0d82e71f8d6d145a345e49a7ea3527b3a1b2))
- **cli:** read version from package.json at runtime ([9197aeb](https://github.com/oddlantern/neutron/commit/9197aeb46cfc7faf7c99ff37fb0cdbc11b1b088c))
- derive JSON schema from Zod, no more hardcoded bridge/config shapes (v0.7.5) ([e9885b6](https://github.com/oddlantern/neutron/commit/e9885b6ab065352a53c4a6ca14f6c0235b2b17f0))
- extract bridge-runner, server-boot, token-theme modules ([3af5a71](https://github.com/oddlantern/neutron/commit/3af5a71808d03bb1797c3232dac3712bd870a004))
- extract hooks module, eliminate as casts, add 61 tests (v0.5.1) ([873ecb0](https://github.com/oddlantern/neutron/commit/873ecb02380f41584c2d497ed08e0f91f9992a96))
- fix all 19 analysis findings, extract bridges/, 39 new tests (v0.9.0) ([36d018b](https://github.com/oddlantern/neutron/commit/36d018baa0b6d3f4fa199ec7e90ba451f5e28842))
- split god files into commands/utils/ and typescript/lint-config (v0.5.2) ([3315df4](https://github.com/oddlantern/neutron/commit/3315df4095de64bd0f7b58f4a1bb1defddd8ea0e))

### Documentation

- **config:** fix lint/format section comments ([9836032](https://github.com/oddlantern/neutron/commit/98360329a3b86196b0bb77e13388da7e7707f2f5))

### Build

- **deps:** add @types/node; stop tracking generated dist/ ([f3470f4](https://github.com/oddlantern/neutron/commit/f3470f4b77ef2c21bf21c90aaaa7b951dd5c20f3))
