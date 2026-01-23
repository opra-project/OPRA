import { KNOWN_VENDORS, VENDOR_ALIASES } from "./known_vendors.ts";

// =============================================================================
// String Utilities
// =============================================================================

/**
 * Converts a string to title case.
 */
export function toTitleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Converts a string to a URL/filesystem-safe slug.
 */
export function generateSlug(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s\-()]+/g, "_")
    .replace(/[^\w_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// =============================================================================
// Vendor/Product Splitting
// =============================================================================

export interface VendorProductSplit {
  vendorName: string;
  productName: string;
}

/**
 * Splits a full product name into vendor and product components using pattern matching.
 * Uses the KNOWN_VENDORS list for fast, deterministic, offline splitting.
 *
 * @param fullName - The full product name (e.g., "Sennheiser HD 650")
 * @returns Object with vendorName and productName, or null if no vendor matched
 *
 * @example
 * splitVendorProduct("Sennheiser HD 650")
 * // => { vendorName: "Sennheiser", productName: "HD 650" }
 *
 * splitVendorProduct("64 Audio U12t")
 * // => { vendorName: "64 Audio", productName: "U12t" }
 */
export function splitVendorProduct(fullName: string): VendorProductSplit | null {
  const normalizedName = fullName.trim();

  // Try to match against known vendors (sorted longest-first for greedy matching)
  for (const vendor of KNOWN_VENDORS) {
    // Case-insensitive prefix match
    if (normalizedName.toLowerCase().startsWith(vendor.toLowerCase())) {
      const remainder = normalizedName.slice(vendor.length).trim();

      // If there's no product name after the vendor, skip this match
      if (!remainder) continue;

      // Get canonical vendor name (resolve aliases)
      const canonicalVendor = VENDOR_ALIASES[vendor] ?? vendor;

      return {
        vendorName: canonicalVendor,
        productName: remainder,
      };
    }
  }

  return null;
}

/**
 * Splits a product name, falling back to "Unknown" vendor if no match found.
 *
 * @param fullName - The full product name
 * @returns Object with vendorName and productName (never null)
 */
export function splitVendorProductOrUnknown(fullName: string): VendorProductSplit {
  const result = splitVendorProduct(fullName);
  if (result) return result;

  // No vendor matched - use "Unknown" as vendor, full name as product
  return {
    vendorName: "Unknown",
    productName: fullName.trim(),
  };
}

