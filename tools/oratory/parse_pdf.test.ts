#!/usr/bin/env -S deno test --allow-read

/**
 * Tests for parse_pdf.ts - Oratory1990 PDF parsing
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseOratoryPdfText, extractTargetFromPdfText } from "./parse_pdf.ts";

// =============================================================================
// Test: Modern Format (Pattern 1)
// =============================================================================

Deno.test("parseOratoryPdfText - modern format with type after band number", () => {
  const text = `
    EQ setting for Sennheiser HD 650
    Preamp gain: -9,0 dB
    Band 1 PEAK 80 Hz -9,6 dB 0,4 3,02
    Band 2 LOW_SHELF 110 Hz 10,0 dB 0,71 1,89
    Band 3 PEAK 300 Hz -2,5 dB 1,0 1,39
  `;

  const result = parseOratoryPdfText(text);

  assertEquals(result.productName, "Sennheiser HD 650");
  assertEquals(result.preampGain, -9.0);
  assertEquals(result.filters.length, 3);

  assertEquals(result.filters[0], {
    band: 1,
    type: "PEAK",
    frequency: 80,
    gain: -9.6,
    q: 0.4,
  });

  assertEquals(result.filters[1], {
    band: 2,
    type: "LOW_SHELF",
    frequency: 110,
    gain: 10.0,
    q: 0.71,
  });
});

// =============================================================================
// Test: Alternate Format (Pattern 2)
// =============================================================================

Deno.test("parseOratoryPdfText - alternate format with type at end", () => {
  const text = `
    Preamp gain: -5,0 dB
    Band 1 125 Hz 1,4 -2,0 dB PEAK
    Band 2 250 Hz 1,4 3,0 dB LOW_SHELF
  `;

  const result = parseOratoryPdfText(text);

  assertEquals(result.preampGain, -5.0);
  assertEquals(result.filters.length, 2);

  assertEquals(result.filters[0], {
    band: 1,
    type: "PEAK",
    frequency: 125,
    gain: -2.0,
    q: 1.4,
  });

  assertEquals(result.filters[1], {
    band: 2,
    type: "LOW_SHELF",
    frequency: 250,
    gain: 3.0,
    q: 1.4,
  });
});

// =============================================================================
// Test: Old Format with Bandwidth Column (Pattern 3) - Sony W850C
// =============================================================================

Deno.test("parseOratoryPdfText - old format with bandwidth column (Sony W850C)", () => {
  // This is the actual format from Sony W850C.pdf
  const text = `
    v1.1
    by oratory1990
    04.06.18
    W850C
    Frequency Q-Factor Bandwidth Gain Filter Type Before EQ After EQ
    Band 1 125 Hz 1,4 1,0 2,0 dB PEAK 3,95 dB 2,81 dB
    Band 2 250 Hz 1,4 1,0 -1,0 dB PEAK
    Band 3 500 Hz 1,4 1,0 -5,0 dB PEAK
    Band 4 1000 Hz 1,4 1,0 -1,0 dB PEAK
    Band 5 2000 Hz 1,4 1,0 -2,0 dB PEAK
    Band 6 4000 Hz 1,4 1,0 -1,0 dB PEAK
    Band 7 8000 Hz 1,4 1,0 -1,0 dB PEAK
    Preamp gain: -1,7 dB
  `;

  const result = parseOratoryPdfText(text);

  assertEquals(result.preampGain, -1.7);
  assertEquals(result.filters.length, 7, "Should parse all 7 bands");

  // Verify first band
  assertEquals(result.filters[0], {
    band: 1,
    type: "PEAK",
    frequency: 125,
    gain: 2.0,
    q: 1.4,
  });

  // Verify last band
  assertEquals(result.filters[6], {
    band: 7,
    type: "PEAK",
    frequency: 8000,
    gain: -1.0,
    q: 1.4,
  });
});

Deno.test("parseOratoryPdfText - Sony W850C linear variant", () => {
  const text = `
    v1.1
    by oratory1990
    05.06.18
    Frequency Q-Factor Bandwidth Gain Filter Type Before EQ After EQ
    Band 1 125 Hz 1,4 1,0 2,0 dB PEAK 4,84 dB 3,07 dB
    Band 2 250 Hz 1,4 1,0 2,0 dB PEAK
    Band 3 500 Hz 1,4 1,0 -3,0 dB PEAK
    Band 4 1000 Hz 1,4 1,0 4,0 dB PEAK
    Band 5 2000 Hz 1,4 1,0 3,0 dB PEAK
    Band 6 4000 Hz 1,4 1,0 5,0 dB PEAK
    Band 7 8000 Hz 1,4 1,0 6,0 dB PEAK
    Preamp gain: -6,9 dB
  `;

  const result = parseOratoryPdfText(text);

  assertEquals(result.preampGain, -6.9);
  assertEquals(result.filters.length, 7);

  assertEquals(result.filters[0].gain, 2.0);
  assertEquals(result.filters[6].gain, 6.0);
});

// =============================================================================
// Test: Edge Cases
// =============================================================================

Deno.test("parseOratoryPdfText - handles European decimal format", () => {
  const text = `
    Preamp gain: -3,5 dB
    Band 1 PEAK 1000 Hz -2,7 dB 1,42
  `;

  const result = parseOratoryPdfText(text);

  assertEquals(result.preampGain, -3.5);
  assertEquals(result.filters[0].gain, -2.7);
  assertEquals(result.filters[0].q, 1.42);
});

Deno.test("parseOratoryPdfText - extracts product name", () => {
  const text = `
    EQ setting for Sony WH-1000XM4
    Preamp gain: -5,0 dB
    Band 1 PEAK 100 Hz 3,0 dB 1,0
  `;

  const result = parseOratoryPdfText(text);

  assertEquals(result.productName, "Sony WH-1000XM4");
});

Deno.test("parseOratoryPdfText - handles missing product name", () => {
  const text = `
    Preamp gain: -5,0 dB
    Band 1 PEAK 100 Hz 3,0 dB 1,0
  `;

  const result = parseOratoryPdfText(text);

  assertEquals(result.productName, "Unknown");
});

Deno.test("parseOratoryPdfText - handles no filters found", () => {
  const text = `
    Preamp gain: -5,0 dB
    This is just some text without any filter bands.
  `;

  const result = parseOratoryPdfText(text);

  assertEquals(result.filters.length, 0);
  assertEquals(result.preampGain, -5.0);
});

// =============================================================================
// Test: extractTargetFromPdfText
// =============================================================================

Deno.test("extractTargetFromPdfText - detects USound target from graph label", () => {
  const text = `
    EQ setting for Beyerdynamic Xelento
    SPL Frequency Response without EQ
    USOUND 1V1 In-Ear Target
    Preamp gain: -2,9 dB
    Band 1 PEAK 35 Hz -2,3 dB 0,8
  `;

  assertEquals(extractTargetFromPdfText(text), "usound");
});

Deno.test("extractTargetFromPdfText - detects oratory1990 target from graph label", () => {
  const text = `
    EQ setting for BGVP DMG
    SPL Frequency Response without EQ
    oratory1990 In-Ear Target
    Preamp gain: -3,0 dB
    Band 1 PEAK 18 Hz 1,8 dB 1,3
  `;

  assertEquals(extractTargetFromPdfText(text), "oratory1990");
});

Deno.test("extractTargetFromPdfText - detects Harman target", () => {
  const text = `
    EQ setting for Apple AirPods Pro
    SPL Frequency Response without EQ
    Harman In-Ear LI Target
    Preamp gain: -9,1 dB
    Band 1 PEAK 52 Hz -5,4 dB 0,45
  `;

  assertEquals(extractTargetFromPdfText(text), "harman");
});

Deno.test("extractTargetFromPdfText - returns null when no target found", () => {
  const text = `
    Some random text without any target curve mention
    Band 1 PEAK 100 Hz 3,0 dB 1,0
  `;

  assertEquals(extractTargetFromPdfText(text), null);
});

Deno.test("extractTargetFromPdfText - ignores oratory1990 in author attribution", () => {
  // "by oratory1990" is author credit, not target curve
  // "USOUND 1V1 In-Ear Target" is the actual target
  const text = `
    v2.0
    by oratory1990
    15.01.24
    EQ setting for 7Hz Timeless
    USOUND 1V1 In-Ear Target
    Preamp gain: -4,6 dB
    Band 1 PEAK 20 Hz -5,5 dB 0,4
  `;

  assertEquals(extractTargetFromPdfText(text), "usound");
});

Deno.test("extractTargetFromPdfText - handles real extracted PDF text (no newlines, oratory1990 author before USound target)", () => {
  // Real extracted text from Beyerdynamic Xelento.pdf — continuous string with
  // "by oratory1990" early and "USOUND 1V1 In-Ear Target" in the graph section.
  // The word "Target" also appears in "Deviation from Target" between them.
  const text = `measured on GRAS43AC v2.9 by oratory1990 30.01.22 Filter Settings Filter Type Frequency Gain Q-Factor BW Band 1 PEAK 35 Hz -2,3 dB 0,8 1,7 Deviation from Target Band 3 PEAK 830 Hz 2,9 dB 0,9 SPL Frequency Response without EQ USOUND 1V1 In-Ear Target Raw Frequency Response`;

  assertEquals(extractTargetFromPdfText(text), "usound");
});

Deno.test("extractTargetFromPdfText - detects Harman AE/OE target for over-ear", () => {
  const text = `
    EQ setting for Sennheiser HD 650
    SPL Frequency Response without EQ
    Harman AE/OE 2018 Target
    Preamp gain: -9,0 dB
    Band 1 PEAK 80 Hz -9,6 dB 0,4
  `;

  assertEquals(extractTargetFromPdfText(text), "harman");
});

Deno.test("parseOratoryPdfText - parses shelf filters in old format", () => {
  const text = `
    Preamp gain: -4,0 dB
    Band 1 105 Hz 0,71 1,89 5,5 dB LOW_SHELF
    Band 2 8000 Hz 0,71 1,89 -3,0 dB HIGH_SHELF
  `;

  const result = parseOratoryPdfText(text);

  assertEquals(result.filters.length, 2);
  assertEquals(result.filters[0].type, "LOW_SHELF");
  assertEquals(result.filters[1].type, "HIGH_SHELF");
});
