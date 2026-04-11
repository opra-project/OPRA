/**
 * Tests for import corrections system
 *
 * Run with: deno test --allow-read --allow-write --allow-env tests/corrections_test.ts
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

import { loadCorrections, applySlugRemap } from "../tools/utils.ts";

// =============================================================================
// loadCorrections
// =============================================================================

Deno.test("loadCorrections - loads valid corrections file", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  const path = join(tmpDir, "corrections.json");

  await Deno.writeTextFile(path, JSON.stringify({
    name_corrections: { "Bad Name)": "Good Name" },
    slug_remaps: { "v::bad_slug": "v::good_slug" },
  }));

  try {
    const corrections = await loadCorrections(path);
    assertEquals(corrections.name_corrections["Bad Name)"], "Good Name");
    assertEquals(corrections.slug_remaps["v::bad_slug"], "v::good_slug");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("loadCorrections - returns empty corrections for missing file", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  try {
    const corrections = await loadCorrections(join(tmpDir, "does_not_exist.json"));
    assertEquals(Object.keys(corrections.name_corrections).length, 0);
    assertEquals(Object.keys(corrections.slug_remaps).length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("loadCorrections - handles partial file (missing sections)", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  const path = join(tmpDir, "corrections.json");

  await Deno.writeTextFile(path, JSON.stringify({
    name_corrections: { "X": "Y" },
  }));

  try {
    const corrections = await loadCorrections(path);
    assertEquals(corrections.name_corrections["X"], "Y");
    assertEquals(Object.keys(corrections.slug_remaps).length, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("loadCorrections - throws on malformed JSON", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  const path = join(tmpDir, "corrections.json");

  await Deno.writeTextFile(path, "{ not valid json }}}");

  try {
    await assertRejects(
      () => loadCorrections(path),
      SyntaxError,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// =============================================================================
// applySlugRemap
// =============================================================================

Deno.test("applySlugRemap - returns original slugs when no remap exists", () => {
  const result = applySlugRemap("vendor", "product", {});
  assertEquals(result.vendorSlug, "vendor");
  assertEquals(result.productSlug, "product");
});

Deno.test("applySlugRemap - remaps product slug", () => {
  const remaps = { "7hz::timless_ii": "7hz::timeless_ii" };
  const result = applySlugRemap("7hz", "timless_ii", remaps);
  assertEquals(result.vendorSlug, "7hz");
  assertEquals(result.productSlug, "timeless_ii");
});

Deno.test("applySlugRemap - remaps both vendor and product slug", () => {
  const remaps = { "old_vendor::old_product": "new_vendor::new_product" };
  const result = applySlugRemap("old_vendor", "old_product", remaps);
  assertEquals(result.vendorSlug, "new_vendor");
  assertEquals(result.productSlug, "new_product");
});

Deno.test("applySlugRemap - ignores malformed remap value (no separator)", () => {
  const remaps = { "v::p": "no_separator" };
  const result = applySlugRemap("v", "p", remaps);
  assertEquals(result.vendorSlug, "v");
  assertEquals(result.productSlug, "p");
});

Deno.test("applySlugRemap - ignores remap with empty vendor", () => {
  const remaps = { "v::p": "::product" };
  const result = applySlugRemap("v", "p", remaps);
  assertEquals(result.vendorSlug, "v");
  assertEquals(result.productSlug, "p");
});

Deno.test("applySlugRemap - ignores remap with empty product", () => {
  const remaps = { "v::p": "vendor::" };
  const result = applySlugRemap("v", "p", remaps);
  assertEquals(result.vendorSlug, "v");
  assertEquals(result.productSlug, "p");
});

// =============================================================================
// Actual corrections files are valid JSON
// =============================================================================

Deno.test("autoeq corrections.json is valid", async () => {
  const corrections = await loadCorrections("tools/autoeq/corrections.json");
  assertEquals(typeof corrections.name_corrections, "object");
  assertEquals(typeof corrections.slug_remaps, "object");
});

Deno.test("oratory corrections.json is valid", async () => {
  const corrections = await loadCorrections("tools/oratory/corrections.json");
  assertEquals(typeof corrections.name_corrections, "object");
  assertEquals(typeof corrections.slug_remaps, "object");
});
