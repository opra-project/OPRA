#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net

/**
 * Downloads all PDFs from the oratory CSV.
 */

import { parse } from "https://deno.land/std@0.224.0/csv/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";

const CSV_PATH = Deno.args[0] || "/Users/sshaw/Downloads/Oratory_Feb25_2026.csv";
const OUTPUT_DIR = Deno.args[1] || "/Users/sshaw/Downloads/oratory_pdfs";

// Rate limiting: delay between downloads (ms)
const DELAY_MS = 100;

interface DownloadResult {
  brand: string;
  model: string;
  comments: string;
  target: string;
  link: string;
  filename: string;
  size: number;
  error: string | null;
}

function convertToDirectLink(dropboxUrl: string): string {
  return dropboxUrl.replace(/([?&])dl=0/, "$1dl=1");
}

function extractFilename(url: string): string | null {
  const match = url.match(/\/([^\/]+\.pdf)\?/i);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  return null;
}

async function downloadWithRetry(
  url: string,
  maxRetries = 3
): Promise<{ data: Uint8Array; size: number } | { error: string }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
      });

      if (!response.ok) {
        if (attempt === maxRetries) {
          return { error: `HTTP ${response.status}: ${response.statusText}` };
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }

      const data = new Uint8Array(await response.arrayBuffer());
      return { data, size: data.length };
    } catch (err) {
      if (attempt === maxRetries) {
        return { error: `Network error: ${err instanceof Error ? err.message : String(err)}` };
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  return { error: "Max retries exceeded" };
}

async function main() {
  console.log("Loading CSV...");
  const csvText = await Deno.readTextFile(CSV_PATH);
  const rows = parse(csvText, { skipFirstRow: true, separator: ";" });
  console.log(`Found ${rows.length} entries in CSV\n`);

  await ensureDir(OUTPUT_DIR);

  const results: DownloadResult[] = [];
  let downloaded = 0;
  let cached = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const brand = row.Brand || "";
    const model = row.Model || "";
    const comments = row.Comment || "";
    const target = row.Target || "";
    const link = row.Link || "";

    const filename = extractFilename(link);
    if (!filename || !link) {
      console.log(`[${i + 1}/${rows.length}] SKIP: No link - ${brand} ${model}`);
      continue;
    }

    const directUrl = convertToDirectLink(link);
    const localPath = `${OUTPUT_DIR}/${filename}`;

    // Check if already downloaded
    try {
      const stat = await Deno.stat(localPath);
      results.push({
        brand,
        model,
        comments,
        target,
        link,
        filename,
        size: stat.size,
        error: null,
      });
      cached++;
      console.log(
        `[${i + 1}/${rows.length}] CACHED: ${filename} (${(stat.size / 1024).toFixed(1)}KB)`
      );
      continue;
    } catch {
      // File doesn't exist, download it
    }

    console.log(`[${i + 1}/${rows.length}] Downloading: ${filename}...`);

    const result = await downloadWithRetry(directUrl);

    if ("error" in result) {
      console.log(`  ERROR: ${result.error}`);
      results.push({
        brand,
        model,
        comments,
        target,
        link,
        filename,
        size: 0,
        error: result.error,
      });
      errors++;
    } else {
      await Deno.writeFile(localPath, result.data);
      results.push({
        brand,
        model,
        comments,
        target,
        link,
        filename,
        size: result.size,
        error: null,
      });
      downloaded++;
      console.log(`  OK: ${(result.size / 1024).toFixed(1)}KB`);
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total entries: ${rows.length}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Cached: ${cached}`);
  console.log(`Errors: ${errors}`);
}

main();
