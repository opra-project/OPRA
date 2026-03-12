/**
 * Unit tests for tools/oratory/parse_pdf.ts
 *
 * Run with: deno test --allow-read tests/oratory_parse_pdf_test.ts
 */

import {
  assertEquals,
  assertAlmostEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  parseOratoryPdfText,
  formatAsParametricEQ,
  formatAsJSON,
} from "../tools/oratory/parse_pdf.ts";

// =============================================================================
// Test Fixtures - Sample PDF Text Content
// =============================================================================

const SAMPLE_PDF_TEXT_STANDARD = `
EQ setting for Sennheiser HD 650
v2.0 01.05.2023

Preamp gain: -6.5 dB

Headphone Equalization
Filter Settings

Band 1 LOW_SHELF 105 Hz 5,5 dB 0,71
Band 2 PEAK 200 Hz -2,0 dB 1,41
Band 3 PEAK 1500 Hz 2,5 dB 2,00
Band 4 PEAK 3000 Hz -1,5 dB 3,00
Band 5 HIGH_SHELF 8000 Hz -3,0 dB 0,71

Before EQ After EQ
1,64 dB 0,29 dB Adjust gain of band
84/100 100/100
`;

const SAMPLE_PDF_TEXT_ALTERNATE_FORMAT = `
EQ setting for Beyerdynamic DT 880

-4.2 dB Headphone Equalization Filter Settings Preamp gain:

Band 1 PEAK 30 Hz 3,0 dB 1,00
Band 2 PEAK 200 Hz -1,5 dB 2,50
Band 3 PK 2000 Hz 1,0 dB 1,80
Band 4 HSC 6000 Hz -2,5 dB 0,70
Band 5 LSC 80 Hz 4,0 dB 0,71
`;

const SAMPLE_PDF_TEXT_EUROPEAN_DECIMALS = `
EQ setting for Sony WH-1000XM4

Preamp gain: -5,5 dB

Band 1 PEAK 100 Hz 2,5 dB 1,41
Band 2 PEAK 500 Hz -1,0 dB 2,00
Band 3 PEAK 2000 Hz 1,5 dB 1,80
`;

const SAMPLE_PDF_TEXT_WITH_LOWPASS = `
EQ setting for Test Headphone

Preamp gain: -3.0 dB

Band 1 PEAK 100 Hz 2.0 dB 1.41
Band 2 LOW_PASS 8000 Hz 0.0 dB 0.7
Band 3 HIGH_PASS 20 Hz 0.0 dB 0.7
`;

const SAMPLE_PDF_TEXT_NEGATIVE_Q_TYPO = `
EQ setting for Test Headphone 2

Preamp gain: -2.0 dB

Band 1 PEAK 100 Hz 2.0 dB -0.71
Band 2 PEAK 1000 Hz -1.0 dB 1.41
`;

// =============================================================================
// parseOratoryPdfText Tests
// =============================================================================

Deno.test("parseOratoryPdfText - extracts product name", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  assertEquals(result.productName, "Sennheiser HD 650");
});

Deno.test("parseOratoryPdfText - extracts preamp gain", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  assertAlmostEquals(result.preampGain, -6.5, 0.01);
});

Deno.test("parseOratoryPdfText - extracts correct number of filters", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  assertEquals(result.filters.length, 5);
});

Deno.test("parseOratoryPdfText - parses LOW_SHELF filter", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  const lowShelf = result.filters.find(f => f.type === "LOW_SHELF");
  assertEquals(lowShelf?.type, "LOW_SHELF");
  assertEquals(lowShelf?.frequency, 105);
  assertAlmostEquals(lowShelf?.gain ?? 0, 5.5, 0.01);
  assertAlmostEquals(lowShelf?.q ?? 0, 0.71, 0.01);
});

Deno.test("parseOratoryPdfText - parses PEAK filter", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  const peak = result.filters.find(f => f.type === "PEAK" && f.frequency === 200);
  assertEquals(peak?.type, "PEAK");
  assertEquals(peak?.frequency, 200);
  assertAlmostEquals(peak?.gain ?? 0, -2.0, 0.01);
  assertAlmostEquals(peak?.q ?? 0, 1.41, 0.01);
});

Deno.test("parseOratoryPdfText - parses HIGH_SHELF filter", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  const highShelf = result.filters.find(f => f.type === "HIGH_SHELF");
  assertEquals(highShelf?.type, "HIGH_SHELF");
  assertEquals(highShelf?.frequency, 8000);
  assertAlmostEquals(highShelf?.gain ?? 0, -3.0, 0.01);
});

