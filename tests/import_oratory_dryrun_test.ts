/**
 * Tests for Oratory import dry-run behavior
 *
 * Run with: deno test --allow-read --allow-write --allow-env tests/import_oratory_dryrun_test.ts
 */

import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

import { importOratory } from "../tools/oratory/import.ts";

Deno.test("importOratory dry-run - counts only valid rows", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  const csvPath = join(tmpDir, "test.csv");

  // CSV with 3 rows: 2 valid, 1 missing link
  const csvContent = `Brand;Model;Comment;Target;Link
Sony;WH-1000XM4;0;1;https://dropbox.com/test1.pdf?dl=0
Sennheiser;HD650;0;1;https://dropbox.com/test2.pdf?dl=0
BadRow;NoLink;0;1;
`;

  try {
    await Deno.writeTextFile(csvPath, csvContent);

    const result = await importOratory(tmpDir, {
      csvPath,
      cacheDir: join(tmpDir, "pdf_cache"),
      dryRun: true,
    });

    // Should count 2 valid rows, not 3 total rows
    assertEquals(result.stats.newEqs, 2);
    assertEquals(result.stats.errors, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
