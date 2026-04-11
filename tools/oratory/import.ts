/**
 * tools/oratory/import.ts - CSV-driven Oratory1990 import module
 *
 * Reads a semicolon-delimited CSV with Brand, Model, Comment, Target, Link columns.
 * Downloads PDFs from Dropbox links, parses EQ data, and writes to database.
 */

import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { exists } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { parse as parseCsv } from "https://deno.land/std@0.224.0/csv/mod.ts";

import { extractTextFromPdf } from "./extract_text.ts";
import { parseOratoryPdfText, extractTargetFromPdfText } from "./parse_pdf.ts";
import { generateSlug } from "../utils.ts";
import { VendorInfo, ProductInfo, ProductSubtype, EQInfo } from "../types.ts";
import { VENDOR_ALIASES } from "../known_vendors.ts";

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
  csvPath: string;
  cacheDir?: string;
  concurrency?: number; // Max parallel downloads (default: 3)
  dryRun?: boolean;
  verbose?: boolean;
  onProgress?: (message: string) => void;
}

interface CsvRow {
  Brand: string;
  Model: string;
  Comment: string;
  Target: string;
  Link: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CACHE_DIR = join(
  Deno.env.get("OPRA_CACHE_DIR") || Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || ".",
  ".cache",
  "opra",
  "oratory_pdfs"
);

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]); // %PDF-

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
 * Extract the PDF filename from a Dropbox URL.
 */
function extractFilenameFromUrl(url: string): string | null {
  const match = url.match(/\/([^/]+\.pdf)\?/i);
  if (match) return decodeURIComponent(match[1]);
  return null;
}

/**
 * Convert Dropbox share URL to direct download URL.
 */
function toDirectDownloadUrl(url: string): string {
  return url.replace(/([?&])dl=0/, "$1dl=1");
}

/**
 * Determine the target curve for Target=3 rows by inspecting the PDF filename in the URL.
 * Returns null if the filename has no recognizable target qualifier.
 */
function extractTargetFromUrl(url: string): string | null {
  const filename = extractFilenameFromUrl(url) || url;
  const lower = filename.toLowerCase();
  // Only match explicit target qualifiers in the filename.
  // Don't match bare "oratory" — almost every PDF contains it as the author name.
  // For ambiguous filenames, return null to let extractTargetFromPdfText() resolve it.
  if (lower.includes("usound")) return "usound";
  if (lower.includes("oratory1990 target") || lower.includes("oratory1990_target")) return "oratory1990";
  return null;
}

/**
 * Map CSV Target field to product subtype and target curve name.
 * For Target=3, targetCurve may be null if the URL filename is ambiguous
 * (will be resolved later from PDF content).
 */
function mapTarget(
  targetField: string,
  link: string
): { subtype: ProductSubtype; targetCurve: string | null } {
  switch (targetField) {
    case "1":
      return { subtype: "over_the_ear", targetCurve: "harman" };
    case "2":
      return { subtype: "in_ear", targetCurve: "harman" };
    case "3":
      return { subtype: "in_ear", targetCurve: extractTargetFromUrl(link) };
    default:
      return { subtype: "unknown", targetCurve: "harman" };
  }
}

/**
 * Build the human-readable details string for an EQ entry.
 * Format: "Harman Target" or "USound Target • ANC on"
 */
function buildDetails(targetCurve: string, comment: string): string {
  const targetLabel =
    targetCurve === "harman"
      ? "Harman Target"
      : targetCurve === "usound"
        ? "USound Target"
        : targetCurve === "oratory1990"
          ? "oratory1990 Target"
          : `${targetCurve} Target`;

  if (!comment || comment === "0") return targetLabel;
  return `${targetLabel} \u2022 ${comment}`;
}

/**
 * Download a PDF from Dropbox with retry and caching.
 */
