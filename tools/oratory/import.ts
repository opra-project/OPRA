/**
 * tools/oratory/import.ts - Oratory import module
 *
 * Processes Oratory1990 PDFs and writes to database.
 * Uses local PDF text extraction via unpdf library.
 * Can be used as a module or run standalone.
 */

import { join, basename } from "https://deno.land/std@0.203.0/path/mod.ts";
import { walk } from "https://deno.land/std@0.203.0/fs/walk.ts";
import { exists } from "https://deno.land/std@0.203.0/fs/mod.ts";

import { extractTextFromPdf } from "./extract_text.ts";
import { parseOratoryPdfText } from "./parse_pdf.ts";
import { generateSlug, splitVendorProductOrUnknown } from "../utils.ts";
import { VendorInfo, ProductInfo, EQInfo } from "../types.ts";

// =============================================================================
// Types
// =============================================================================

export interface ImportStats {
  newVendors: number;
  newProducts: number;
  newEqs: number;
  updatedEqs: number;
  unchangedEqs: number;
  errors: number;
}

export interface ImportResult {
  stats: ImportStats;
  unknownTypes: string[];
  errors: { file: string; message: string }[];
}

export interface ImportOptions {
  dryRun?: boolean;
  verbose?: boolean;
  onProgress?: (message: string) => void;
}

// =============================================================================
// Filename Parsing
// =============================================================================

interface ParsedFilename {
  vendor: string;
  product: string;
  variant: string | null;
  target: string;
}

/**
 * Parse an Oratory PDF filename to extract vendor, product, variant, and target.
 *
 * Filename formats:
 * - "Sennheiser HD 650.pdf" -> vendor: Sennheiser, product: HD 650, target: Harman
 * - "Sony WH-1000XM4 (ANC on).pdf" -> variant: ANC on
 * - "Beyerdynamic DT 880 (oratory1990 target).pdf" -> target: oratory1990
 * - "AKG K371 (Harman target).pdf" -> target: Harman
 */
