/**
 * Tests for AutoEQ unchanged-EQ detection
 *
 * Run with: deno test --allow-read --allow-write --allow-env tests/import_autoeq_unchanged_test.ts
 */

import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";

import { importAutoEQ } from "../tools/autoeq/import.ts";

// Helper to create a minimal AutoEQ source structure
async function createTestSource(
  baseDir: string,
  measurer: string,
  type: string,
  productName: string,
  eqContent: string,
) {
  const dir = join(baseDir, measurer, type, productName);
  await ensureDir(dir);
  await Deno.writeTextFile(
    join(dir, `${productName} ParametricEQ.txt`),
    eqContent,
  );
}

const SAMPLE_EQ = `Preamp: -6.2 dB
Filter 1: ON PK Fc 31 Hz Gain 4.5 dB Q 1.41
Filter 2: ON PK Fc 62 Hz Gain -1.2 dB Q 1.00
`;

const MODIFIED_EQ = `Preamp: -7.0 dB
Filter 1: ON PK Fc 31 Hz Gain 5.0 dB Q 1.41
Filter 2: ON PK Fc 62 Hz Gain -1.5 dB Q 1.00
`;

Deno.test("importAutoEQ - detects unchanged EQ on second import", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  const srcDir = join(tmpDir, "source");
  const targetDir = join(tmpDir, "database");

  try {
    await createTestSource(
      srcDir,
      "TestMeasurer",
      "over-ear",
      "TestVendor TestProduct",
      SAMPLE_EQ,
    );

    // First import: should create new EQ
    const result1 = await importAutoEQ(srcDir, targetDir);
    assertEquals(result1.stats.newEqs, 1);
    assertEquals(result1.stats.updatedEqs, 0);
    assertEquals(result1.stats.unchangedEqs, 0);

    // Second import with same content: should detect unchanged
    const result2 = await importAutoEQ(srcDir, targetDir);
    assertEquals(result2.stats.newEqs, 0);
    assertEquals(result2.stats.updatedEqs, 0);
    assertEquals(result2.stats.unchangedEqs, 1);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("importAutoEQ - detects updated EQ when content changes", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "opra_test_" });
  const srcDir = join(tmpDir, "source");
  const targetDir = join(tmpDir, "database");

  try {
    // First import
    await createTestSource(
      srcDir,
      "TestMeasurer",
      "over-ear",
      "TestVendor TestProduct",
      SAMPLE_EQ,
    );
    const result1 = await importAutoEQ(srcDir, targetDir);
    assertEquals(result1.stats.newEqs, 1);

    // Modify the source EQ
    await createTestSource(
      srcDir,
      "TestMeasurer",
      "over-ear",
      "TestVendor TestProduct",
      MODIFIED_EQ,
    );

    // Second import with changed content: should detect update
    const result2 = await importAutoEQ(srcDir, targetDir);
    assertEquals(result2.stats.newEqs, 0);
    assertEquals(result2.stats.updatedEqs, 1);
    assertEquals(result2.stats.unchangedEqs, 0);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