async function downloadPdf(
  url: string,
  cacheDir: string,
  log: (msg: string) => void
): Promise<string | null> {
  const filename = extractFilenameFromUrl(url);
  if (!filename) {
    log(`  Could not extract filename from URL: ${url}`);
    return null;
  }

  const localPath = join(cacheDir, filename);

  // Check cache — validate it's actually a PDF (previous runs may have cached HTML)
  try {
    const file = await Deno.open(localPath, { read: true });
    try {
      const header = new Uint8Array(5);
      const bytesRead = await file.read(header);
      if (bytesRead === 5 && PDF_MAGIC.every((b, i) => header[i] === b)) {
        log(`  Cached: ${filename}`);
        return localPath;
      }
    } finally {
      file.close();
    }
    log(`  Stale cache (not a valid PDF), re-downloading: ${filename}`);
    await Deno.remove(localPath);
  } catch {
    // Not cached, download
  }

  const directUrl = toDirectDownloadUrl(url);
  log(`  Downloading: ${filename}`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(directUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
      });

      if (!response.ok) {
        if (attempt === 3) {
          log(`  HTTP ${response.status}: ${response.statusText}`);
          return null;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }

      const data = new Uint8Array(await response.arrayBuffer());

      // Validate the response is actually a PDF (Dropbox returns HTML on rate limit)
      const isPdf = data.length >= 5 && PDF_MAGIC.every((b, i) => data[i] === b);
      if (!isPdf) {
        if (attempt === 3) {
          log(`  Not a valid PDF (likely rate-limited): ${filename}`);
          return null;
        }
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }

      await Deno.writeFile(localPath, data);
      log(`  Downloaded: ${filename} (${(data.length / 1024).toFixed(1)}KB)`);
      // Delay after successful download to avoid Dropbox rate limiting
      await new Promise((r) => setTimeout(r, 300));
      return localPath;
    } catch (err) {
      if (attempt === 3) {
        log(`  Network error: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }

  return null;
}

/**
 * Download multiple PDFs in parallel with a concurrency limit.
 * Returns a Map from Dropbox URL → local file path (or null on failure).
 */
async function downloadAllPdfs(
  urls: string[],
  cacheDir: string,
  concurrency: number,
  log: (msg: string) => void
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  const total = urls.length;
  let completed = 0;

  // Worker pool: N workers pull from a shared queue
  const queue = [...urls];

  async function worker() {
    while (true) {
      const url = queue.shift();
      if (!url) return;
      try {
        const path = await downloadPdf(url, cacheDir, (msg) => {
          log(`  [${++completed}/${total}] ${msg.trimStart()}`);
        });
        results.set(url, path);
      } catch {
        results.set(url, null);
      }
    }
  }

  log(`Downloading ${total} PDFs (concurrency: ${concurrency})...`);
  const workers = Array.from({ length: Math.min(concurrency, total) }, () => worker());
  await Promise.all(workers);

  const succeeded = [...results.values()].filter((v) => v !== null).length;
  log(`Downloads complete: ${succeeded} succeeded, ${total - succeeded} failed`);
  return results;
}

/**
 * Convert parsed EQ data to our EQInfo format.
 */
function convertToEQInfo(
  parsed: ReturnType<typeof parseOratoryPdfText>,
  targetCurve: string,
  comment: string,
  link: string
): EQInfo {
  const typeMap: Record<string, "peak_dip" | "low_shelf" | "high_shelf" | "low_pass" | "high_pass"> = {
    PEAK: "peak_dip",
    LOW_SHELF: "low_shelf",
    HIGH_SHELF: "high_shelf",
    LOW_PASS: "low_pass",
    HIGH_PASS: "high_pass",
  };

  const bands = parsed.filters.map((f) => {
    const mappedType = typeMap[f.type] || "peak_dip";
    if (mappedType === "low_pass" || mappedType === "high_pass") {
      return {
        type: mappedType,
        frequency: f.frequency,
        slope: 12 as const,
      };
    }
    return {
      type: mappedType,
      frequency: f.frequency,
      gain_db: f.gain,
      q: f.q,
    };
  });

  return {
    author: "oratory1990",
    details: buildDetails(targetCurve, comment),
    link,
    type: "parametric_eq",
    parameters: {
      gain_db: parsed.preampGain,
      bands,
    },
  };
}

/**
 * Extract the base product name for sibling subtype inference.
 */
function extractBaseName(productName: string): string {
  return productName
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/\s+v\d+$/i, "")
    .replace(/\s+mk\s*\d+$/i, "")
    .trim()
    .toLowerCase();
}

/**
 * Scan sibling products under a vendor for matching base name to infer subtype.
 */
async function inferSubtypeFromSiblings(
  vendorProductsDir: string,
  productName: string
): Promise<ProductSubtype | null> {
  const newBase = extractBaseName(productName);
  try {
    for await (const entry of Deno.readDir(vendorProductsDir)) {
      if (!entry.isDirectory) continue;
      const siblingInfoPath = join(vendorProductsDir, entry.name, "info.json");
      try {
        const raw = await Deno.readTextFile(siblingInfoPath);
        const info = JSON.parse(raw) as ProductInfo;
        if (info.subtype && info.subtype !== "unknown") {
          const siblingBase = extractBaseName(info.name);
          if (siblingBase === newBase) return info.subtype;
        }
      } catch {
        // skip unparseable siblings
      }
    }
  } catch {
    // products dir doesn't exist yet
  }
  return null;
}

// =============================================================================
// Main Import Function
// =============================================================================

/**
 * Import Oratory data from a CSV file into the target database directory.
 *
 * @param targetDir - Path to database directory (e.g., "./database")
 * @param options - Import options including csvPath
 */
export async function importOratory(
  targetDir: string,
  options: ImportOptions
): Promise<ImportResult> {
  const {
    csvPath,
    cacheDir = DEFAULT_CACHE_DIR,
    concurrency = 3,
    dryRun = false,
    verbose = false,
    onProgress,
  } = options;

  const log = (message: string) => {
    if (verbose) console.log(`[${new Date().toISOString()}] ${message}`);
    onProgress?.(message);
  };

  const stats = createEmptyStats();
  const unknownTypes: string[] = [];
  const errors: { file: string; message: string }[] = [];

  // Read and parse CSV
  log(`Reading CSV: ${csvPath}`);
  let csvText: string;
  try {
    csvText = await Deno.readTextFile(csvPath);
  } catch (err) {
    const message = `Could not read CSV "${csvPath}": ${err}`;
    log(message);
    errors.push({ file: csvPath, message });
    stats.errors++;
    return { stats, unknownTypes, errors };
  }

  const rows = parseCsv(csvText, {
    skipFirstRow: true,
    separator: ";",
  }) as unknown as CsvRow[];

  log(`Found ${rows.length} entries in CSV`);

  // Ensure cache directory exists
  await ensureDir(cacheDir);
  log(`PDF cache directory: ${cacheDir}`);

  // Phase 1: Collect all valid rows and their URLs
  interface ParsedRow {
    index: number;
    brand: string;
    model: string;
    comment: string;
    targetField: string;
    link: string;
  }

  const validRows: ParsedRow[] = [];
  const urlsToDownload = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const brand = (row.Brand || "").trim();
    const model = (row.Model || "").trim();
    const comment = (row.Comment || "").trim();
    const targetField = (row.Target || "").trim();
    const link = (row.Link || "").trim();

    if (!brand || !model || !link) {
      log(`[${i + 1}/${rows.length}] SKIP: Missing brand/model/link`);
      continue;
    }

    validRows.push({ index: i, brand, model, comment, targetField, link });
    urlsToDownload.add(link);
  }

  log(`${validRows.length} valid entries, ${urlsToDownload.size} unique URLs to download`);

  if (dryRun) {
    log(`[DRY-RUN] Would process ${validRows.length} valid entries`);
    stats.newEqs = validRows.length;
    return { stats, unknownTypes, errors };
  }

  // Phase 2: Download all PDFs in parallel (cached files resolve instantly)
  const downloadedPdfs = await downloadAllPdfs(
    [...urlsToDownload],
    cacheDir,
    concurrency,
    log
  );

  // Phase 3: Process rows sequentially (writing to database is order-sensitive)
  const seenVendors = new Set<string>();
  const seenProducts = new Set<string>();

  for (const { index, brand, model, comment, targetField, link } of validRows) {
    log(`[${index + 1}/${rows.length}] ${brand} ${model}${comment && comment !== "0" ? ` (${comment})` : ""}`);

    try {
      const { subtype, targetCurve: urlTargetCurve } = mapTarget(targetField, link);

      // Look up downloaded PDF
      const pdfPath = downloadedPdfs.get(link);
      if (!pdfPath) {
        errors.push({ file: `${brand} ${model}`, message: "Failed to download PDF" });
        stats.errors++;
        continue;
      }

      // Extract text and parse EQ
      const text = await extractTextFromPdf(pdfPath);
      const eqData = parseOratoryPdfText(text);

      // Resolve target curve: use URL-based if available, else fall back to PDF content
      let targetCurve = urlTargetCurve;
      if (targetCurve === null) {
        const pdfTarget = extractTargetFromPdfText(text);
        targetCurve = pdfTarget || "oratory1990"; // last resort default
        if (pdfTarget) {
          log(`  Target resolved from PDF content: ${pdfTarget}`);
        } else {
          log(`  Warning: Could not determine target from URL or PDF, defaulting to oratory1990`);
        }
      }

      // Resolve vendor alias to canonical name
      const canonicalBrand = VENDOR_ALIASES[brand] || brand;
      const vendorSlug = generateSlug(canonicalBrand);
      const productSlug = generateSlug(model);
      const variantSlug = comment && comment !== "0" ? `_${generateSlug(comment)}` : "";
      const eqSlug = `oratory1990_${targetCurve}_target${variantSlug}`;

      if (canonicalBrand !== brand) {
        log(`  Vendor alias: "${brand}" → "${canonicalBrand}"`);
      }

      const vendorPath = join(targetDir, "vendors", vendorSlug);
      const productPath = join(vendorPath, "products", productSlug);
      const eqPath = join(productPath, "eq", eqSlug);
      const eqInfoPath = join(eqPath, "info.json");

      if (eqData.filters.length === 0) {
        log(`  Warning: No filters found in PDF`);
        errors.push({ file: `${brand} ${model}`, message: "No filters found in PDF" });
        stats.errors++;
        continue;
      }

      log(`  Found ${eqData.filters.length} filters, preamp: ${eqData.preampGain} dB`);

      // Build the new EQ info
      const eqInfo = convertToEQInfo(eqData, targetCurve, comment, link);
      const newJson = JSON.stringify(eqInfo, null, 2) + "\n";

      // Check if EQ already exists and compare
      if (await exists(eqInfoPath)) {
        const existingJson = await Deno.readTextFile(eqInfoPath);
        if (existingJson.trimEnd() === newJson.trimEnd()) {
          log(`  Unchanged: ${eqSlug}`);
          stats.unchangedEqs++;
          continue;
        }
        await Deno.writeTextFile(eqInfoPath, newJson);
        stats.updatedEqs++;
        log(`  Updated EQ: ${eqSlug}`);
        continue;
      }

      // Create directories for new entry
      await Deno.mkdir(eqPath, { recursive: true });

      // Write vendor info if new
      if (!seenVendors.has(vendorSlug)) {
        seenVendors.add(vendorSlug);
        const vendorInfoPath = join(vendorPath, "info.json");
        if (!(await exists(vendorInfoPath))) {
          const vendorInfo: VendorInfo = { name: canonicalBrand };
          await Deno.writeTextFile(vendorInfoPath, JSON.stringify(vendorInfo, null, 2) + "\n");
          stats.newVendors++;
          log(`  Created vendor: ${canonicalBrand}`);
        }
      }

      // Write product info if new
      const productKey = `${vendorSlug}::${productSlug}`;
      if (!seenProducts.has(productKey)) {
        seenProducts.add(productKey);
        const productInfoPath = join(productPath, "info.json");
        if (!(await exists(productInfoPath))) {
          const inferredSubtype = await inferSubtypeFromSiblings(
            join(vendorPath, "products"),
            model
          );
          const finalSubtype = inferredSubtype || subtype;

          const productInfo: ProductInfo = {
            name: model,
            type: "headphones",
            subtype: finalSubtype,
          };
          await Deno.writeTextFile(productInfoPath, JSON.stringify(productInfo, null, 2) + "\n");
          stats.newProducts++;
          if (finalSubtype === "unknown") {
            unknownTypes.push(productKey);
            log(`  Created product: ${model} (subtype unknown)`);
          } else {
            log(`  Created product: ${model} (subtype: ${finalSubtype})`);
          }
        }
      }

      // Write new EQ info
      await Deno.writeTextFile(eqInfoPath, newJson);
      stats.newEqs++;
      log(`  Created EQ: ${eqSlug}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`  Error: ${message}`);
      errors.push({ file: `${brand} ${model}`, message });
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
  const csvPath = Deno.args[0];
  const targetDir = Deno.args[1] || "./database";

  if (!csvPath) {
    console.error("Usage: deno run --allow-all tools/oratory/import.ts <csv_path> [target_dir]");
    console.error("Example: deno run --allow-all tools/oratory/import.ts ~/Downloads/Oratory_Feb25_2026.csv database");
    Deno.exit(1);
  }

  const result = await importOratory(targetDir, {
    csvPath,
    verbose: true,
  });

  console.log("\n=== Import Summary ===");
  console.log(`New vendors:       ${result.stats.newVendors}`);
  console.log(`New products:      ${result.stats.newProducts}`);
  console.log(`New EQs:           ${result.stats.newEqs}`);
  console.log(`Updated EQs:       ${result.stats.updatedEqs}`);
  console.log(`Unchanged EQs:     ${result.stats.unchangedEqs}`);
  console.log(`Errors:            ${result.stats.errors}`);

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
