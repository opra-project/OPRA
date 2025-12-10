/**
 * types.ts - Shared TypeScript interfaces for OPRA tools
 *
 * This module contains type definitions used across the import pipeline.
 * All types are based on the JSON schemas in schemas/ directory.
 */

// =============================================================================
// Vendor Types
// =============================================================================

export interface VendorInfo {
  name: string;
  official_name?: string;
  blurb?: string;
  logo?: string;
}

// =============================================================================
// Product Types
// =============================================================================

export type ProductType = "headphones";
export type ProductSubtype = "over_the_ear" | "on_ear" | "in_ear" | "earbuds" | "unknown";

export interface ProductInfo {
  vendor_id?: string;
  name: string;
  blurb?: string;
  line_art_svg?: string;
  line_art_96x64_png?: string;
  photo?: string;
  type: ProductType;
  subtype: ProductSubtype;
}

// =============================================================================
// EQ Types
// =============================================================================

export type EQFilterType =
  | "peak_dip"
  | "high_shelf"
  | "low_shelf"
  | "low_pass"
  | "high_pass"
  | "band_pass"
  | "band_stop";

export type EQSlope = 6 | 12 | 18 | 24 | 30 | 36;

export interface EQBand {
  type: EQFilterType;
  frequency: number;
  gain_db?: number;
  q?: number;
  slope?: EQSlope;
}

export interface EQParameters {
  gain_db: number;
  bands: EQBand[];
}

export interface EQInfo {
  product_id?: string;
  author: string;
  details: string;
  link?: string;
  type: "parametric_eq";
  parameters: EQParameters;
}

// =============================================================================
// Parsing Types
// =============================================================================

/**
 * Intermediate representation of parsed EQ data before conversion to EQInfo
 */
export interface ParsedEQ {
  preamp: number;
  filters: EQBand[];
}

/**
 * Result of parsing a PDF filename
 */
export interface ParsedFilename {
  vendor: string;
  product: string;
  extra?: string;
  target: string;
}

/**
 * Result of vendor/model name splitting
 */
export interface VendorModelSplit {
  vendorName: string;
  productName: string;
}
