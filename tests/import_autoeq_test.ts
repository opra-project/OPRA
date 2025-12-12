/**
 * Unit tests for AutoEQ parsing functions
 *
 * Run with: deno test --allow-read tests/import_autoeq_test.ts
 */

import {
  assertEquals,
  assertAlmostEquals,
  assertThrows,
} from "https://deno.land/std@0.203.0/assert/mod.ts";

// Import from shared modules - no more code duplication!
import { parseParametricEQ, mapTypeToSubtype } from "../tools/autoeq/parse_eq.ts";
import { generateSlug } from "../tools/utils.ts";

// =============================================================================
// Test Fixtures - Sample AutoEQ ParametricEQ.txt Content
// =============================================================================

const SAMPLE_PARAMETRIC_EQ_BASIC = `
Preamp: -6.2 dB
Filter 1: ON PK Fc 31 Hz Gain 4.5 dB Q 1.41
Filter 2: ON PK Fc 62 Hz Gain -1.2 dB Q 1.00
Filter 3: ON PK Fc 125 Hz Gain 2.3 dB Q 1.41
Filter 4: ON PK Fc 250 Hz Gain -0.5 dB Q 1.41
Filter 5: ON PK Fc 500 Hz Gain 1.0 dB Q 1.41
`;

const SAMPLE_PARAMETRIC_EQ_WITH_SHELVES = `
Preamp: -4.8 dB
Filter 1: ON LSC Fc 105 Hz Gain 5.5 dB Q 0.71
Filter 2: ON PK Fc 200 Hz Gain -2.0 dB Q 1.41
Filter 3: ON PK Fc 1500 Hz Gain 2.5 dB Q 2.00
Filter 4: ON HSC Fc 8000 Hz Gain -3.0 dB Q 0.71
`;

const SAMPLE_PARAMETRIC_EQ_NO_Q = `
Preamp: -3.0 dB
Filter 1: ON PK Fc 100 Hz Gain 2.0 dB
Filter 2: ON PK Fc 1000 Hz Gain -1.5 dB
`;

const SAMPLE_PARAMETRIC_EQ_MANY_FILTERS = `
Preamp: -7.5 dB
Filter 1: ON PK Fc 21 Hz Gain 4.8 dB Q 1.02
Filter 2: ON PK Fc 56 Hz Gain 2.5 dB Q 0.55
Filter 3: ON PK Fc 177 Hz Gain -2.3 dB Q 0.89
Filter 4: ON PK Fc 379 Hz Gain 1.0 dB Q 0.64
Filter 5: ON PK Fc 1017 Hz Gain -1.3 dB Q 2.59
Filter 6: ON PK Fc 1902 Hz Gain 2.2 dB Q 2.42
Filter 7: ON PK Fc 3363 Hz Gain -3.8 dB Q 3.65
Filter 8: ON PK Fc 5330 Hz Gain 4.4 dB Q 3.16
Filter 9: ON PK Fc 7906 Hz Gain -2.3 dB Q 4.04
Filter 10: ON PK Fc 12059 Hz Gain 3.3 dB Q 1.99
`;

// =============================================================================
// generateSlug Tests (AutoEQ version)
// =============================================================================

Deno.test("AutoEQ generateSlug - basic conversion", () => {
  assertEquals(generateSlug("Sennheiser HD 650"), "sennheiser_hd_650");
});

Deno.test("AutoEQ generateSlug - handles hyphens", () => {
  assertEquals(generateSlug("Audio-Technica"), "audio_technica");
});

Deno.test("AutoEQ generateSlug - handles parentheses", () => {
  assertEquals(generateSlug("HD 800 (S)"), "hd_800_s");
});

Deno.test("AutoEQ generateSlug - removes special characters", () => {
  assertEquals(generateSlug("Product!@#Name"), "productname");
});

Deno.test("AutoEQ generateSlug - collapses multiple underscores", () => {
  assertEquals(generateSlug("Multiple   Spaces"), "multiple_spaces");
});

// =============================================================================
// parseParametricEQ Tests
// =============================================================================

Deno.test("parseParametricEQ - extracts preamp gain", () => {
  const result = parseParametricEQ(SAMPLE_PARAMETRIC_EQ_BASIC);
  assertAlmostEquals(result.preamp, -6.2, 0.01);
});

Deno.test("parseParametricEQ - extracts correct number of filters", () => {
  const result = parseParametricEQ(SAMPLE_PARAMETRIC_EQ_BASIC);
  assertEquals(result.filters.length, 5);
});

