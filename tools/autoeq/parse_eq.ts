/**
 * parse_eq.ts - Parse AutoEQ ParametricEQ.txt files
 *
 * This module extracts EQ filter settings from AutoEQ's ParametricEQ.txt format.
 *
 * Usage:
 *   import { parseParametricEQ, mapTypeToSubtype } from "./parse_eq.ts";
 *   const eq = parseParametricEQ(fileContent);
 */

import { EQBand, EQFilterType, ParsedEQ, ProductSubtype } from "../types.ts";

// =============================================================================
// Parsing Functions
// =============================================================================

/**
 * Maps AutoEQ filter type abbreviations to our schema types.
 */
function mapFilterType(typeShort: string): EQFilterType {
  switch (typeShort.toUpperCase()) {
    case "LSC":
      return "low_shelf";
    case "HSC":
      return "high_shelf";
    case "PK":
      return "peak_dip";
    case "LP":
      return "low_pass";
    case "HP":
      return "high_pass";
    default:
      return "peak_dip";
  }
}

/**
 * Parses a ParametricEQ.txt file content into a ParsedEQ object.
 */
export function parseParametricEQ(content: string): ParsedEQ {
  const lines = content.split("\n").map((line) => line.trim()).filter((line) => line);
  let preamp = 0;
  const filters: EQBand[] = [];

  for (const line of lines) {
    if (line.startsWith("Preamp:")) {
      const match = line.match(/Preamp:\s*([-\d.]+)\s*dB/i);
      if (match) {
        preamp = parseFloat(match[1]);
      }
    } else if (line.startsWith("Filter")) {
      const filterMatch = line.match(
        /Filter\s+\d+:\s+ON\s+(\w+)\s+Fc\s+(\d+)\s+Hz\s+Gain\s+([-\d.]+)\s+dB(?:\s+Q\s+([-\d.]+))?/i
      );
      if (filterMatch) {
        const [, typeShort, freq, gain, q] = filterMatch;
        const type = mapFilterType(typeShort);

        const parameter: EQBand = {
          type,
          frequency: parseFloat(freq),
          gain_db: parseFloat(gain),
        };

        if (type === "peak_dip" || type === "low_shelf" || type === "high_shelf") {
          parameter.q = q !== undefined ? parseFloat(q) : undefined;
        }

        filters.push(parameter);
      }
    }
  }

  return { preamp, filters };
}

/**
 * Maps AutoEQ directory type to schema subtype.
 */
export function mapTypeToSubtype(type: string): ProductSubtype {
  switch (type.toLowerCase()) {
    case "in-ear":
    case "in_ear":
      return "in_ear";
    case "over-ear":
    case "over_the_ear":
      return "over_the_ear";
    case "on-ear":
    case "on_ear":
      return "on_ear";
    case "earbud":
    case "earbuds":
      return "earbuds";
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}
