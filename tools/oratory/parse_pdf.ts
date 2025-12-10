#!/usr/bin/env -S deno run --allow-read

/**
 * parse_pdf.ts - Parse EQ data from Oratory1990 PDF text
 *
 * This module extracts EQ filter settings from the text content of Oratory PDFs.
 * The PDFs have a consistent format with a "Filter Settings" table.
 *
 * Usage:
 *   deno run --allow-read tools/oratory/parse_pdf.ts <pdf_text_file>
 *
 * The script expects PDF text in the format extracted by Claude's PDF reader,
 * or similar text extraction tools.
 */

// =============================================================================
// Types
// =============================================================================

interface EQFilter {
  band: number;
  type: "PEAK" | "LOW_SHELF" | "HIGH_SHELF" | "LOW_PASS" | "HIGH_PASS";
  frequency: number;  // Hz
  gain: number;       // dB
  q: number;          // Q-factor
}

interface ParsedEQ {
  productName: string;
  preampGain: number;  // dB
  filters: EQFilter[];
  metadata: {
    version: string | null;
    date: string | null;
    deviationBefore: number | null;
    deviationAfter: number | null;
    preferenceRatingBefore: number | null;
    preferenceRatingAfter: number | null;
  };
}

// =============================================================================
// Parsing Functions
// =============================================================================

function parseNumber(str: string): number {
  // Handle European decimal format (comma instead of period)
  return parseFloat(str.replace(",", "."));
}

function parseFilterType(type: string): "PEAK" | "LOW_SHELF" | "HIGH_SHELF" | "LOW_PASS" | "HIGH_PASS" {
  const normalized = type.toUpperCase().replace(/[_\s]+/g, "_");
  if (normalized === "PEAK" || normalized === "PK") return "PEAK";
  if (normalized === "LOW_SHELF" || normalized === "LSC" || normalized === "LS") return "LOW_SHELF";
  if (normalized === "HIGH_SHELF" || normalized === "HSC" || normalized === "HS") return "HIGH_SHELF";
  if (normalized === "LOW_PASS" || normalized === "LP") return "LOW_PASS";
  if (normalized === "HIGH_PASS" || normalized === "HP") return "HIGH_PASS";
  throw new Error(`Unknown filter type: ${type}`);
}

function parseFrequency(str: string): number {
  // Handle formats like "20 Hz", "1300 Hz", "11000 Hz"
  const match = str.match(/([\d,\.]+)\s*(?:Hz)?/i);
  if (!match) throw new Error(`Cannot parse frequency: ${str}`);
  return parseNumber(match[1]);
}

function parseGain(str: string): number {
  // Handle formats like "4,0 dB", "-2,5 dB", "4.0 dB"
  const match = str.match(/([-\d,\.]+)\s*(?:dB)?/i);
  if (!match) throw new Error(`Cannot parse gain: ${str}`);
  return parseNumber(match[1]);
}

