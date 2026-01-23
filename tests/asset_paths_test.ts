/**
 * Unit tests for tools/asset_paths.ts
 *
 * Run with: deno test --allow-read tests/asset_paths_test.ts
 */

import { assertEquals } from "https://deno.land/std@0.203.0/assert/mod.ts";

import {
  getAssetPath,
  getRelativeAssetPath,
  AssetPathCache,
} from "../tools/asset_paths.ts";

// =============================================================================
// Test Fixtures
// =============================================================================

// SHA256 hashes are 64 hex characters
const TEST_HASH = "abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234";
const TEST_HASH_2 = "ef01234567890abcdef01234567890abcdef01234567890abcdef0123456789ab";

// =============================================================================
// getAssetPath Tests
// =============================================================================

Deno.test("getAssetPath - constructs correct content-addressed path", () => {
  const result = getAssetPath("dist", TEST_HASH, "image.png");

  // Expected: dist/assets/ab/cd/<hash>.png
  assertEquals(result, `dist/assets/ab/cd/${TEST_HASH}.png`);
});

Deno.test("getAssetPath - uses first 4 hash chars for subdirectories", () => {
  // Hash starts with "ef01" so should get ef/01 subdirs
  const result = getAssetPath("dist", TEST_HASH_2, "art.svg");

  assertEquals(result, `dist/assets/ef/01/${TEST_HASH_2}.svg`);
});

Deno.test("getAssetPath - preserves extension from original path", () => {
  assertEquals(getAssetPath("dist", TEST_HASH, "photo.png").endsWith(".png"), true);
  assertEquals(getAssetPath("dist", TEST_HASH, "art.svg").endsWith(".svg"), true);
  assertEquals(getAssetPath("dist", TEST_HASH, "deep/path/image.jpg").endsWith(".jpg"), true);
});

Deno.test("getAssetPath - respects custom dist directory", () => {
  const result = getAssetPath("output/build", TEST_HASH, "image.png");

  assertEquals(result.startsWith("output/build/assets/"), true);
});

// =============================================================================
// getRelativeAssetPath Tests
// =============================================================================

Deno.test("getRelativeAssetPath - constructs correct relative path", () => {
  const result = getRelativeAssetPath(TEST_HASH, "image.png");

  // Expected: assets/ab/cd/<hash>.png (no dist prefix)
  assertEquals(result, `assets/ab/cd/${TEST_HASH}.png`);
});

Deno.test("getRelativeAssetPath - never includes dist directory", () => {
  const result = getRelativeAssetPath(TEST_HASH, "image.png");

  assertEquals(result.includes("dist"), false);
  assertEquals(result.startsWith("assets/"), true);
});

Deno.test("getRelativeAssetPath - preserves extension from nested paths", () => {
  assertEquals(getRelativeAssetPath(TEST_HASH, "path/to/file.svg").endsWith(".svg"), true);
});

// =============================================================================
// AssetPathCache Tests - Core Behavior
// =============================================================================

Deno.test("AssetPathCache - getOrCompute returns consistent format on cache hit", () => {
  // This is the critical test for the bug we fixed:
  // Before fix: first call returned "assets/ab/cd/hash.png", cache hit returned just "hash"
  // After fix: both return "assets/ab/cd/hash.png"

  const cache = new AssetPathCache();
  const filePath = "original/path/image.png";

  const firstCall = cache.getOrCompute(filePath, TEST_HASH);
  const cachedCall = cache.getOrCompute(filePath, TEST_HASH);

  // Both must return the full relative path format
  assertEquals(firstCall, `assets/ab/cd/${TEST_HASH}.png`);
  assertEquals(cachedCall, `assets/ab/cd/${TEST_HASH}.png`);
  assertEquals(firstCall, cachedCall);
});

Deno.test("AssetPathCache - different files are cached independently", () => {
  const cache = new AssetPathCache();

  const path1 = cache.getOrCompute("file1.png", TEST_HASH);
  const path2 = cache.getOrCompute("file2.svg", TEST_HASH_2);

  assertEquals(path1, `assets/ab/cd/${TEST_HASH}.png`);
  assertEquals(path2, `assets/ef/01/${TEST_HASH_2}.svg`);
});

Deno.test("AssetPathCache - has/get work correctly", () => {
  const cache = new AssetPathCache();

  // Before caching
  assertEquals(cache.has("file.png"), false);
  assertEquals(cache.get("file.png"), undefined);

  // After caching
  const computed = cache.getOrCompute("file.png", TEST_HASH);
  assertEquals(cache.has("file.png"), true);
  assertEquals(cache.get("file.png"), computed);
});

Deno.test("AssetPathCache - clear removes all entries", () => {
  const cache = new AssetPathCache();

  cache.getOrCompute("file1.png", TEST_HASH);
  cache.getOrCompute("file2.svg", TEST_HASH_2);
  cache.clear();

  assertEquals(cache.has("file1.png"), false);
  assertEquals(cache.has("file2.svg"), false);
});