Deno.test("parseOratoryPdfText - extracts version", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  assertEquals(result.metadata.version, "2.0");
});

Deno.test("parseOratoryPdfText - extracts date", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  assertEquals(result.metadata.date, "01.05.2023");
});

Deno.test("parseOratoryPdfText - extracts deviation values", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  assertAlmostEquals(result.metadata.deviationBefore ?? 0, 1.64, 0.01);
  assertAlmostEquals(result.metadata.deviationAfter ?? 0, 0.29, 0.01);
});

Deno.test("parseOratoryPdfText - extracts preference ratings", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  assertEquals(result.metadata.preferenceRatingBefore, 84);
  assertEquals(result.metadata.preferenceRatingAfter, 100);
});

Deno.test("parseOratoryPdfText - handles European decimal format", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_EUROPEAN_DECIMALS);
  assertAlmostEquals(result.preampGain, -5.5, 0.01);
  assertEquals(result.filters[0].frequency, 100);
  assertAlmostEquals(result.filters[0].gain, 2.5, 0.01);
});

Deno.test("parseOratoryPdfText - parses abbreviated filter types", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_ALTERNATE_FORMAT);
  const pk = result.filters.find(f => f.frequency === 2000);
  assertEquals(pk?.type, "PEAK");

  const hsc = result.filters.find(f => f.frequency === 6000);
  assertEquals(hsc?.type, "HIGH_SHELF");

  const lsc = result.filters.find(f => f.frequency === 80);
  assertEquals(lsc?.type, "LOW_SHELF");
});

Deno.test("parseOratoryPdfText - parses LOW_PASS and HIGH_PASS", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_WITH_LOWPASS);
  const lowPass = result.filters.find(f => f.type === "LOW_PASS");
  assertEquals(lowPass?.type, "LOW_PASS");
  assertEquals(lowPass?.frequency, 8000);

  const highPass = result.filters.find(f => f.type === "HIGH_PASS");
  assertEquals(highPass?.type, "HIGH_PASS");
  assertEquals(highPass?.frequency, 20);
});

Deno.test("parseOratoryPdfText - handles negative Q typo (takes absolute value)", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_NEGATIVE_Q_TYPO);
  const filter = result.filters.find(f => f.frequency === 100);
  assertAlmostEquals(filter?.q ?? 0, 0.71, 0.01); // Should be positive
});

Deno.test("parseOratoryPdfText - sorts filters by band number", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  for (let i = 0; i < result.filters.length - 1; i++) {
    assertEquals(result.filters[i].band < result.filters[i + 1].band, true);
  }
});

Deno.test("parseOratoryPdfText - handles empty input", () => {
  const result = parseOratoryPdfText("");
  assertEquals(result.productName, "Unknown");
  assertEquals(result.preampGain, 0);
  assertEquals(result.filters.length, 0);
});

// =============================================================================
// formatAsParametricEQ Tests
// =============================================================================

Deno.test("formatAsParametricEQ - generates correct format", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  const formatted = formatAsParametricEQ(result);

  // Check preamp line
  assertEquals(formatted.includes("Preamp: -6.5 dB"), true);

  // Check filter lines exist
  assertEquals(formatted.includes("Filter 1:"), true);
  assertEquals(formatted.includes("Filter 5:"), true);
});

Deno.test("formatAsParametricEQ - maps filter types correctly", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  const formatted = formatAsParametricEQ(result);

  assertEquals(formatted.includes("LSC"), true); // LOW_SHELF
  assertEquals(formatted.includes("HSC"), true); // HIGH_SHELF
  assertEquals(formatted.includes("PK"), true);  // PEAK
});

Deno.test("formatAsParametricEQ - includes frequency, gain, Q", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  const formatted = formatAsParametricEQ(result);

  // Check for typical filter line format
  assertEquals(formatted.includes("Fc"), true);
  assertEquals(formatted.includes("Hz"), true);
  assertEquals(formatted.includes("Gain"), true);
  assertEquals(formatted.includes("dB"), true);
  assertEquals(formatted.includes("Q"), true);
});

// =============================================================================
// formatAsJSON Tests
// =============================================================================

