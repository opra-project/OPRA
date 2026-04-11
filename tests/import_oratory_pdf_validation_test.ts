/**
 * Tests for oratory PDF download validation
 *
 * Tests that:
 * 1. Cached valid PDFs are accepted
 * 2. Cached HTML (from Dropbox rate limiting) is rejected and the entry errors
 * 3. Written JSON files have trailing newlines
 *
 * Run with: deno test --allow-read --allow-write --allow-env --allow-net tests/import_oratory_pdf_validation_test.ts
 */

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { exists } from "https://deno.land/std@0.224.0/fs/mod.ts";

import { importOratory } from "../tools/oratory/import.ts";

/**
 * Helper: create a minimal CSV pointing at a fake Dropbox URL
 * whose filename matches the PDF we'll pre-cache.
 */
function buildCsv(entries: { brand: string; model: string; filename: string }[]): string {
  const header = "Brand;Model;Comment;Target;Link";
  const rows = entries.map(
    (e) => `${e.brand};${e.model};0;1;https://www.dropbox.com/s/fake/${encodeURIComponent(e.filename)}?dl=0`
  );
  return [header, ...rows].join("\n") + "\n";
}

Deno.test("importOratory - accepts cached valid PDF and parses EQ", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  const cacheDir = join(tmpDir, "pdf_cache");
  const dbDir = join(tmpDir, "database");
  await Deno.mkdir(cacheDir, { recursive: true });
  await Deno.mkdir(dbDir, { recursive: true });

  // Pre-cache a real PDF with the filename the URL will resolve to
  const pdfFixture = await Deno.readFile("tests/fixtures/test_2.pdf");
  await Deno.writeFile(join(cacheDir, "Test Product.pdf"), pdfFixture);

  const csvPath = join(tmpDir, "test.csv");
  await Deno.writeTextFile(csvPath, buildCsv([
    { brand: "TestBrand", model: "Test Product", filename: "Test Product.pdf" },
  ]));

  try {
    const result = await importOratory(dbDir, {
      csvPath,
      cacheDir,
    });

    assertEquals(result.stats.errors, 0, "should have no errors");
    assertEquals(result.stats.newEqs, 1, "should create one EQ");
    assertEquals(result.stats.newVendors, 1, "should create one vendor");
    assertEquals(result.stats.newProducts, 1, "should create one product");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("importOratory - rejects cached HTML (rate-limit page) as invalid PDF", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  const cacheDir = join(tmpDir, "pdf_cache");
  const dbDir = join(tmpDir, "database");
  await Deno.mkdir(cacheDir, { recursive: true });
  await Deno.mkdir(dbDir, { recursive: true });

  // Pre-cache HTML masquerading as a PDF
  await Deno.writeTextFile(
    join(cacheDir, "Fake Product.pdf"),
    "<html><head><title>Too Many Requests</title></head><body>Rate limited</body></html>"
  );

  const csvPath = join(tmpDir, "test.csv");
  await Deno.writeTextFile(csvPath, buildCsv([
    { brand: "TestBrand", model: "Fake Product", filename: "Fake Product.pdf" },
  ]));

  try {
    const result = await importOratory(dbDir, {
      csvPath,
      cacheDir,
    });

    assertEquals(result.stats.newEqs, 0, "should not create any EQs");
    assertEquals(result.stats.errors, 1, "should record one error");
    assert(result.errors[0].message.includes("Failed to download"), "error should indicate download failure");

    // The stale HTML file should have been removed from cache
    const staleFileExists = await exists(join(cacheDir, "Fake Product.pdf"));
    assertEquals(staleFileExists, false, "stale cached HTML file should be deleted");
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("importOratory - written JSON files have trailing newlines", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  const cacheDir = join(tmpDir, "pdf_cache");
  const dbDir = join(tmpDir, "database");
  await Deno.mkdir(cacheDir, { recursive: true });
  await Deno.mkdir(dbDir, { recursive: true });

  // Pre-cache a real PDF
  const pdfFixture = await Deno.readFile("tests/fixtures/test_2.pdf");
  await Deno.writeFile(join(cacheDir, "Newline Test.pdf"), pdfFixture);

  const csvPath = join(tmpDir, "test.csv");
  await Deno.writeTextFile(csvPath, buildCsv([
    { brand: "NewlineBrand", model: "Newline Test", filename: "Newline Test.pdf" },
  ]));

  try {
    const result = await importOratory(dbDir, {
      csvPath,
      cacheDir,
    });

    assertEquals(result.stats.errors, 0, "should have no errors");
    assertEquals(result.stats.newEqs, 1, "should create one EQ");

    // Check all written info.json files end with newline
    const vendorInfo = await Deno.readTextFile(
      join(dbDir, "vendors", "newlinebrand", "info.json")
    );
    assert(vendorInfo.endsWith("\n"), "vendor info.json should end with newline");

    const productInfo = await Deno.readTextFile(
      join(dbDir, "vendors", "newlinebrand", "products", "newline_test", "info.json")
    );
    assert(productInfo.endsWith("\n"), "product info.json should end with newline");

    // Find the EQ info.json (slug varies based on target)
    const eqDir = join(dbDir, "vendors", "newlinebrand", "products", "newline_test", "eq");
    for await (const entry of Deno.readDir(eqDir)) {
      if (entry.isDirectory) {
        const eqInfo = await Deno.readTextFile(join(eqDir, entry.name, "info.json"));
        assert(eqInfo.endsWith("\n"), `EQ info.json (${entry.name}) should end with newline`);
      }
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
