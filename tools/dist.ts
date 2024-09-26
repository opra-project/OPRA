#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

import { parse } from "https://deno.land/std@0.118.0/flags/mod.ts";
import { join, dirname, extname, relative } from "https://deno.land/std@0.118.0/path/mod.ts";
import { walk } from "https://deno.land/std@0.118.0/fs/walk.ts";
import { ensureDir } from "https://deno.land/std@0.118.0/fs/ensure_dir.ts";
import Ajv from "https://cdn.skypack.dev/ajv@6?dts";
import { createHash } from "https://deno.land/std@0.118.0/hash/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";
import { gray, brightGreen, red } from "https://deno.land/std@0.118.0/fmt/colors.ts";

// Parse command-line arguments
const args = parse(Deno.args, {
  boolean: ["validate-only", "help"],
  alias: { h: "help" },
});

if (args.help) {
  console.log(`Usage: dist.ts [--validate-only] [--help]

Options:
  --validate-only     Perform validation only and print actions without making changes.
  --help              Show this help message.
`);
  Deno.exit(0);
}

const validateOnly = args["validate-only"] || false;

// Log Tags
const ERROR      =         red("ERROR      ");
const GENERATING = brightGreen("GENERATING ");
const COPYING    = brightGreen("COPYING    ");
const SKIPPED    =        gray("SKIPPED    ");
const INDENT     =             "            ";

// Directories
const SCHEMAS_DIR = "schemas";
const DATABASE_DIR = "database";
const DIST_DIR = "dist";

// Load schemas
async function loadSchema(filename: string) {
  const schemaText = await Deno.readTextFile(filename);
  return JSON.parse(schemaText);
}

const vendorInfoSchema = await loadSchema(join(SCHEMAS_DIR, "vendor_info.json"));
const productInfoSchema = await loadSchema(join(SCHEMAS_DIR, "product_info.json"));
const eqInfoSchema = await loadSchema(join(SCHEMAS_DIR, "eq_info.json"));

// Set up JSON schema validator
const ajv = new Ajv();
const validateVendorInfo = ajv.compile(vendorInfoSchema);
const validateProductInfo = ajv.compile(productInfoSchema);
const validateEqInfo = ajv.compile(eqInfoSchema);

// Maps to keep track of processed assets and avoid duplication
const processedAssets = new Map<string, string>(); // Map from original path to hash
const processedEntries: any[] = [];

// Function to compute SHA256 hash of a file
async function computeFileHash(filePath: string): Promise<string> {
  const fileData = await Deno.readFile(filePath);
  const hash = createHash("sha256");
  hash.update(fileData);
  return hash.toString();
}

// Function to ensure the directory for a file exists
async function ensureDirForFile(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  await ensureDir(dir);
}

// Function to get the asset path based on hash and original file extension
function getAssetPath(hash: string, originalFilePath: string): string {
  const ext = extname(originalFilePath);
  const filename = `${hash}${ext}`;
  const assetPath = join(
    DIST_DIR,
    "assets",
    hash.substring(0, 2),
    hash.substring(2, 4),
    filename,
  );
  return assetPath;
}

// Function to get the relative asset path for JSON references
function getRelativeAssetPath(hash: string, originalFilePath: string): string {
  const ext = extname(originalFilePath);
  const filename = `${hash}${ext}`;
  const relativePath = join(
    "assets",
    hash.substring(0, 2),
    hash.substring(2, 4),
    filename,
  );
  return relativePath;
}

// Function to process image assets (PNG)
async function processImageAsset(filePath: string): Promise<string> {
  const hash = await computeFileHash(filePath);

  if (processedAssets.has(filePath)) {
    return processedAssets.get(filePath)!;
  }

  // Check if the image is a 1024x1024 PNG
  const imageInfo = await Deno.run({
    cmd: ["identify", "-format", "%w %h %m", filePath],
    stdout: "piped",
    stderr: "null",
  }).output();
  const [widthStr, heightStr, format] = new TextDecoder().decode(imageInfo).split(" ");
  const width = parseInt(widthStr, 10);
  const height = parseInt(heightStr, 10);

  if (format !== "PNG") {
    console.error(ERROR, `Image ${filePath} is not a PNG file.`);
    Deno.exit(1);
  }
  if (width !== 1024 || height !== 1024) {
    console.error(ERROR, `Image ${filePath} must be 1024x1024 pixels.`);
    Deno.exit(1);
  }

  const assetPath = getAssetPath(hash, filePath);

  try {
    await Deno.stat(assetPath);
    console.log(SKIPPED, `Image ${filePath}\n${INDENT}  (already exists at ${assetPath})`);
  } catch {
    if (!validateOnly) {
      console.log(COPYING, `${filePath} => ${assetPath}`);
      await ensureDirForFile(assetPath);
      await Deno.copyFile(filePath, assetPath);
    } else {
      console.log(COPYING, `Would copy image ${filePath} to ${assetPath}`);
    }
  }

  processedAssets.set(filePath, hash);
  return getRelativeAssetPath(hash, filePath);
}

async function processSvgAsset(filePath: string): Promise<string> {
  const hash = await computeFileHash(filePath);

  if (processedAssets.has(filePath)) {
    return processedAssets.get(filePath)!;
  }

  const assetPath = getAssetPath(hash, filePath);

  try {
    await Deno.stat(assetPath);
    console.log(SKIPPED, `SVG ${filePath}\n${INDENT}  (already exists at ${assetPath})`);
  } catch {
    if (!validateOnly) {
      console.log(COPYING,`${filePath} => ${assetPath}`);
      await ensureDirForFile(assetPath);
      await Deno.copyFile(filePath, assetPath);
    } else {
      console.log(COPYING, `Would copy SVG ${filePath} to ${assetPath}`);
    }
  }

  processedAssets.set(filePath, hash);
  return getRelativeAssetPath(hash, filePath);
}

