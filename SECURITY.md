# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.x     | ✅ (latest patch) |

Pre-1.0, only the latest minor receives security fixes. When 1.0 ships, this table will grow.

## Reporting a vulnerability

**Do not open a public GitHub issue for security bugs.**

Email `forfalsket@proton.me` with:

- A description of the issue and what you observed
- Steps to reproduce
- Affected versions (if known)
- Any proposed fix or mitigation

You'll get an acknowledgement within 72 hours. We aim to publish a fix within 14 days for critical issues, 30 days for lower-severity ones. Disclosure happens coordinated with the fix release.

## Scope

This tool runs on developer machines and CI. Classes of issue we care about:

- **Arbitrary code execution via config** — e.g., a crafted `neutron.yml` that causes shell injection via bridge commands, hook scripts, or framework adapter detection.
- **Arbitrary code execution via registry queries** — e.g., a crafted npm/pub.dev response that triggers unsafe behavior during `neutron outdated`.
- **Path traversal** — e.g., bridge `artifact` paths that escape the workspace root, generated-output writes outside the declared output directory.
- **External plugin loading** — loading `neutron-plugin-*` from `node_modules` is inherent trust of installed packages; we don't sandbox, but we validate plugin shape before registering them. Issues where malformed plugins can corrupt neutron's own state beyond skipping themselves are in scope.

Out of scope:

- Vulnerabilities in neutron's npm dependencies (report those upstream to each package).
- DoS via malformed user input where a clear error is produced.
- Issues that require an attacker to already have write access to `neutron.yml` or `.git/hooks/`.
