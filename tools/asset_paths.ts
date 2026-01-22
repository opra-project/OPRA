/**
 * tools/asset_paths.ts - Asset path computation utilities
 *
 * Pure functions for computing content-addressed asset paths.
 * Extracted for testability and reuse.
 */

import { join, extname } from "https://deno.land/std@0.203.0/path/mod.ts";

/**
 * Computes the full filesystem path for a content-addressed asset.
 *
 * @param distDir - The distribution directory (e.g., "dist")
 * @param hash - The SHA256 hash of the file content
 * @param originalFilePath - Original file path (used for extension)
 * @returns Full path like "dist/assets/ab/cd/abcd1234...ext"
 */
export function getAssetPath(
  distDir: string,
  hash: string,
  originalFilePath: string
): string {
  const ext = extname(originalFilePath);
  const filename = `${hash}${ext}`;
  return join(
    distDir,
    "assets",
    hash.substring(0, 2),
    hash.substring(2, 4),
    filename
  );
}

/**
 * Computes the relative asset path for use in JSON references.
 *
 * @param hash - The SHA256 hash of the file content
 * @param originalFilePath - Original file path (used for extension)
 * @returns Relative path like "assets/ab/cd/abcd1234...ext"
 */
export function getRelativeAssetPath(
  hash: string,
  originalFilePath: string
): string {
  const ext = extname(originalFilePath);
  const filename = `${hash}${ext}`;
  return join(
    "assets",
    hash.substring(0, 2),
    hash.substring(2, 4),
    filename
  );
}

/**
 * Asset cache that properly stores and returns relative paths.
 *
 * This class ensures consistency between what's stored and returned,
 * preventing bugs where the cache returns a different format than
 * the initial computation.
 */
export class AssetPathCache {
  private cache = new Map<string, string>();

  /**
   * Get a cached relative path, or compute and cache it.
   *
   * @param filePath - The original file path (cache key)
   * @param hash - The content hash
   * @returns The relative asset path (always starts with "assets/")
   */
  getOrCompute(filePath: string, hash: string): string {
    if (this.cache.has(filePath)) {
      return this.cache.get(filePath)!;
    }

    const relativePath = getRelativeAssetPath(hash, filePath);
    this.cache.set(filePath, relativePath);
    return relativePath;
  }

  /**
   * Check if a file path is already cached.
   */
  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  /**
   * Get the cached path for a file (returns undefined if not cached).
   */
  get(filePath: string): string | undefined {
    return this.cache.get(filePath);
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this.cache.clear();
  }
}