export function parseOratoryPdfText(text: string): ParsedEQ {

  // Extract product name from "EQ setting for <product>"
  let productName = "Unknown";
  const productMatch = text.match(/EQ setting for\s+(.+?)(?:\n|Preamp)/i);
  if (productMatch) {
    productName = productMatch[1].trim();
  }

  // Extract preamp gain (handles different PDF versions)
  let preampGain = 0;
  // Pattern 1: "Preamp gain: -6.1 dB" (standard format)
  const preampMatch = text.match(/(?:Preamp gain|Pre-gain to avoid clipping):\s*([-\d,\.]+)\s*dB/i);
  if (preampMatch) {
    preampGain = parseNumber(preampMatch[1]);
  } else {
    // Pattern 2: "Preamp gain: ... -6.1 dB" (text extraction sometimes puts extra content between label and value)
    // This handles cases like "Preamp gain: Preference Rating* -7,8 dB"
    const preampMatch2 = text.match(/Preamp gain:.*?([-\d,\.]+)\s*dB/i);
    if (preampMatch2) {
      preampGain = parseNumber(preampMatch2[1]);
    } else {
      // Pattern 3: "-6.1 dB ... Preamp gain:" (alternate format where value comes before label)
      const preampMatch3 = text.match(/([-\d,\.]+)\s*dB\s+(?:Headphone Equalization|Filter Settings).*?Preamp gain:/i);
      if (preampMatch3) {
        preampGain = parseNumber(preampMatch3[1]);
      }
    }
  }

  // Extract version
  let version: string | null = null;
  const versionMatch = text.match(/\bv([\d\.]+)\b/);
  if (versionMatch) {
    version = versionMatch[1];
  }

  // Extract date
  let date: string | null = null;
  const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{2,4})/);
  if (dateMatch) {
    date = dateMatch[1];
  }

  // Extract deviation from target
  // Format in PDF: "1,64 dB 0,29 dB" appears after "Before EQ After EQ" line
  let deviationBefore: number | null = null;
  let deviationAfter: number | null = null;
  // Try pattern where values are on same line with dB units
  const deviationMatch = text.match(/([\d,\.]+)\s*dB\s+([\d,\.]+)\s*dB\s+Adjust gain of band/i);
  if (deviationMatch) {
    deviationBefore = parseNumber(deviationMatch[1]);
    deviationAfter = parseNumber(deviationMatch[2]);
  }

  // Extract preference rating
  // Format in PDF: "84/100 100/100" appears after "Before EQ After EQ"
  let preferenceRatingBefore: number | null = null;
  let preferenceRatingAfter: number | null = null;
  const prefMatch = text.match(/(\d+)\/100\s+(\d+)\/100/i);
  if (prefMatch) {
    preferenceRatingBefore = parseInt(prefMatch[1]);
    preferenceRatingAfter = parseInt(prefMatch[2]);
  }

  // Parse filter settings
  // Look for patterns like "Band 1 PEAK 20 Hz 4,0 dB 1,1 1,27"
  // or "Band 1 LOW_SHELF 105 Hz 5,5 dB 0,71 1,89"
  // or "Band 1 LOW_SHELF 105 Hz 5,5 dB 0,71" (shelf filters without BW)
  // or "Band 7 LOW_PASS 8000 Hz 0,0 dB 0,7 1,92" (low/high pass filters)
  const filters: EQFilter[] = [];

  // Pattern 1: Standard oratory1990 format
  // Band X | Filter Type | Frequency | Gain | Q-Factor | [optional BW]
  // BW is optional because shelf filters often don't have it
  // Note: Q can sometimes have a typo with negative sign (e.g., -0.71 instead of 0.71)
  const filterPattern1 = /Band\s*(\d+)\s+(PEAK|LOW_SHELF|HIGH_SHELF|LOW_PASS|HIGH_PASS|PK|LSC|HSC|LS|HS|LP|HP)\s+([\d,\.]+)\s*Hz\s+([-\d,\.]+)\s*dB\s+([-\d,\.]+)(?:\s+([-\d,\.]+))?/gi;

  let match;
  while ((match = filterPattern1.exec(text)) !== null) {
    const band = parseInt(match[1]);
    const type = parseFilterType(match[2]);
    const frequency = parseNumber(match[3]);
    const gain = parseNumber(match[4]);
    const q = Math.abs(parseNumber(match[5]));  // Take absolute value in case of typo
    // match[6] is BW (bandwidth) - optional, we don't need it since we have Q

    filters.push({ band, type, frequency, gain, q });
  }

  // Pattern 2: Alternate format (e.g., Downfall Audio)
  // Band X | Frequency | Q-Factor | Gain | Filter Type
  if (filters.length === 0) {
    const filterPattern2 = /Band\s*(\d+)\s+([\d,\.]+)\s*Hz\s+([\d,\.]+)\s+([-\d,\.]+)\s*dB\s+(PEAK|LOW_SHELF|HIGH_SHELF|LOW_PASS|HIGH_PASS|PK|LSC|HSC|LS|HS|LP|HP)/gi;

    while ((match = filterPattern2.exec(text)) !== null) {
      const band = parseInt(match[1]);
      const frequency = parseNumber(match[2]);
      const q = parseNumber(match[3]);
      const gain = parseNumber(match[4]);
      const type = parseFilterType(match[5]);

      filters.push({ band, type, frequency, gain, q });
    }
  }

  // Sort filters by band number
  filters.sort((a, b) => a.band - b.band);

  return {
    productName,
    preampGain,
    filters,
    metadata: {
      version,
      date,
      deviationBefore,
      deviationAfter,
      preferenceRatingBefore,
      preferenceRatingAfter,
    },
  };
}

// =============================================================================
// Output Formatting
// =============================================================================

export function formatAsParametricEQ(eq: ParsedEQ): string {
  // Format similar to AutoEQ's ParametricEQ.txt format
  const lines: string[] = [];

  lines.push(`Preamp: ${eq.preampGain.toFixed(1)} dB`);

  for (const filter of eq.filters) {
    const typeAbbrevMap: Record<string, string> = {
      "PEAK": "PK",
      "LOW_SHELF": "LSC",
      "HIGH_SHELF": "HSC",
      "LOW_PASS": "LP",
      "HIGH_PASS": "HP",
    };
    const typeAbbrev = typeAbbrevMap[filter.type] || filter.type;
    lines.push(`Filter ${filter.band}: ON ${typeAbbrev} Fc ${Math.round(filter.frequency)} Hz Gain ${filter.gain.toFixed(1)} dB Q ${filter.q.toFixed(2)}`);
  }

  return lines.join("\n");
}

export function formatAsJSON(eq: ParsedEQ): string {
  return JSON.stringify(eq, null, 2);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = Deno.args;

  if (args.length === 0) {
    console.log("Usage: deno run --allow-read tools/oratory/parse_pdf.ts <pdf_text_file>");
    console.log("\nThis script parses EQ data from Oratory1990 PDF text content.");
    console.log("Pass a file containing the extracted text from a PDF.");
    Deno.exit(1);
  }

  const filePath = args[0];
  const text = await Deno.readTextFile(filePath);

  try {
    const eq = parseOratoryPdfText(text);

    console.log("=".repeat(60));
    console.log(`Product: ${eq.productName}`);
    console.log("=".repeat(60));
    console.log(`\nPreamp Gain: ${eq.preampGain} dB`);
    console.log(`Filters: ${eq.filters.length}`);

    if (eq.metadata.version) {
      console.log(`Version: v${eq.metadata.version}`);
    }
    if (eq.metadata.date) {
      console.log(`Date: ${eq.metadata.date}`);
    }
    if (eq.metadata.deviationBefore !== null) {
      console.log(`Deviation: ${eq.metadata.deviationBefore} dB → ${eq.metadata.deviationAfter} dB`);
    }
    if (eq.metadata.preferenceRatingBefore !== null) {
      console.log(`Preference Rating: ${eq.metadata.preferenceRatingBefore}/100 → ${eq.metadata.preferenceRatingAfter}/100`);
    }

    console.log("\n" + "-".repeat(60));
    console.log("ParametricEQ Format:");
    console.log("-".repeat(60));
    console.log(formatAsParametricEQ(eq));

    console.log("\n" + "-".repeat(60));
    console.log("JSON Format:");
    console.log("-".repeat(60));
    console.log(formatAsJSON(eq));

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error parsing PDF text: ${message}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
