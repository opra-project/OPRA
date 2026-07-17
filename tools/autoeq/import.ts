/**
 * tools/autoeq/import.ts - AutoEQ import module
 *
 * Processes AutoEQ ParametricEQ.txt files and writes to database.
 * Can be used as a module or run standalone.
 */

import { basename, dirname, fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { exists } from "https://deno.land/std@0.224.0/fs/mod.ts";

import { EQInfo, ProductInfo, VendorInfo } from "../types.ts";
import { mapTypeToSubtype, parseParametricEQ } from "./parse_eq.ts";
import {
  applySlugRemap,
  generateSlug,
  loadCorrections,
  normalizeTextForComparison,
  splitVendorProductOrUnknown,
} from "../utils.ts";
import {
  loadProductCatalog,
  resolveCatalogProduct,
  splitCatalogVendorProduct,
} from "../product_catalog.ts";

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

// =============================================================================
// Main Import Function
// =============================================================================

/**
 * Import AutoEQ data from a source directory into the target database directory.
 *
 * @param srcDir - Path to AutoEQ results directory (e.g., sources/autoeq/results)
 * @param targetDir - Path to database directory (e.g., database)
 * @param options - Import options
 */
export async function importAutoEQ(
  srcDir: string,
  targetDir: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const { dryRun = false, verbose = false, onProgress } = options;

  const correctionsPath = join(dirname(fromFileUrl(import.meta.url)), "corrections.json");
  const corrections = await loadCorrections(correctionsPath);
  const slugRemaps = corrections.slug_remaps;

  const log = (message: string) => {
    if (verbose) {
      console.log(`[${new Date().toISOString()}] ${message}`);
    }
    onProgress?.(message);
  };

  const stats = createEmptyStats();
  const unknownTypes: string[] = [];
  const errors: { file: string; message: string }[] = [];
  const catalog = await loadProductCatalog(targetDir, slugRemaps);

  log(`Starting AutoEQ import from "${srcDir}" to "${targetDir}"`);
  log(
    `Loaded ${catalog.vendors.length} vendors and ${catalog.products.length} products from the target catalog`,
  );

  // Track seen vendors/products to count new vs existing
  const seenVendors = new Set<string>();
  const seenProducts = new Set<string>();
  const seenSourceProfiles = new Map<string, Array<{ signature: string; eqSlug: string }>>();

  const eqFiles: string[] = [];
  for await (const entry of walk(srcDir, { exts: [".txt"], includeFiles: true })) {
    if (basename(entry.path).endsWith("ParametricEQ.txt")) eqFiles.push(entry.path);
  }
  eqFiles.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

  // Process sources deterministically so colliding source profiles get stable IDs.
  for (const entryPath of eqFiles) {
    const fileName = basename(entryPath);

    log(`Processing EQ file: "${entryPath}"`);

    // Extract paths
    const relativePath = entryPath
      .replace(srcDir, "")
      .replace(/^\/+/, "")
      .split(Deno.build.os === "windows" ? "\\" : "/");

    // Remove any leading empty strings
    while (relativePath.length > 0 && relativePath[0] === "") {
      relativePath.shift();
    }

    if (relativePath.length < 3) {
      log(`    Skipping invalid path: "${entryPath}" (insufficient path depth)`);
      continue;
    }

    const measurer = relativePath[0];
    let type: string;

    // Determine if the second segment is a type or part of the product directory
    const possibleType = relativePath[1].toLowerCase();
    const typeOptions = ["in-ear", "over-ear", "on-ear", "earbud", "earbuds"];

    if (typeOptions.includes(possibleType)) {
      type = possibleType;
    } else {
      // Check for equipment folder like "GRAS 43AG-7 over-ear"
      const typeMatch = relativePath[1].match(/(in-ear|over-ear|on-ear|earbud|earbuds)/i);
      if (typeMatch && relativePath.length >= 4) {
        type = typeMatch[1].toLowerCase();
        log(`    Extracted type "${type}" from equipment folder "${relativePath[1]}".`);
      } else {
        log(`    Unable to determine type from path: "${entryPath}"`);
        unknownTypes.push(entryPath);
        continue;
      }
    }

    let productNameWithoutSuffix = fileName.replace(" ParametricEQ.txt", "");

    // Apply name corrections before variant extraction (exact match)
    if (corrections.name_corrections[productNameWithoutSuffix]) {
      const corrected = corrections.name_corrections[productNameWithoutSuffix];
      log(`    Name correction: "${productNameWithoutSuffix}" -> "${corrected}"`);
      productNameWithoutSuffix = corrected;
    }

    // Extract variant info from parentheses
    const variantMatch = productNameWithoutSuffix.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    const fullProductName = variantMatch ? variantMatch[1].trim() : productNameWithoutSuffix;
    const variantInfo = variantMatch ? variantMatch[2].trim() : null;

    // Reuse canonical catalog identities before falling back to name splitting.
    const catalogProduct = resolveCatalogProduct(catalog, fullProductName);
    const catalogVendor = catalogProduct
      ? null
      : splitCatalogVendorProduct(catalog, fullProductName);
    const fallback = catalogProduct || catalogVendor
      ? null
      : splitVendorProductOrUnknown(fullProductName);
    const vendorName = catalogProduct?.vendorName ?? catalogVendor?.vendorName ??
      fallback!.vendorName;
    const productName = catalogProduct?.productName ?? catalogVendor?.productName ??
      fallback!.productName;
    let vendorSlug = catalogProduct?.vendorSlug ?? catalogVendor?.vendorSlug ??
      generateSlug(vendorName);
    let productSlug = catalogProduct?.productSlug ?? generateSlug(productName);

    if (catalogProduct) {
      log(
        `    Catalog ${catalogProduct.match} match: ${catalogProduct.vendorSlug}::${catalogProduct.productSlug}`,
      );
    } else if (catalogVendor) {
      log(`    Catalog vendor match: ${catalogVendor.vendorSlug}`);
    }

    // Apply slug remaps
    const remapped = applySlugRemap(vendorSlug, productSlug, slugRemaps);
    if (remapped.vendorSlug !== vendorSlug || remapped.productSlug !== productSlug) {
      log(
        `    Slug remap: ${vendorSlug}::${productSlug} -> ${remapped.vendorSlug}::${remapped.productSlug}`,
      );
      vendorSlug = remapped.vendorSlug;
      productSlug = remapped.productSlug;
    }

    // Define target paths
    const vendorPath = join(targetDir, "vendors", vendorSlug);
    const vendorInfoPath = join(vendorPath, "info.json");
    const productsPath = join(vendorPath, "products");
    const productPath = join(productsPath, productSlug);
    const productInfoPath = join(productPath, "info.json");
    const eqPath = join(productPath, "eq");
    const baseEqSlug = variantInfo
      ? `autoeq_${generateSlug(measurer)}_${generateSlug(variantInfo)}`
      : `autoeq_${generateSlug(measurer)}`;

    // Read and parse ParametricEQ.txt
    let eqContent: string;
    try {
      eqContent = await Deno.readTextFile(entryPath);
    } catch (error) {
      const message = `Failed to read EQ file: ${error}`;
      log(`    ${message}`);
      errors.push({ file: entryPath, message });
      stats.errors++;
      continue;
    }

    const parsedEQ = parseParametricEQ(eqContent);
    const profileKey = `${vendorSlug}::${productSlug}::${baseEqSlug}`;
    const profiles = seenSourceProfiles.get(profileKey) ?? [];
    const signature = JSON.stringify({
      gain_db: parsedEQ.preamp,
      bands: parsedEQ.filters,
    });
    const duplicate = profiles.find((profile) => profile.signature === signature);
    if (duplicate) {
      stats.unchangedEqs++;
      log(`    Duplicate source EQ matches "${duplicate.eqSlug}"; skipping ${entryPath}`);
      continue;
    }

    let eqSlug = baseEqSlug;
    if (profiles.length > 0) {
      const sourceSuffix = generateSlug(relativePath[1]) || `source_${profiles.length + 1}`;
      eqSlug = `${baseEqSlug}_${sourceSuffix}`;
      let suffixIndex = 2;
      while (profiles.some((profile) => profile.eqSlug === eqSlug)) {
        eqSlug = `${baseEqSlug}_${sourceSuffix}_${suffixIndex}`;
        suffixIndex++;
      }
    }
    profiles.push({ signature, eqSlug });
    seenSourceProfiles.set(profileKey, profiles);

    const eqInfoPath = join(eqPath, eqSlug, "info.json");

    log(`    Vendor: "${vendorName}" (${vendorSlug})`);
    log(`    Product: "${productName}" (${productSlug})`);
    log(`    EQ slug: "${eqSlug}"`);

    if (dryRun) {
      log(`    [DRY-RUN] Would write to ${eqInfoPath}`);
      stats.newEqs++;
      continue;
    }

    // Ensure directories exist
    await Deno.mkdir(join(eqPath, eqSlug), { recursive: true });

    // Construct EQInfo
    const sourceContext = eqSlug === baseEqSlug ? "" : ` using ${relativePath[1]}`;
    const eqInfo: EQInfo = {
      author: "AutoEQ",
      details: variantInfo
        ? `Measured by ${measurer}${sourceContext} (${variantInfo})`
        : `Measured by ${measurer}${sourceContext}`,
      type: "parametric_eq",
      parameters: {
        gain_db: parsedEQ.preamp,
        bands: parsedEQ.filters,
      },
    };

    // Check if EQ already exists and compare content
    const newJson = JSON.stringify(eqInfo, null, 2) + "\n";

    if (await exists(eqInfoPath)) {
      let existingJson: string;
      try {
        existingJson = await Deno.readTextFile(eqInfoPath);
      } catch (error) {
        const message = `Failed to read existing EQ info.json: ${error}`;
        log(`    ${message}`);
        errors.push({ file: eqInfoPath, message });
        stats.errors++;
        continue;
      }
      if (
        normalizeTextForComparison(existingJson) === normalizeTextForComparison(newJson)
      ) {
        stats.unchangedEqs++;
        log(`    Unchanged: ${eqInfoPath}`);
      } else {
        try {
          await Deno.writeTextFile(eqInfoPath, newJson);
          stats.updatedEqs++;
          log(`    Updated EQ info.json at "${eqInfoPath}"`);
        } catch (error) {
          const message = `Failed to write EQ info.json: ${error}`;
          log(`    ${message}`);
          errors.push({ file: eqInfoPath, message });
          stats.errors++;
          continue;
        }
      }
    } else {
      try {
        await Deno.writeTextFile(eqInfoPath, newJson);
        stats.newEqs++;
        log(`    Wrote EQ info.json at "${eqInfoPath}"`);
      } catch (error) {
        const message = `Failed to write EQ info.json: ${error}`;
        log(`    ${message}`);
        errors.push({ file: eqInfoPath, message });
        stats.errors++;
        continue;
      }
    }

    // Write Product info.json if it doesn't exist
    const productKey = `${vendorSlug}::${productSlug}`;
    if (!seenProducts.has(productKey)) {
      seenProducts.add(productKey);

      const productExists = await exists(productInfoPath);
      if (!productExists) {
        const productInfo: ProductInfo = {
          name: productName,
          type: "headphones",
          subtype: mapTypeToSubtype(type),
        };

        try {
          await Deno.mkdir(productPath, { recursive: true });
          await Deno.writeTextFile(productInfoPath, JSON.stringify(productInfo, null, 2) + "\n");
          stats.newProducts++;
          log(`    Wrote Product info.json at "${productInfoPath}"`);
        } catch (error) {
          const message = `Failed to write Product info.json: ${error}`;
          log(`    ${message}`);
          errors.push({ file: productInfoPath, message });
          stats.errors++;
        }
      }
    }

    // Write Vendor info.json if it doesn't exist
    if (!seenVendors.has(vendorSlug)) {
      seenVendors.add(vendorSlug);

      const vendorExists = await exists(vendorInfoPath);
      if (!vendorExists) {
        const vendorInfo: VendorInfo = {
          name: vendorName,
        };

        try {
          await Deno.writeTextFile(vendorInfoPath, JSON.stringify(vendorInfo, null, 2) + "\n");
          stats.newVendors++;
          log(`    Wrote Vendor info.json at "${vendorInfoPath}"`);
        } catch (error) {
          const message = `Failed to write Vendor info.json: ${error}`;
          log(`    ${message}`);
          errors.push({ file: vendorInfoPath, message });
          stats.errors++;
        }
      }
    }
  }

  log(`AutoEQ import completed.`);
  return { stats, unknownTypes, errors };
}

// =============================================================================
// CLI Entry Point
// =============================================================================

if (import.meta.main) {
  const args = Deno.args;
  if (args.length < 2) {
    console.error(
      "Usage: deno run --allow-read --allow-write tools/autoeq/import.ts <source_dir> <target_dir>",
    );
    console.error(
      "Example: deno run --allow-read --allow-write tools/autoeq/import.ts sources/autoeq/results database",
    );
    Deno.exit(1);
  }

  const srcDir = args[0];
  const targetDir = args[1];

  // Validate source directory
  try {
    const srcStat = await Deno.stat(srcDir);
    if (!srcStat.isDirectory) {
      console.error(`Source path "${srcDir}" is not a directory.`);
      Deno.exit(1);
    }
  } catch (error) {
    console.error(`Failed to access source directory "${srcDir}": ${error}`);
    Deno.exit(1);
  }

  // Create target directory if needed
  try {
    await Deno.mkdir(targetDir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create target directory "${targetDir}": ${error}`);
    Deno.exit(1);
  }

  const result = await importAutoEQ(srcDir, targetDir, { verbose: true });

  console.log("\n=== Import Summary ===");
  console.log(`New vendors:   ${result.stats.newVendors}`);
  console.log(`New products:  ${result.stats.newProducts}`);
  console.log(`New EQs:       ${result.stats.newEqs}`);
  console.log(`Updated EQs:   ${result.stats.updatedEqs}`);
  console.log(`Errors:        ${result.stats.errors}`);

  if (result.unknownTypes.length > 0) {
    console.log(`\nUnknown types: ${result.unknownTypes.length}`);
  }

  Deno.exit(result.stats.errors > 0 ? 1 : 0);
}