function parseFilename(filename: string): ParsedFilename {
  // Remove .pdf extension
  let name = filename.replace(/\.pdf$/i, "");

  // Extract target curve from parentheses if present
  let target = "harman"; // default
  let variant: string | null = null;

  // Check for target in parentheses: (Harman target), (oratory1990 target), (crinacle target)
  const targetMatch = name.match(/\(([^)]*target[^)]*)\)/i);
  if (targetMatch) {
    const targetStr = targetMatch[1].toLowerCase();
    if (targetStr.includes("crinacle")) {
      target = "crinacle";
    } else if (targetStr.includes("oratory") || targetStr.includes("1990")) {
      target = "oratory1990";
    } else if (targetStr.includes("usound")) {
      target = "usound";
    } else {
      target = "harman";
    }
    // Remove target from name
    name = name.replace(targetMatch[0], "").trim();
  }

  // Check for variant in remaining parentheses: (velour pads), (ANC on), etc.
  const variantMatch = name.match(/\(([^)]+)\)/);
  if (variantMatch) {
    variant = variantMatch[1].trim();
    name = name.replace(variantMatch[0], "").trim();
  }

  // Split into vendor and product using known vendors list
  const { vendorName, productName } = splitVendorProductOrUnknown(name);

  return {
    vendor: vendorName,
    product: productName,
    variant,
    target,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function createEmptyStats(): ImportStats {
  return {
    newVendors: 0,
    newProducts: 0,
    newEqs: 0,
    updatedEqs: 0,
    unchangedEqs: 0,
    errors: 0,
  };
}

/**
 * Convert parsed EQ data to our EQInfo format
 */
function convertToEQInfo(
  parsed: ReturnType<typeof parseOratoryPdfText>,
  target: string,
  variant: string | null
): EQInfo {
  // Map filter types from parse_pdf format to our schema format
  const bands = parsed.filters.map((f) => {
    const typeMap: Record<string, "peak_dip" | "low_shelf" | "high_shelf" | "low_pass" | "high_pass"> = {
      PEAK: "peak_dip",
      LOW_SHELF: "low_shelf",
      HIGH_SHELF: "high_shelf",
      LOW_PASS: "low_pass",
      HIGH_PASS: "high_pass",
    };

    return {
      type: typeMap[f.type] || "peak_dip",
      frequency: f.frequency,
      gain_db: f.gain,
      q: f.q,
    };
  });

  const details = variant
    ? `${target} target - ${variant}`
    : `${target} target`;

  return {
    author: "oratory1990",
    details,
    type: "parametric_eq",
    parameters: {
      gain_db: parsed.preampGain,
      bands,
    },
  };
}

// =============================================================================
// Main Import Function
// =============================================================================

/**
 * Import Oratory data from a source directory into the target database directory.
 *
 * @param srcDir - Path to Oratory PDFs directory
 * @param targetDir - Path to database directory
 * @param options - Import options
 */
export async function importOratory(
  srcDir: string,
  targetDir: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const { dryRun = false, verbose = false, onProgress } = options;

  const log = (message: string) => {
    if (verbose) {
      console.log(`[${new Date().toISOString()}] ${message}`);
    }
    onProgress?.(message);
  };

  const stats = createEmptyStats();
  const unknownTypes: string[] = [];
  const errors: { file: string; message: string }[] = [];

  log(`Starting Oratory import from "${srcDir}" to "${targetDir}"`);

  // Collect all PDF files
  const pdfFiles: string[] = [];
  try {
    for await (const entry of walk(srcDir, { exts: [".pdf"] })) {
      pdfFiles.push(entry.path);
    }
  } catch (err) {
    const message = `Could not walk source directory "${srcDir}": ${err}`;
    log(message);
    errors.push({ file: srcDir, message });
    stats.errors++;
    return { stats, unknownTypes, errors };
  }

  log(`Found ${pdfFiles.length} PDF files to process`);

  if (dryRun) {
    log(`[DRY-RUN] Would process ${pdfFiles.length} PDFs`);
    stats.newEqs = pdfFiles.length;
    return { stats, unknownTypes, errors };
  }

  // Track seen vendors/products
  const seenVendors = new Set<string>();
  const seenProducts = new Set<string>();

  // Process each PDF
  for (const pdfPath of pdfFiles) {
    const filename = basename(pdfPath);
    log(`Processing: ${filename}`);

    try {
      // Parse filename for metadata
      const parsed = parseFilename(filename);
      log(`  Vendor: ${parsed.vendor}, Product: ${parsed.product}, Target: ${parsed.target}`);

      // Extract text from PDF
      const text = await extractTextFromPdf(pdfPath);

      // Parse EQ data from text
      const eqData = parseOratoryPdfText(text);

      if (eqData.filters.length === 0) {
        log(`  Warning: No filters found in ${filename}`);
        errors.push({ file: pdfPath, message: "No filters found in PDF" });
        stats.errors++;
        continue;
      }

      log(`  Found ${eqData.filters.length} filters, preamp: ${eqData.preampGain} dB`);

      // Generate slugs
      const vendorSlug = generateSlug(parsed.vendor);
      const productSlug = generateSlug(parsed.product);
      const variantSlug = parsed.variant ? `_${generateSlug(parsed.variant)}` : "";
      const eqSlug = `oratory1990_${parsed.target}_target${variantSlug}`;

      // Define paths
      const vendorPath = join(targetDir, "vendors", vendorSlug);
      const productPath = join(vendorPath, "products", productSlug);
      const eqPath = join(productPath, "eq", eqSlug);
      const eqInfoPath = join(eqPath, "info.json");

      // Check if EQ already exists
      if (await exists(eqInfoPath)) {
        log(`  Skipping - EQ already exists: ${eqSlug}`);
        stats.unchangedEqs++;
        continue;
      }

      // Create directories
      await Deno.mkdir(eqPath, { recursive: true });

      // Write vendor info if new
      if (!seenVendors.has(vendorSlug)) {
        seenVendors.add(vendorSlug);
        const vendorInfoPath = join(vendorPath, "info.json");
        if (!(await exists(vendorInfoPath))) {
          const vendorInfo: VendorInfo = { name: parsed.vendor };
          await Deno.writeTextFile(vendorInfoPath, JSON.stringify(vendorInfo, null, 2));
          stats.newVendors++;
          log(`  Created vendor: ${parsed.vendor}`);
        }
      }

      // Write product info if new
      const productKey = `${vendorSlug}::${productSlug}`;
      if (!seenProducts.has(productKey)) {
        seenProducts.add(productKey);
        const productInfoPath = join(productPath, "info.json");
        if (!(await exists(productInfoPath))) {
          const productInfo: ProductInfo = {
            name: parsed.product,
            type: "headphones",
            subtype: "unknown" as const,
          };
          await Deno.writeTextFile(productInfoPath, JSON.stringify(productInfo, null, 2));
          stats.newProducts++;
          unknownTypes.push(productKey);
          log(`  Created product: ${parsed.product} (subtype unknown)`);
        }
      }

      // Write EQ info
      const eqInfo = convertToEQInfo(eqData, parsed.target, parsed.variant);
      await Deno.writeTextFile(eqInfoPath, JSON.stringify(eqInfo, null, 2));
      stats.newEqs++;
      log(`  Created EQ: ${eqSlug}`);

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  Error: ${message}`);
      errors.push({ file: pdfPath, message });
      stats.errors++;
    }
  }

  log(`Oratory import completed.`);
  return { stats, unknownTypes, errors };
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const args = Deno.args;
  if (args.length < 2) {
    console.error("Usage: deno run --allow-read --allow-write tools/oratory/import.ts <source_dir> <target_dir>");
    console.error("Example: deno run --allow-read --allow-write tools/oratory/import.ts sources/oratory/PDFs database");
    Deno.exit(1);
  }

  const srcDir = args[0];
  const targetDir = args[1];

  const result = await importOratory(srcDir, targetDir, { verbose: true });

  console.log("\n=== Import Summary ===");
  console.log(`New vendors:   ${result.stats.newVendors}`);
  console.log(`New products:  ${result.stats.newProducts}`);
  console.log(`New EQs:       ${result.stats.newEqs}`);
  console.log(`Unchanged:     ${result.stats.unchangedEqs}`);
  console.log(`Errors:        ${result.stats.errors}`);

  if (result.unknownTypes.length > 0) {
    console.log(`\nProducts with unknown subtype: ${result.unknownTypes.length}`);
  }

  if (result.errors.length > 0) {
    console.log(`\nErrors:`);
    for (const err of result.errors.slice(0, 10)) {
      console.log(`  ${err.file}: ${err.message}`);
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`);
    }
  }

  Deno.exit(result.stats.errors > 0 ? 1 : 0);
}
