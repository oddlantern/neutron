import { USER_AGENT } from "@/branding";
import {
  parseCratesIo,
  parseGoProxy,
  parseNpmVersion,
  parsePackagist,
  parsePubDevPackage,
  parsePyPiPackage,
} from "@/outdated/schemas";
import type { RegistryMetadata } from "@/outdated/types";

const NPM_REGISTRY = "https://registry.npmjs.org";
const PUB_DEV_API = "https://pub.dev/api/packages";
const PYPI_API = "https://pypi.org/pypi";
const CRATES_IO_API = "https://crates.io/api/v1/crates";
const GO_PROXY = "https://proxy.golang.org";
const PACKAGIST_API = "https://repo.packagist.org/p2";
const FETCH_TIMEOUT_MS = 5000;

/**
 * Derive a changelog URL from a repository URL.
 * Supports GitHub, GitLab, and Bitbucket conventions.
 */
function deriveChangelogUrl(repoUrl: string | undefined): string | undefined {
  if (!repoUrl) {
    return undefined;
  }
  // Normalize git+https, git+ssh, and .git suffix
  const cleaned = repoUrl
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@github\.com/, "https://github.com")
    .replace(/\.git$/, "");

  try {
    const url = new URL(cleaned);
    if (url.hostname === "github.com") {
      return `${url.origin}${url.pathname}/releases`;
    }
    if (url.hostname === "gitlab.com") {
      return `${url.origin}${url.pathname}/-/releases`;
    }
  } catch {
    // Invalid URL — fall through
  }
  return undefined;
}

/**
 * Extract the repository URL string from an npm version response.
 */
function extractRepoUrl(parsed: { repository?: string | { type?: string | undefined; url: string } | undefined }): string | undefined {
  const repo = parsed.repository;
  if (!repo) {
    return undefined;
  }
  if (typeof repo === "string") {
    return repo;
  }
  return repo.url;
}

/**
 * Fetch enriched metadata from the npm registry.
 * First fetches /latest to get the version, then /{name}/{version} for full metadata.
 */
export async function fetchNpmMetadata(name: string): Promise<RegistryMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    // Fetch the latest version document (includes peerDeps, deprecated, repository, dist)
    const res = await fetch(`${NPM_REGISTRY}/${name}/latest`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return null;
    }

    const data: unknown = await res.json();
    const parsed = parseNpmVersion(data);
    if (!parsed) {
      return null;
    }

    const repoUrl = extractRepoUrl(parsed);

    return {
      latest: parsed.version,
      deprecated: parsed.deprecated,
      peerDependencies: parsed.peerDependencies,
      repositoryUrl: repoUrl,
      tarballUrl: parsed.dist?.tarball,
      changelogUrl: deriveChangelogUrl(repoUrl),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch enriched metadata from pub.dev.
 */
export async function fetchPubMetadata(name: string): Promise<RegistryMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${PUB_DEV_API}/${name}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return null;
    }

    const data: unknown = await res.json();
    const parsed = parsePubDevPackage(data);
    if (!parsed) {
      return null;
    }

    return {
      latest: parsed.latest.version,
      deprecated: undefined, // pub.dev doesn't have a deprecation field in the API
      peerDependencies: undefined, // Dart doesn't have peer deps
      repositoryUrl: undefined, // Would require fetching the pubspec separately
      tarballUrl: `https://pub.dev/api/archives/${name}-${parsed.latest.version}.tar.gz`,
      changelogUrl: `https://pub.dev/packages/${name}/changelog`,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch enriched metadata from PyPI.
 */
export async function fetchPyPiMetadata(name: string): Promise<RegistryMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${PYPI_API}/${name}/json`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return null;
    }

    const data: unknown = await res.json();
    const parsed = parsePyPiPackage(data);
    if (!parsed) {
      return null;
    }

    const sdist = parsed.urls?.find((u) => u.packagetype === "sdist");
    const repoUrl = parsed.info.home_page ?? parsed.info.project_url ?? undefined;

    return {
      latest: parsed.info.version,
      deprecated: undefined,
      peerDependencies: undefined,
      repositoryUrl: repoUrl ?? undefined,
      tarballUrl: sdist?.url,
      changelogUrl: deriveChangelogUrl(repoUrl ?? undefined),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch enriched metadata from crates.io.
 */
export async function fetchCratesMetadata(name: string): Promise<RegistryMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${CRATES_IO_API}/${name}`, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return null;
    }

    const data: unknown = await res.json();
    const parsed = parseCratesIo(data);
    if (!parsed) {
      return null;
    }

    const latestVersion = parsed.versions?.find((v) => v.num === parsed.crate.max_version);
    const repoUrl = parsed.crate.repository ?? undefined;

    return {
      latest: parsed.crate.max_version,
      deprecated: latestVersion?.yanked ? "yanked" : undefined,
      peerDependencies: undefined,
      repositoryUrl: repoUrl,
      tarballUrl: latestVersion?.dl_path
        ? `https://crates.io${latestVersion.dl_path}`
        : undefined,
      changelogUrl: deriveChangelogUrl(repoUrl),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch enriched metadata from the Go module proxy.
 */
export async function fetchGoMetadata(modulePath: string): Promise<RegistryMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${GO_PROXY}/${modulePath}/@latest`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return null;
    }

    const data: unknown = await res.json();
    const parsed = parseGoProxy(data);
    if (!parsed) {
      return null;
    }

    return {
      latest: parsed.Version,
      deprecated: undefined,
      peerDependencies: undefined,
      repositoryUrl: modulePath.startsWith("github.com") ? `https://${modulePath}` : undefined,
      tarballUrl: `${GO_PROXY}/${modulePath}/@v/${parsed.Version}.zip`,
      changelogUrl: modulePath.startsWith("github.com")
        ? `https://${modulePath}/releases`
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch enriched metadata from Packagist (PHP).
 */
export async function fetchPackagistMetadata(name: string): Promise<RegistryMetadata | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const res = await fetch(`${PACKAGIST_API}/${name}.json`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return null;
    }

    const data: unknown = await res.json();
    const parsed = parsePackagist(data);
    if (!parsed) {
      return null;
    }

    const versions = parsed.packages[name];
    if (!versions || versions.length === 0) {
      return null;
    }

    // Packagist returns versions newest-first
    const latest = versions[0]!;
    const repoUrl = latest.source?.url;

    return {
      latest: latest.version,
      deprecated: undefined,
      peerDependencies: undefined,
      repositoryUrl: repoUrl,
      tarballUrl: latest.dist?.url,
      changelogUrl: deriveChangelogUrl(repoUrl),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch enriched metadata for a dependency based on its ecosystem.
 */
export async function fetchMetadata(
  name: string,
  ecosystem: string,
): Promise<RegistryMetadata | null> {
  switch (ecosystem) {
    case "dart":
      return fetchPubMetadata(name);
    case "python":
      return fetchPyPiMetadata(name);
    case "rust":
      return fetchCratesMetadata(name);
    case "go":
      return fetchGoMetadata(name);
    case "php":
      return fetchPackagistMetadata(name);
    default:
      return fetchNpmMetadata(name);
  }
}