// Function to generate PNG from SVG
async function generatePngFromSvg(svgPath: string, width: number, height: number): Promise<string> {
  const svgHash = await computeFileHash(svgPath);
  const version = "v1";
  const filename = `${svgHash}.${version}.${width}x${height}.png`;
  const assetPath = join(
    DIST_DIR,
    "assets",
    svgHash.substring(0, 2),
    svgHash.substring(2, 4),
    filename,
  );

  try {
    await Deno.stat(assetPath);
    console.log(SKIPPED, `PNG for SVG ${svgPath}\n${INDENT}  (already exists at ${assetPath})`);
  } catch {
    if (!validateOnly) {
      // Check if file already exists
      console.log(GENERATING, `${svgPath} => ${assetPath}`);
      // File does not exist, generate it
      await ensureDirForFile(assetPath);
      const cmd = [
        "rsvg-convert",
        "--keep-aspect-ratio",
        "-w",
        width.toString(),
        "-h",
        height.toString(),
        svgPath,
        "-o",
        assetPath,
      ];
      const process = Deno.run({ cmd, stdout: "null", stderr: "piped" });
      const status = await process.status();
      const stderr = await process.stderrOutput();

      if (!status.success) {
        const errorString = new TextDecoder().decode(stderr);
        console.error(ERROR, `Failed to generate PNG from SVG ${svgPath}. Details: ${errorString}`);
        Deno.exit(1);
      }
    } else {
      console.log(GENERATING, `${svgPath} => ${assetPath}`);
    }
  }

  return join(
    "assets",
    svgHash.substring(0, 2),
    svgHash.substring(2, 4),
    filename,
  );
}

// Function to process entries
async function processEntries() {
  for await (
    const entry of walk(DATABASE_DIR, { includeFiles: true, exts: ["json"], match: [/info\.json$/] })
  ) {
    let data
    try {
      data = JSON.parse(await Deno.readTextFile(entry.path));
    } catch (e) {
      console.error(ERROR, `Failed to parse JSON in ${entry.path}: ${e}`);
      Deno.exit(1);
    }

    const relativePath = relative(DATABASE_DIR, entry.path);
    const parts = relativePath.split("/");

    if (parts[0] === "vendors" && parts.length === 3 && parts[2] === "info.json") {
      // Vendor info
      const vendorName = parts[1];

      // Validate
      const valid = validateVendorInfo(data);
      if (!valid) {
        console.error(red(`[ERROR]`), `Validation error in ${entry.path}:`, validateVendorInfo.errors);
        Deno.exit(1);
      }

      // Process logo
      if (data.logo) {
        const logoPath = join(dirname(entry.path), data.logo);
        data.logo = await processImageAsset(logoPath);
      }

      processedEntries.push({
        type: "vendor",
        id: vendorName,
        data: data,
      });
    } else if (
      parts[0] === "vendors" &&
      parts[2] === "products" &&
      parts.length === 5 &&
      parts[4] === "info.json"
    ) {
      // Product info
      const vendorName = parts[1];
      const productName = parts[3];
      const productId = `${vendorName}_${productName}`;

      // Validate
      const valid = validateProductInfo(data);
      if (!valid) {
        console.error(ERROR, `Validation error in ${entry.path}:`, validateProductInfo.errors);
        Deno.exit(1);
      }

      // Process photo
      if (data.photo) {
        const photoPath = join(dirname(entry.path), data.photo);
        data.photo = await processImageAsset(photoPath);
      }

      // Process line art SVG
      if (data.line_art_svg) {
        const svgPath = join(dirname(entry.path), data.line_art_svg);
        data.line_art_svg = await processSvgAsset(svgPath);

        // Generate PNG-ified version at 96x64
        data.line_art_96x64_png = await generatePngFromSvg(svgPath, 96, 64);
      }

      processedEntries.push({
        type: "product",
        id: productId,
        data: data,
      });
    } else if (
      parts[0] === "vendors" &&
      parts[2] === "products" &&
      parts.length === 7 &&
      parts[4] === "eq") {
      // EQ info
      const vendorName = parts[1];
      const productName = parts[3];
      const eqName = parts[5];
      const eqId = `${vendorName}_${productName}_${eqName}`;

      // Validate
      const valid = validateEqInfo(data);
      if (!valid) {
        console.error(ERROR, `Validation error in ${entry.path}:`, validateEqInfo.errors);
        Deno.exit(1);
      }

      processedEntries.push({
        type: "eq",
        id: eqId,
        data: data,
      });
    }
  }
}

// Write the processed entries to dist/database_v1.jsonl
async function writeDatabaseFile() {
  let entryCount = processedEntries.length;
  if (!validateOnly) {
    const jsonlPath = join(DIST_DIR, "database_v1.jsonl");
    console.log(GENERATING, `Writing database_v1.jsonl with ${entryCount} entries.`);
    await ensureDirForFile(jsonlPath);
    const file = await Deno.open(jsonlPath, {
      create: true,
      write: true,
      truncate: true,
    });

    for (const entry of processedEntries) {
      const jsonLine = JSON.stringify(entry);
      await file.write(new TextEncoder().encode(jsonLine + "\n"));
    }

    file.close();
  } else {
    console.log(GENERATING, `Would write database_v1.jsonl with ${entryCount} entries.`);
  }
}

// Main execution
await processEntries();
await writeDatabaseFile();


