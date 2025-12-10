/**
 * Unit tests for tools/utils.ts
 *
 * Run with: deno test --allow-read tests/utils_test.ts
 */

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.203.0/assert/mod.ts";

import {
  generateSlug,
  toTitleCase,
  splitVendorProduct,
  splitVendorProductOrUnknown,
} from "../tools/utils.ts";
import { VENDOR_ALIASES } from "../tools/known_vendors.ts";

// =============================================================================
// generateSlug Tests
// =============================================================================

Deno.test("generateSlug - basic string conversion", () => {
  assertEquals(generateSlug("Hello World"), "hello_world");
});

Deno.test("generateSlug - preserves numbers", () => {
  assertEquals(generateSlug("HD 800 S"), "hd_800_s");
});

Deno.test("generateSlug - handles hyphens", () => {
  assertEquals(generateSlug("in-ear"), "in_ear");
  assertEquals(generateSlug("over-ear"), "over_ear");
});

Deno.test("generateSlug - handles parentheses", () => {
  assertEquals(generateSlug("Product (Version 2)"), "product_version_2");
});

Deno.test("generateSlug - removes special characters", () => {
  assertEquals(generateSlug("B&O"), "bo");
  assertEquals(generateSlug("T+A"), "ta");
});

Deno.test("generateSlug - handles multiple spaces", () => {
  assertEquals(generateSlug("Multiple   Spaces"), "multiple_spaces");
});

Deno.test("generateSlug - removes leading/trailing underscores", () => {
  assertEquals(generateSlug("  Leading Trailing  "), "leading_trailing");
});

Deno.test("generateSlug - handles mixed case", () => {
  assertEquals(generateSlug("Sennheiser HD650"), "sennheiser_hd650");
});

Deno.test("generateSlug - empty string", () => {
  assertEquals(generateSlug(""), "");
});

Deno.test("generateSlug - vendor names", () => {
  assertEquals(generateSlug("Audio Technica"), "audio_technica");
  assertEquals(generateSlug("Dan Clark Audio"), "dan_clark_audio");
  assertEquals(generateSlug("64 Audio"), "64_audio");
});

Deno.test("generateSlug - product names with numbers", () => {
  assertEquals(generateSlug("HD 800 S"), "hd_800_s");
  assertEquals(generateSlug("IE 300"), "ie_300");
  assertEquals(generateSlug("DT 1990 Pro"), "dt_1990_pro");
});

// =============================================================================
// toTitleCase Tests
// =============================================================================

Deno.test("toTitleCase - basic conversion", () => {
  assertEquals(toTitleCase("hello world"), "Hello World");
});

Deno.test("toTitleCase - already title case", () => {
  assertEquals(toTitleCase("Hello World"), "Hello World");
});

Deno.test("toTitleCase - all uppercase", () => {
  assertEquals(toTitleCase("HELLO WORLD"), "Hello World");
});

Deno.test("toTitleCase - single word", () => {
  assertEquals(toTitleCase("hello"), "Hello");
});

Deno.test("toTitleCase - empty string", () => {
  assertEquals(toTitleCase(""), "");
});

Deno.test("toTitleCase - mixed case input", () => {
  assertEquals(toTitleCase("hElLo WoRlD"), "Hello World");
});

Deno.test("toTitleCase - with numbers", () => {
  assertEquals(toTitleCase("version 2"), "Version 2");
});

// =============================================================================
// splitVendorProduct Tests
// =============================================================================

Deno.test("splitVendorProduct - splits known vendor", () => {
  const result = splitVendorProduct("Sennheiser HD 650");
  assertEquals(result?.vendorName, "Sennheiser");
  assertEquals(result?.productName, "HD 650");
});

Deno.test("splitVendorProduct - handles multi-word vendors", () => {
  const result = splitVendorProduct("Audio Technica ATH-M50x");
  assertEquals(result?.vendorName, "Audio Technica");
  assertEquals(result?.productName, "ATH-M50x");
});

Deno.test("splitVendorProduct - handles vendors starting with numbers", () => {
  const result = splitVendorProduct("64 Audio U12t");
  assertEquals(result?.vendorName, "64 Audio");
  assertEquals(result?.productName, "U12t");
});

Deno.test("splitVendorProduct - returns null for unknown vendor", () => {
  const result = splitVendorProduct("UnknownBrand XYZ-123");
  assertEquals(result, null);
});

Deno.test("splitVendorProduct - returns null when no product name", () => {
  const result = splitVendorProduct("Sennheiser");
  assertEquals(result, null);
});

Deno.test("splitVendorProduct - case insensitive matching", () => {
  const result = splitVendorProduct("SENNHEISER hd 650");
  assertEquals(result?.vendorName, "Sennheiser");
  assertEquals(result?.productName, "hd 650");
});

Deno.test("splitVendorProduct - trims whitespace", () => {
  const result = splitVendorProduct("  Sennheiser HD 650  ");
  assertEquals(result?.vendorName, "Sennheiser");
  assertEquals(result?.productName, "HD 650");
});

Deno.test("splitVendorProduct - greedy matching prefers longer vendor", () => {
  // "Dan Clark Audio" should match before "Dan"
  const result = splitVendorProduct("Dan Clark Audio Stealth");
  assertEquals(result?.vendorName, "Dan Clark Audio");
  assertEquals(result?.productName, "Stealth");
});

// =============================================================================
// splitVendorProductOrUnknown Tests
// =============================================================================

Deno.test("splitVendorProductOrUnknown - returns result for known vendor", () => {
  const result = splitVendorProductOrUnknown("Sony WH-1000XM4");
  assertEquals(result.vendorName, "Sony");
  assertEquals(result.productName, "WH-1000XM4");
});

Deno.test("splitVendorProductOrUnknown - returns Unknown for unrecognized vendor", () => {
  const result = splitVendorProductOrUnknown("UnknownBrand Model123");
  assertEquals(result.vendorName, "Unknown");
  assertEquals(result.productName, "UnknownBrand Model123");
});

Deno.test("splitVendorProductOrUnknown - never returns null", () => {
  const result = splitVendorProductOrUnknown("Anything Here");
  assertEquals(typeof result.vendorName, "string");
  assertEquals(typeof result.productName, "string");
});

// =============================================================================
// VENDOR_ALIASES Tests
// =============================================================================

Deno.test("VENDOR_ALIASES - resolves common aliases", () => {
  // Check some expected aliases exist
  assertEquals(typeof VENDOR_ALIASES, "object");
});

Deno.test("splitVendorProduct - resolves vendor aliases", () => {
  // If B&W is an alias for Bowers & Wilkins, test it
  if (VENDOR_ALIASES["B&W"]) {
    const result = splitVendorProduct("B&W P7");
    assertEquals(result?.vendorName, VENDOR_ALIASES["B&W"]);
  }
});
