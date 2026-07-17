import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ensureDir } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

import {
  loadProductCatalog,
  resolveCatalogProduct,
  resolveCatalogProductParts,
  splitCatalogVendorProduct,
} from "../tools/product_catalog.ts";

async function addProduct(
  databaseDir: string,
  vendorSlug: string,
  vendorName: string,
  productSlug: string,
  productName: string,
): Promise<void> {
  const vendorDir = join(databaseDir, "vendors", vendorSlug);
  const productDir = join(vendorDir, "products", productSlug);
  await ensureDir(productDir);
  await Deno.writeTextFile(
    join(vendorDir, "info.json"),
    JSON.stringify({ name: vendorName }),
  );
  await Deno.writeTextFile(
    join(productDir, "info.json"),
    JSON.stringify({
      name: productName,
      type: "headphones",
      subtype: "over_the_ear",
    }),
  );
}

Deno.test("product catalog - resolves exact and compact canonical products", async () => {
  const databaseDir = await Deno.makeTempDir({ prefix: "opra_catalog_" });
  try {
    await addProduct(databaseDir, "aure_audio", "Aure Audio", "elixir", "Elixir");
    await addProduct(
      databaseDir,
      "beyerdynamic",
      "Beyerdynamic",
      "dt_770_m",
      "DT 770 M",
    );
    const catalog = await loadProductCatalog(databaseDir);

    const exact = resolveCatalogProduct(catalog, "Aure Audio Elixir");
    assertEquals(exact?.vendorSlug, "aure_audio");
    assertEquals(exact?.productSlug, "elixir");
    assertEquals(exact?.match, "exact");

    const compact = resolveCatalogProduct(catalog, "Beyerdynamic DT770M");
    assertEquals(compact?.vendorSlug, "beyerdynamic");
    assertEquals(compact?.productSlug, "dt_770_m");
    assertEquals(compact?.match, "compact");
  } finally {
    await Deno.remove(databaseDir, { recursive: true });
  }
});

Deno.test("product catalog - resolves separate Oratory brand and model fields", async () => {
  const databaseDir = await Deno.makeTempDir({ prefix: "opra_catalog_" });
  try {
    await addProduct(
      databaseDir,
      "bowers_wilkins",
      "Bowers & Wilkins",
      "px8",
      "PX8",
    );
    const catalog = await loadProductCatalog(databaseDir);

    const match = resolveCatalogProductParts(catalog, "Bowers and Wilkins", "PX 8");
    assertEquals(match?.vendorSlug, "bowers_wilkins");
    assertEquals(match?.productSlug, "px8");
  } finally {
    await Deno.remove(databaseDir, { recursive: true });
  }
});

Deno.test("product catalog - uses the longest vendor token prefix for a new model", async () => {
  const databaseDir = await Deno.makeTempDir({ prefix: "opra_catalog_" });
  try {
    await addProduct(databaseDir, "clear", "Clear", "alpha", "Alpha");
    await addProduct(databaseDir, "clear_tune", "Clear Tune", "ct_200", "CT 200");
    const catalog = await loadProductCatalog(databaseDir);

    const match = splitCatalogVendorProduct(catalog, "Clear Tune Brand New");
    assertEquals(match?.vendorSlug, "clear_tune");
    assertEquals(match?.productName, "Brand New");
  } finally {
    await Deno.remove(databaseDir, { recursive: true });
  }
});

Deno.test("product catalog - leaves ambiguous compact matches unresolved", async () => {
  const databaseDir = await Deno.makeTempDir({ prefix: "opra_catalog_" });
  try {
    await addProduct(databaseDir, "one", "One", "ab", "A B");
    await addProduct(databaseDir, "one", "One", "a_b", "AB");
    const catalog = await loadProductCatalog(databaseDir);

    assertEquals(resolveCatalogProduct(catalog, "OneAB"), null);
  } finally {
    await Deno.remove(databaseDir, { recursive: true });
  }
});

Deno.test("product catalog - canonicalizes ambiguous matches with verified redirects", async () => {
  const databaseDir = await Deno.makeTempDir({ prefix: "opra_catalog_" });
  try {
    await addProduct(databaseDir, "one", "One", "ab", "A B");
    await addProduct(databaseDir, "one", "One", "a_b", "AB");
    const catalog = await loadProductCatalog(databaseDir, {
      "one::a_b": "one::ab",
    });

    const match = resolveCatalogProduct(catalog, "OneAB");
    assertEquals(match?.vendorSlug, "one");
    assertEquals(match?.productSlug, "ab");
  } finally {
    await Deno.remove(databaseDir, { recursive: true });
  }
});
