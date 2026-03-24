import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import type { DiscoveredPackage } from './scanner.js';

export interface BridgeCandidate {
  readonly source: string;
  readonly target: string;
  readonly artifact: string;
  readonly reason: string;
}

export interface EnvCandidate {
  readonly path: string;
}

const ARTIFACT_FILENAMES = ['openapi.json', 'openapi.yaml', 'swagger.json', 'tokens.json'];

/**
 * Classify a package path as "app" or "lib" based on directory conventions.
 * Returns null if the path doesn't match known patterns.
 */
export function classifyPackage(pkgPath: string): 'app' | 'lib' | null {
  if (pkgPath.startsWith('apps/') || pkgPath.startsWith('app/')) {
    return 'app';
  }
  if (pkgPath.startsWith('packages/') || pkgPath.startsWith('libs/') || pkgPath.startsWith('lib/')) {
    return 'lib';
  }
  return null;
}

/**
 * Detect potential bridge candidates between packages of different ecosystems.
 */
export async function detectBridges(
  root: string,
  packages: readonly DiscoveredPackage[],
): Promise<readonly BridgeCandidate[]> {
  const candidates: BridgeCandidate[] = [];
  const packagesByPath = new Map(packages.map((p) => [p.path, p]));

  // Strategy 1: Look for known artifact files in package directories
  for (const pkg of packages) {
    const pkgDir = resolve(root, pkg.path);

    for (const artifactName of ARTIFACT_FILENAMES) {
      const artifactPath = join(pkgDir, artifactName);
      if (!existsSync(artifactPath)) {
        continue;
      }

      const artifactRel = relative(root, artifactPath);

      // Find packages in other ecosystems that might consume this artifact
      for (const other of packages) {
        if (other.path === pkg.path || other.ecosystem === pkg.ecosystem) {
          continue;
        }

        // Check if the other package is a plausible consumer
        // (e.g., a Dart client inside or near a TS package)
        if (isPlausibleConsumer(pkg.path, other.path)) {
          candidates.push({
            source: pkg.path,
            target: other.path,
            artifact: artifactRel,
            reason: `Found ${artifactName} in ${pkg.path}`,
          });
        }
      }
    }
  }

  // Strategy 2: Detect Dart path dependencies pointing to TS packages
  for (const pkg of packages) {
    if (pkg.ecosystem !== 'dart') {
      continue;
    }

    const pubspecPath = join(root, pkg.path, 'pubspec.yaml');
    try {
      const raw = await readFile(pubspecPath, 'utf-8');

      // Simple regex for path dependencies
      const pathDepPattern = /path:\s+(.+)/g;
      let match;
      while ((match = pathDepPattern.exec(raw)) !== null) {
        const depPath = match[1]?.trim();
        if (!depPath) {
          continue;
        }

        const resolvedPath = resolve(root, pkg.path, depPath);
        const relPath = relative(root, resolvedPath);

        const targetPkg = packagesByPath.get(relPath);
        if (targetPkg && targetPkg.ecosystem !== 'dart') {
          // Dart package has a path dep to a non-Dart package — bridge candidate
          candidates.push({
            source: targetPkg.path,
            target: pkg.path,
            artifact: `${targetPkg.path}/openapi.json`,
            reason: `Dart path dependency from ${pkg.path} to ${targetPkg.path}`,
          });
        }
      }
    } catch {
      // Skip unreadable pubspecs
    }
  }

  // Deduplicate by source+target
  const seen = new Set<string>();
  const unique: BridgeCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.source}:${candidate.target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(candidate);
  }

  return unique;
}

/**
 * Check if a consumer path is plausibly related to a producer path.
 * E.g., packages/api/clients/dart is a plausible consumer of packages/api.
 */
function isPlausibleConsumer(producerPath: string, consumerPath: string): boolean {
  // Consumer is a subdirectory of producer
  if (consumerPath.startsWith(producerPath + '/')) {
    return true;
  }

  // Both share a common ancestor directory
  const producerParent = dirname(producerPath);
  const consumerParent = dirname(consumerPath);
  if (producerParent === consumerParent) {
    return true;
  }

  return false;
}

/**
 * Find .env.example and .env.template files across the repo.
 */
export function detectEnvFiles(root: string, packages: readonly DiscoveredPackage[]): readonly EnvCandidate[] {
  const candidates: EnvCandidate[] = [];
  const envNames = ['.env.example', '.env.template'];

  for (const pkg of packages) {
    const pkgDir = resolve(root, pkg.path);

    for (const envName of envNames) {
      const envPath = join(pkgDir, envName);
      if (existsSync(envPath)) {
        candidates.push({ path: relative(root, envPath) });
      }
    }
  }

  return candidates;
}