Deno.test("formatAsJSON - produces valid JSON", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  const jsonStr = formatAsJSON(result);

  // Should not throw
  const parsed = JSON.parse(jsonStr);
  assertEquals(typeof parsed, "object");
});

Deno.test("formatAsJSON - contains all fields", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  const jsonStr = formatAsJSON(result);
  const parsed = JSON.parse(jsonStr);

  assertEquals("productName" in parsed, true);
  assertEquals("preampGain" in parsed, true);
  assertEquals("filters" in parsed, true);
  assertEquals("metadata" in parsed, true);
});

Deno.test("formatAsJSON - roundtrip preserves data", () => {
  const result = parseOratoryPdfText(SAMPLE_PDF_TEXT_STANDARD);
  const jsonStr = formatAsJSON(result);
  const parsed = JSON.parse(jsonStr);

  assertEquals(parsed.productName, result.productName);
  assertAlmostEquals(parsed.preampGain, result.preampGain, 0.01);
  assertEquals(parsed.filters.length, result.filters.length);
});

// =============================================================================
// Real PDF Tests (using unpdf for text extraction)
// =============================================================================

import { extractTextFromPdf } from "../tools/oratory/extract_text.ts";

Deno.test("Real PDF - test_1.pdf extracts 10 filters", async () => {
  const text = await extractTextFromPdf("tests/fixtures/test_1.pdf");
  const result = parseOratoryPdfText(text);

  assertEquals(result.filters.length, 10);
});

Deno.test("Real PDF - test_1.pdf extracts correct preamp gain", async () => {
  const text = await extractTextFromPdf("tests/fixtures/test_1.pdf");
  const result = parseOratoryPdfText(text);

  assertAlmostEquals(result.preampGain, -10.3, 0.01);
});

Deno.test("Real PDF - test_1.pdf extracts version and date", async () => {
  const text = await extractTextFromPdf("tests/fixtures/test_1.pdf");
  const result = parseOratoryPdfText(text);

  assertEquals(result.metadata.version, "2.9");
  assertEquals(result.metadata.date, "08.04.24");
});

Deno.test("Real PDF - test_1.pdf extracts preference ratings", async () => {
  const text = await extractTextFromPdf("tests/fixtures/test_1.pdf");
  const result = parseOratoryPdfText(text);

  assertEquals(result.metadata.preferenceRatingBefore, 47);
  assertEquals(result.metadata.preferenceRatingAfter, 100);
});

Deno.test("Real PDF - test_1.pdf extracts filter types correctly", async () => {
  const text = await extractTextFromPdf("tests/fixtures/test_1.pdf");
  const result = parseOratoryPdfText(text);

  // Band 1 should be PEAK at 80 Hz
  const band1 = result.filters.find(f => f.band === 1);
  assertEquals(band1?.type, "PEAK");
  assertEquals(band1?.frequency, 80);

  // Band 2 should be LOW_SHELF at 105 Hz
  const band2 = result.filters.find(f => f.band === 2);
  assertEquals(band2?.type, "LOW_SHELF");
  assertEquals(band2?.frequency, 105);

  // Band 8 should be HIGH_SHELF at 2500 Hz
  const band8 = result.filters.find(f => f.band === 8);
  assertEquals(band8?.type, "HIGH_SHELF");
  assertEquals(band8?.frequency, 2500);
});

Deno.test("Real PDF - test_2.pdf extracts product name", async () => {
  const text = await extractTextFromPdf("tests/fixtures/test_2.pdf");
  const result = parseOratoryPdfText(text);

  assertEquals(result.productName, "Test 2");
});

Deno.test("Real PDF - test_2.pdf extracts 8 filters", async () => {
  const text = await extractTextFromPdf("tests/fixtures/test_2.pdf");
  const result = parseOratoryPdfText(text);

  assertEquals(result.filters.length, 8);
});

Deno.test("Real PDF - test_2.pdf extracts correct preamp gain", async () => {
  const text = await extractTextFromPdf("tests/fixtures/test_2.pdf");
  const result = parseOratoryPdfText(text);

  assertAlmostEquals(result.preampGain, -5.5, 0.01);
});

Deno.test("Real PDF - test_2.pdf extracts preference ratings", async () => {
  const text = await extractTextFromPdf("tests/fixtures/test_2.pdf");
  const result = parseOratoryPdfText(text);

  assertEquals(result.metadata.preferenceRatingBefore, 82);
  assertEquals(result.metadata.preferenceRatingAfter, 100);
});
