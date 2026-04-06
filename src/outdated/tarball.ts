import { gunzipSync } from "node:zlib";

const HEADER_SIZE = 512;
const FETCH_TIMEOUT_MS = 15000;

/** Maximum tarball download size: 50 MB. */
const MAX_TARBALL_BYTES = 50 * 1024 * 1024;

/** Maximum decompressed tar size: 200 MB. */
const MAX_DECOMPRESSED_BYTES = 200 * 1024 * 1024;

/** Allowed tarball URL origins. */
const ALLOWED_ORIGINS: readonly string[] = [
  "https://registry.npmjs.org",
  "https://pub.dev",
  "https://files.pythonhosted.org",
  "https://crates.io",
  "https://static.crates.io",
  "https://proxy.golang.org",
  "https://api.github.com",
  "https://repo.packagist.org",
];

/** Tar header field layout (POSIX ustar) */
const NAME_FIELD_LENGTH = 100;
const SIZE_FIELD_OFFSET = 124;
const SIZE_FIELD_END = 135;

/**
 * Parse the file size from a tar header's octal size field.
 */
function parseOctalSize(header: Buffer, offset: number): number {
  const raw = header.subarray(offset + SIZE_FIELD_OFFSET, offset + SIZE_FIELD_END).toString("ascii").trim();
  return parseInt(raw, 8) || 0;
}

/**
 * Parse the file name from a tar header.
 * Strips the common npm tarball prefix (e.g., "package/").
 * Rejects names with path traversal patterns.
 */
function parseName(header: Buffer, offset: number): string {
  let end = offset;
  while (end < offset + NAME_FIELD_LENGTH && header[end] !== 0) {
    end++;
  }
  const raw = header.subarray(offset, end).toString("ascii").trim();

  // Strip npm tarball prefix
  const name = raw.replace(/^package\//, "");

  // Reject path traversal and absolute paths
  if (name.includes("..") || name.startsWith("/") || name.includes("\\")) {
    return "";
  }

  return name;
}

/**
 * Check if a tar header block is a zero-filled end-of-archive marker.
 */
function isEndOfArchive(buffer: Buffer, offset: number): boolean {
  for (let i = offset; i < offset + HEADER_SIZE && i < buffer.length; i++) {
    if (buffer[i] !== 0) {
      return false;
    }
  }
  return true;
}

/**
 * Validate that a URL points to an allowed registry origin.
 */
function isAllowedOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    const origin = `${parsed.protocol}//${parsed.hostname}`;
    return ALLOWED_ORIGINS.some((allowed) => origin.startsWith(allowed));
  } catch {
    return false;
  }
}

/**
 * Extract files from a gzipped tar buffer.
 * Only extracts entries where the filter returns true.
 * Returns a map of normalized file path → file content (UTF-8).
 *
 * Uses Node built-in zlib (no external tar dependency).
 * Rejects decompressed data exceeding MAX_DECOMPRESSED_BYTES.
 */
export function extractFromTarGz(
  gzipped: Buffer,
  filter: (entryPath: string) => boolean,
): ReadonlyMap<string, string> {
  const tar = gunzipSync(gzipped);

  if (tar.length > MAX_DECOMPRESSED_BYTES) {
    return new Map();
  }

  const result = new Map<string, string>();
  let offset = 0;

  while (offset + HEADER_SIZE <= tar.length) {
    if (isEndOfArchive(tar, offset)) {
      break;
    }

    const name = parseName(tar, offset);
    const size = parseOctalSize(tar, offset);

    // Move past the header
    offset += HEADER_SIZE;

    if (size > 0 && name.length > 0 && filter(name)) {
      const content = tar.subarray(offset, offset + size).toString("utf-8");
      result.set(name, content);
    }

    // Advance past the file content (padded to 512-byte blocks)
    offset += Math.ceil(size / HEADER_SIZE) * HEADER_SIZE;
  }

  return result;
}

/**
 * Download a tarball from a URL and return the raw buffer.
 * Validates URL origin against known registries and enforces size limits.
 */
export async function downloadTarball(url: string): Promise<Buffer | null> {
  if (!isAllowedOrigin(url)) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, { signal: controller.signal });

      if (!res.ok) {
        return null;
      }

      // Check Content-Length if available
      const contentLength = res.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_TARBALL_BYTES) {
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();

      if (arrayBuffer.byteLength > MAX_TARBALL_BYTES) {
        return null;
      }

      return Buffer.from(arrayBuffer);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}
