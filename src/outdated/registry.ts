import { parseNpmVersion, parsePubDevPackage } from "@/outdated/schemas";
import type { RegistryMetadata } from "@/outdated/types";

const NPM_REGISTRY = "https://registry.npmjs.org";
const PUB_DEV_API = "https://pub.dev/api/packages";
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
 * Fetch enriched metadata for a dependency based on its ecosystem.
 */
export async function fetchMetadata(
  name: string,
  ecosystem: string,
): Promise<RegistryMetadata | null> {
  if (ecosystem === "dart") {
    return fetchPubMetadata(name);
  }
  return fetchNpmMetadata(name);
}
