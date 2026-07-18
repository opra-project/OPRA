import { exists } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

import { VENDOR_ALIASES } from "./known_vendors.ts";
import { ProductInfo, VendorInfo } from "./types.ts";

export interface CatalogVendor {
  vendorName: string;
  vendorSlug: string;
  aliases: string[];
}

export interface CatalogProduct {
  vendorName: string;
  vendorSlug: string;
  productName: string;
  productSlug: string;
}

export interface ProductCatalog {
  vendors: CatalogVendor[];
  products: CatalogProduct[];
  productsById: Map<string, CatalogProduct>;
  productRedirects: Record<string, string>;
  exactProducts: Map<string, CatalogProduct[]>;
  compactProducts: Map<string, CatalogProduct[]>;
  exactVendors: Map<string, CatalogVendor[]>;
  compactVendors: Map<string, CatalogVendor[]>;
}

export interface CatalogProductMatch extends CatalogProduct {
  match: "exact" | "compact";
}

export interface CatalogVendorMatch {
  vendorName: string;
  vendorSlug: string;
  match: "exact" | "compact" | "prefix";
}

interface NameToken {
  value: string;
  start: number;
}

export function normalizeCatalogName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function compactCatalogName(value: string): string {
  return normalizeCatalogName(value).replace(/\s+/g, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function addIndexEntry<T extends { vendorSlug: string }>(
  index: Map<string, T[]>,
  key: string,
  value: T,
  identity: (entry: T) => string,
): void {
  if (!key) return;

  const entries = index.get(key) ?? [];
  if (!entries.some((entry) => identity(entry) === identity(value))) {
    entries.push(value);
    index.set(key, entries);
  }
}

function uniqueMatch<T>(entries: T[] | undefined): T | null {
  return entries?.length === 1 ? entries[0] : null;
}

function productId(product: CatalogProduct): string {
  return `${product.vendorSlug}::${product.productSlug}`;
}

function canonicalProduct(catalog: ProductCatalog, product: CatalogProduct): CatalogProduct {
  let id = productId(product);
  const visited = new Set<string>();

  while (catalog.productRedirects[id] && !visited.has(id)) {
    visited.add(id);
    id = catalog.productRedirects[id];
  }

  return catalog.productsById.get(id) ?? product;
}

function uniqueProductMatch(
  catalog: ProductCatalog,
  entries: CatalogProduct[] | undefined,
): CatalogProduct | null {
  if (!entries) return null;

  const canonical = new Map<string, CatalogProduct>();
  for (const entry of entries) {
    const product = canonicalProduct(catalog, entry);
    canonical.set(productId(product), product);
  }
  return canonical.size === 1 ? [...canonical.values()][0] : null;
}

function tokenize(value: string): NameToken[] {
  const tokens: NameToken[] = [];
  const tokenPattern = /[\p{L}\p{N}]+|&/gu;

  for (const match of value.matchAll(tokenPattern)) {
    const raw = match[0];
    const normalized = raw === "&" ? "and" : normalizeCatalogName(raw);
    if (normalized) {
      tokens.push({ value: normalized, start: match.index ?? 0 });
    }
  }

  return tokens;
}

function vendorAliases(vendorSlug: string, info: VendorInfo): string[] {
  const canonicalName = normalizeCatalogName(info.name);
  const knownAliases = Object.entries(VENDOR_ALIASES)
    .filter(([, canonical]) => normalizeCatalogName(canonical) === canonicalName)
    .map(([alias]) => alias);

  return uniqueStrings([
    info.name,
    info.official_name ?? "",
    vendorSlug.replaceAll("_", " "),
    ...knownAliases,
  ]);
}

/** Load canonical vendor and product names already present in an OPRA database. */
export async function loadProductCatalog(
  targetDir: string,
  productRedirects: Record<string, string> = {},
): Promise<ProductCatalog> {
  const catalog: ProductCatalog = {
    vendors: [],
    products: [],
    productsById: new Map(),
    productRedirects,
    exactProducts: new Map(),
    compactProducts: new Map(),
    exactVendors: new Map(),
    compactVendors: new Map(),
  };
  const vendorsDir = join(targetDir, "vendors");
  if (!(await exists(vendorsDir))) return catalog;

  const vendorEntries = [];
  for await (const entry of Deno.readDir(vendorsDir)) {
    if (entry.isDirectory) vendorEntries.push(entry);
  }
  vendorEntries.sort((a, b) => a.name.localeCompare(b.name));

  for (const vendorEntry of vendorEntries) {
    const vendorSlug = vendorEntry.name;
    const vendorInfoPath = join(vendorsDir, vendorSlug, "info.json");
    if (!(await exists(vendorInfoPath))) continue;

    const vendorInfo = JSON.parse(await Deno.readTextFile(vendorInfoPath)) as VendorInfo;
    const vendor: CatalogVendor = {
      vendorName: vendorInfo.name,
      vendorSlug,
      aliases: vendorAliases(vendorSlug, vendorInfo),
    };
    catalog.vendors.push(vendor);

    for (const alias of vendor.aliases) {
      addIndexEntry(
        catalog.exactVendors,
        normalizeCatalogName(alias),
        vendor,
        (entry) => entry.vendorSlug,
      );
      addIndexEntry(
        catalog.compactVendors,
        compactCatalogName(alias),
        vendor,
        (entry) => entry.vendorSlug,
      );
    }

    const productsDir = join(vendorsDir, vendorSlug, "products");
    if (!(await exists(productsDir))) continue;

    const productEntries = [];
    for await (const entry of Deno.readDir(productsDir)) {
      if (entry.isDirectory) productEntries.push(entry);
    }
    productEntries.sort((a, b) => a.name.localeCompare(b.name));

    for (const productEntry of productEntries) {
      const productSlug = productEntry.name;
      const productInfoPath = join(productsDir, productSlug, "info.json");
      if (!(await exists(productInfoPath))) continue;

      const productInfo = JSON.parse(await Deno.readTextFile(productInfoPath)) as ProductInfo;
      const product: CatalogProduct = {
        vendorName: vendor.vendorName,
        vendorSlug,
        productName: productInfo.name,
        productSlug,
      };
      catalog.products.push(product);
      catalog.productsById.set(productId(product), product);

      const productAliases = uniqueStrings([
        productInfo.name,
        productSlug.replaceAll("_", " "),
      ]);
      for (const vendorAlias of vendor.aliases) {
        for (const productAlias of productAliases) {
          const fullName = `${vendorAlias} ${productAlias}`;
          const identity = (entry: CatalogProduct) => `${entry.vendorSlug}::${entry.productSlug}`;
          addIndexEntry(
            catalog.exactProducts,
            normalizeCatalogName(fullName),
            product,
            identity,
          );
          addIndexEntry(
            catalog.compactProducts,
            compactCatalogName(fullName),
            product,
            identity,
          );
        }
      }
    }
  }

  return catalog;
}

/** Resolve a combined source name to one unique product already in the database. */
export function resolveCatalogProduct(
  catalog: ProductCatalog,
  fullName: string,
): CatalogProductMatch | null {
  const exact = uniqueProductMatch(
    catalog,
    catalog.exactProducts.get(normalizeCatalogName(fullName)),
  );
  if (exact) return { ...exact, match: "exact" };

  const compact = uniqueProductMatch(
    catalog,
    catalog.compactProducts.get(compactCatalogName(fullName)),
  );
  return compact ? { ...compact, match: "compact" } : null;
}

/** Resolve brand and model fields to one unique product already in the database. */
export function resolveCatalogProductParts(
  catalog: ProductCatalog,
  vendorName: string,
  productName: string,
): CatalogProductMatch | null {
  return resolveCatalogProduct(catalog, `${vendorName} ${productName}`);
}

/** Resolve a source brand to a unique canonical vendor already in the database. */
export function resolveCatalogVendor(
  catalog: ProductCatalog,
  vendorName: string,
): CatalogVendorMatch | null {
  const exact = uniqueMatch(catalog.exactVendors.get(normalizeCatalogName(vendorName)));
  if (exact) return { ...exact, match: "exact" };

  const compact = uniqueMatch(catalog.compactVendors.get(compactCatalogName(vendorName)));
  return compact ? { ...compact, match: "compact" } : null;
}

/** Split a new model name using token-boundary matches against database vendors. */
export function splitCatalogVendorProduct(
  catalog: ProductCatalog,
  fullName: string,
): (CatalogVendorMatch & { productName: string }) | null {
  const sourceTokens = tokenize(fullName);
  if (sourceTokens.length < 2) return null;

  const matches: Array<{
    vendor: CatalogVendor;
    aliasLength: number;
    tokenCount: number;
    productStart: number;
  }> = [];

  for (const vendor of catalog.vendors) {
    for (const alias of vendor.aliases) {
      const aliasTokens = tokenize(alias);
      if (aliasTokens.length === 0 || aliasTokens.length >= sourceTokens.length) continue;
      if (!aliasTokens.every((token, index) => token.value === sourceTokens[index].value)) {
        continue;
      }

      matches.push({
        vendor,
        aliasLength: normalizeCatalogName(alias).length,
        tokenCount: aliasTokens.length,
        productStart: sourceTokens[aliasTokens.length].start,
      });
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) =>
    b.tokenCount - a.tokenCount || b.aliasLength - a.aliasLength ||
    a.vendor.vendorSlug.localeCompare(b.vendor.vendorSlug)
  );

  const best = matches[0];
  const tiedVendors = new Set(
    matches
      .filter((match) =>
        match.tokenCount === best.tokenCount && match.aliasLength === best.aliasLength
      )
      .map((match) => match.vendor.vendorSlug),
  );
  if (tiedVendors.size !== 1) return null;

  return {
    vendorName: best.vendor.vendorName,
    vendorSlug: best.vendor.vendorSlug,
    productName: fullName.slice(best.productStart).trim(),
    match: "prefix",
  };
}