Deno.test("parseParametricEQ - parses PK (peak_dip) filters", () => {
  const result = parseParametricEQ(SAMPLE_PARAMETRIC_EQ_BASIC);
  assertEquals(result.filters[0].type, "peak_dip");
  assertEquals(result.filters[0].frequency, 31);
  assertAlmostEquals(result.filters[0].gain_db ?? 0, 4.5, 0.01);
  assertAlmostEquals(result.filters[0].q ?? 0, 1.41, 0.01);
});

Deno.test("parseParametricEQ - parses LSC (low_shelf) filters", () => {
  const result = parseParametricEQ(SAMPLE_PARAMETRIC_EQ_WITH_SHELVES);
  const lsc = result.filters.find(f => f.type === "low_shelf");
  assertEquals(lsc?.type, "low_shelf");
  assertEquals(lsc?.frequency, 105);
  assertAlmostEquals(lsc?.gain_db ?? 0, 5.5, 0.01);
  assertAlmostEquals(lsc?.q ?? 0, 0.71, 0.01);
});

Deno.test("parseParametricEQ - parses HSC (high_shelf) filters", () => {
  const result = parseParametricEQ(SAMPLE_PARAMETRIC_EQ_WITH_SHELVES);
  const hsc = result.filters.find(f => f.type === "high_shelf");
  assertEquals(hsc?.type, "high_shelf");
  assertEquals(hsc?.frequency, 8000);
  assertAlmostEquals(hsc?.gain_db ?? 0, -3.0, 0.01);
});

Deno.test("parseParametricEQ - handles negative gain values", () => {
  const result = parseParametricEQ(SAMPLE_PARAMETRIC_EQ_BASIC);
  const negativeGainFilter = result.filters.find(f => f.frequency === 62);
  assertAlmostEquals(negativeGainFilter?.gain_db ?? 0, -1.2, 0.01);
});

Deno.test("parseParametricEQ - handles missing Q value", () => {
  const result = parseParametricEQ(SAMPLE_PARAMETRIC_EQ_NO_Q);
  assertEquals(result.filters[0].q, undefined);
  assertEquals(result.filters[1].q, undefined);
});

Deno.test("parseParametricEQ - handles many filters", () => {
  const result = parseParametricEQ(SAMPLE_PARAMETRIC_EQ_MANY_FILTERS);
  assertEquals(result.filters.length, 10);
  assertAlmostEquals(result.preamp, -7.5, 0.01);
});

Deno.test("parseParametricEQ - handles empty input", () => {
  const result = parseParametricEQ("");
  assertEquals(result.preamp, 0);
  assertEquals(result.filters.length, 0);
});

Deno.test("parseParametricEQ - handles input with only preamp", () => {
  const result = parseParametricEQ("Preamp: -5.0 dB");
  assertAlmostEquals(result.preamp, -5.0, 0.01);
  assertEquals(result.filters.length, 0);
});

Deno.test("parseParametricEQ - preserves filter order", () => {
  const result = parseParametricEQ(SAMPLE_PARAMETRIC_EQ_MANY_FILTERS);
  // Verify frequencies are in the expected order
  assertEquals(result.filters[0].frequency, 21);
  assertEquals(result.filters[9].frequency, 12059);
});

// =============================================================================
// mapTypeToSubtype Tests
// =============================================================================

Deno.test("mapTypeToSubtype - maps in-ear", () => {
  assertEquals(mapTypeToSubtype("in-ear"), "in_ear");
  assertEquals(mapTypeToSubtype("in_ear"), "in_ear");
  assertEquals(mapTypeToSubtype("IN-EAR"), "in_ear");
});

Deno.test("mapTypeToSubtype - maps over-ear", () => {
  assertEquals(mapTypeToSubtype("over-ear"), "over_the_ear");
  assertEquals(mapTypeToSubtype("over_the_ear"), "over_the_ear");
  assertEquals(mapTypeToSubtype("OVER-EAR"), "over_the_ear");
});

Deno.test("mapTypeToSubtype - maps on-ear", () => {
  assertEquals(mapTypeToSubtype("on-ear"), "on_ear");
  assertEquals(mapTypeToSubtype("on_ear"), "on_ear");
  assertEquals(mapTypeToSubtype("ON-EAR"), "on_ear");
});

Deno.test("mapTypeToSubtype - maps earbuds", () => {
  assertEquals(mapTypeToSubtype("earbud"), "earbuds");
  assertEquals(mapTypeToSubtype("earbuds"), "earbuds");
  assertEquals(mapTypeToSubtype("EARBUDS"), "earbuds");
});

Deno.test("mapTypeToSubtype - throws on unknown type", () => {
  assertThrows(
    () => mapTypeToSubtype("unknown"),
    Error,
    "Unknown type: unknown"
  );
});

Deno.test("mapTypeToSubtype - throws on invalid type", () => {
  assertThrows(
    () => mapTypeToSubtype("speakers"),
    Error,
    "Unknown type: speakers"
  );
});
