/**
 * Unit tests for tools/known_vendors.ts
 *
 * Run with: deno test --allow-read tests/known_vendors_test.ts
 */

import {
  assertEquals,
} from "https://deno.land/std@0.203.0/assert/mod.ts";

import { KNOWN_VENDORS, VENDOR_ALIASES } from "../tools/known_vendors.ts";

// =============================================================================
// KNOWN_VENDORS Tests
// =============================================================================

Deno.test("KNOWN_VENDORS - contains common vendors", () => {
  assertEquals(KNOWN_VENDORS.includes("Sennheiser"), true);
  assertEquals(KNOWN_VENDORS.includes("Sony"), true);
  assertEquals(KNOWN_VENDORS.includes("Beyerdynamic"), true);
  assertEquals(KNOWN_VENDORS.includes("Audio Technica"), true);
  assertEquals(KNOWN_VENDORS.includes("HiFiMAN"), true);
});

Deno.test("KNOWN_VENDORS - sorted by length descending", () => {
  // Verify sorting is correct for greedy matching
  for (let i = 0; i < KNOWN_VENDORS.length - 1; i++) {
    assertEquals(
      KNOWN_VENDORS[i].length >= KNOWN_VENDORS[i + 1].length,
      true,
      `Vendor "${KNOWN_VENDORS[i]}" should be >= length of "${KNOWN_VENDORS[i + 1]}"`
    );
  }
});

Deno.test("KNOWN_VENDORS - multi-word vendors come before single word", () => {
  const audioTechnicaIdx = KNOWN_VENDORS.indexOf("Audio Technica");
  const sonyIdx = KNOWN_VENDORS.indexOf("Sony");
  // "Audio Technica" (14 chars) should come before "Sony" (4 chars)
  assertEquals(audioTechnicaIdx < sonyIdx, true);
});

Deno.test("KNOWN_VENDORS - longest vendors are first", () => {
  // Verify the first vendor is actually one of the longest
  const firstVendor = KNOWN_VENDORS[0];
  const lastVendor = KNOWN_VENDORS[KNOWN_VENDORS.length - 1];
  // First vendor should be longer than last vendor
  assertEquals(firstVendor.length > lastVendor.length, true);
  // First vendor should have at least 20 characters (multi-word)
  assertEquals(firstVendor.length >= 20, true);
});

Deno.test("KNOWN_VENDORS - contains vendors starting with numbers", () => {
  assertEquals(KNOWN_VENDORS.includes("64 Audio"), true);
  assertEquals(KNOWN_VENDORS.includes("1More"), true);
});

Deno.test("KNOWN_VENDORS - has no duplicates", () => {
  const uniqueVendors = new Set(KNOWN_VENDORS);
  assertEquals(uniqueVendors.size, KNOWN_VENDORS.length);
});

// =============================================================================
// VENDOR_ALIASES Tests
// =============================================================================

Deno.test("VENDOR_ALIASES - is an object", () => {
  assertEquals(typeof VENDOR_ALIASES, "object");
});

Deno.test("VENDOR_ALIASES - alias keys exist in KNOWN_VENDORS", () => {
  for (const alias of Object.keys(VENDOR_ALIASES)) {
    assertEquals(
      KNOWN_VENDORS.includes(alias),
      true,
      `Alias "${alias}" should be in KNOWN_VENDORS`
    );
  }
});

Deno.test("VENDOR_ALIASES - canonical names exist in KNOWN_VENDORS", () => {
  for (const [alias, canonical] of Object.entries(VENDOR_ALIASES)) {
    assertEquals(
      KNOWN_VENDORS.includes(canonical),
      true,
      `Canonical name "${canonical}" for alias "${alias}" should be in KNOWN_VENDORS`
    );
  }
});
