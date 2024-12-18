#!/usr/bin/env -S deno run --allow-all

import { join, basename, dirname } from "https://deno.land/std@0.203.0/path/mod.ts";
import { walk } from "https://deno.land/std@0.203.0/fs/walk.ts";
import Ajv from "https://cdn.skypack.dev/ajv@6?dts";

import {
  VendorInfo,
  ProductInfo,
  EQInfo,
} from "./schemas.ts";

// Load and compile schemas
const ajv = new Ajv();
const vendorSchema = JSON.parse(await Deno.readTextFile("../schemas/vendor_info.json"));
const productSchema = JSON.parse(await Deno.readTextFile("../schemas/product_info.json")); 
const eqSchema = JSON.parse(await Deno.readTextFile("../schemas/eq_info.json"));

const validateVendor = ajv.compile(vendorSchema);
const validateProduct = ajv.compile(productSchema);
const validateEq = ajv.compile(eqSchema);

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function normalizeForComparison(str: string): string {
  let ret = str
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '')
    .replace(/_research$/, '')
    .replace(/_acoustics$/, '')
    .replace(/_audio$/, '')
    .replace(/_hifi/, '')
    .replace(/_audio_design$/, '');

  // special cases for name variations
  if (ret == "bw" || ret == "bowerswilkins") {
    ret = "bowerswilkins";
  }
  if (ret == "lz" || ret == "lzhifi") {
    ret = "bowerswilkins";
  }
  if (ret == "drop") {
    ret = "massdrop";
  }

  return ret;
}

function promptForSubtype(vendorName: string, productName: string): string {
  const validSubtypes = ["over_the_ear", "on_ear", "in_ear", "earbuds"];
  
  while (true) {
    console.log(`\nPlease enter the headphone subtype for ${vendorName} ${productName}:`);
    console.log("1. over_the_ear");
    console.log("2. on_ear"); 
    console.log("3. in_ear");
    console.log("4. earbuds");
    
    const input = prompt("Enter number (1-4): ");
    const num = parseInt(input || "0");
    
    if (num >= 1 && num <= 4) {
      return validSubtypes[num - 1];
    }
    console.log("Invalid selection, please try again");
  }
}

class Database {
  path: string;
  vendors: Vendor[] = [];
  vendorCount: number = 0;
  productCount: number = 0;
  eqCount: number = 0;
}

class EQ {
  slug: string;
  keys: string[];
  info: EQInfo;
  path: string;
  parent: Product;
}

class Product {
  slug: string;
  keys: string[];
  info: ProductInfo;
  eqs: EQ[] = [];
  path: string;
  parent: Vendor;
}

class Vendor {
  slug: string;
  keys: string[];
  info: VendorInfo;
  products: Product[] = [];
  path: string;
  parent: Database;
}

async function loadDatabase(baseDir: string): Promise<Database> {
  const database = new Database();
  database.path = baseDir;
  const vendorsPath = join(baseDir, "vendors");

  for await (const entry of walk(vendorsPath, { maxDepth: 1 })) {
    if (entry.path === vendorsPath) continue;

    const vendorSlug = basename(entry.path);
    const vendorInfo = JSON.parse(await Deno.readTextFile(join(entry.path, "info.json")));

    const vendor = new Vendor();
    vendor.slug = vendorSlug;
    vendor.info = vendorInfo;
    vendor.path = entry.path;
    vendor.keys = [
      normalizeForComparison(vendorInfo.name),
      normalizeForComparison(vendorSlug)
    ];

    // Load all products for this vendor
    const productsPath = join(entry.path, "products");
    for await (const productEntry of walk(productsPath, { maxDepth: 1 })) {
      if (productEntry.path === productsPath) continue;

      const productSlug = basename(productEntry.path);
      const productInfo = JSON.parse(await Deno.readTextFile(join(productEntry.path, "info.json")));

      const product = new Product();
      product.slug = productSlug;
      product.info = productInfo;
      product.path = productEntry.path;
      product.keys = [
        normalizeForComparison(productInfo.name),
        normalizeForComparison(productSlug)
      ];

      // Load all EQs for this product
      const eqPath = join(productEntry.path, "eq");
      for await (const eqEntry of walk(eqPath, { maxDepth: 1 })) {
        if (eqEntry.path === eqPath) continue;

        const eqSlug = basename(eqEntry.path);
        try {
          const eqInfo = JSON.parse(await Deno.readTextFile(join(eqEntry.path, "info.json")));

          const eq = new EQ();
          eq.slug = eqSlug;
          eq.info = eqInfo;
          eq.path = eqEntry.path;
          eq.keys = [normalizeForComparison(eqSlug)];

          eq.parent = product;
          product.eqs.push(eq);
        } catch {
          log(`Error loading EQ info for ${eqSlug}`);
        }
      }

      product.parent = vendor;
      vendor.products.push(product);
    }

    vendor.parent = database;
    database.vendors.push(vendor);
  }

  // Compute counts
  database.vendorCount = database.vendors.length;
  database.productCount = database.vendors.reduce((sum, vendor) => sum + vendor.products.length, 0);
  database.eqCount = database.vendors.reduce((sum, vendor) => 
    sum + vendor.products.reduce((psum, product) => psum + product.eqs.length, 0), 0);

  return database;
}


function mergeProduct(sourceProduct: Product, targetVendor: Vendor): Product {
  // Try to find matching product in target vendor
  for (const targetProduct of targetVendor.products) {
    for (const sourceKey of sourceProduct.keys) {
      if (targetProduct.keys.includes(sourceKey)) {
        log(`Found matching product: ${sourceProduct.slug} -> ${targetProduct.slug}`);
        return targetProduct;
      }
    }
  }

  // No match found, create new product
  log(`Creating new product: ${sourceProduct.slug}`);
  
  // Create product directory and info.json in target vendor's products directory
  const productPath = join(targetVendor.path, "products", sourceProduct.slug);
  Deno.mkdirSync(productPath, { recursive: true });
  
  const newProduct = new Product();
  newProduct.slug = sourceProduct.slug;
  newProduct.info = { ...sourceProduct.info };
  
  // Prompt for subtype if unknown
  if (newProduct.info.subtype === "unknown") {
    newProduct.info.subtype = promptForSubtype(targetVendor.info.name, newProduct.info.name);
  }
  
  newProduct.path = productPath;
  newProduct.keys = [...sourceProduct.keys];
  newProduct.parent = targetVendor;
  
  // Validate product info before writing
  if (!validateProduct(newProduct.info)) {
    log(`Invalid product info for ${sourceProduct.slug}, skipping`);
    log(validateProduct.errors);
    return targetProduct || targetVendor.products[0]; // Return existing product or first product as fallback
  }

  // Write product info
  Deno.writeTextFileSync(
    join(productPath, "info.json"),
    JSON.stringify(newProduct.info, null, 2)
  );

  targetVendor.products.push(newProduct);
  return newProduct;
}

function mergeEq(sourceEq: EQ, targetProduct: Product): EQ {
  // Try to find matching EQ in target product
  for (const targetEq of targetProduct.eqs) {
    for (const sourceKey of sourceEq.keys) {
      if (targetEq.keys.includes(sourceKey)) {
        log(`Found matching EQ: ${sourceEq.slug} -> ${targetEq.slug}`);

        // ABS the q's, there are occasionally typos :(
        if (sourceEq.info.parameters) {
          for (let band of sourceEq.info.parameters.bands) {
            if (band.q < 0) band.q = -band.q;
          }
        }

        if (!validateEq(sourceEq.info)) {
          log(`Invalid EQ info in ${join(sourceEq.path, "info.json")}`);
          log(validateEq.errors);
        } else {
          // Update the existing EQ's info.json
          targetEq.info = { ...sourceEq.info };
          Deno.writeTextFileSync(
            join(targetEq.path, "info.json"),
            JSON.stringify(targetEq.info, null, 2)
          );
        }
        return targetEq;
      }
    }
  }

  // No match found, create new EQ
  log(`Creating new EQ: ${sourceEq.slug}`);
  
  // Create EQ directory and info.json in target product's eq directory
  const eqPath = join(targetProduct.path, "eq", sourceEq.slug);
  Deno.mkdirSync(eqPath, { recursive: true });
  
  const newEq = new EQ();
  newEq.slug = sourceEq.slug;
  newEq.info = { ...sourceEq.info };
  newEq.path = eqPath;
  newEq.keys = [...sourceEq.keys];
  newEq.parent = targetProduct;

  if (newEq.info.parameters) {
    // ABS the q's, there are occasionally typos :(
    for (let band of newEq.info.parameters.bands) {
      if (band.q < 0) band.q = -band.q;
    }
  }

  // Validate EQ info before writing
  if (!validateEq(newEq.info)) {
    log(`Invalid EQ info in ${join(eqPath, "info.json")}`);
    log(validateEq.errors);
    return undefined;
  }

  // Write EQ info
  Deno.writeTextFileSync(
    join(eqPath, "info.json"),
    JSON.stringify(newEq.info, null, 2)
  );

  targetProduct.eqs.push(newEq);
  return newEq;
}

function mergeVendor(sourceVendor: Vendor, targetVendors: Vendor[]): Vendor {
  // Try to find matching vendor in target
  for (const targetVendor of targetVendors) {
    for (const sourceKey of sourceVendor.keys) {
      if (targetVendor.keys.includes(sourceKey)) {
        log(`Found matching vendor: ${sourceVendor.slug} -> ${targetVendor.slug}`);
        return targetVendor;
      }
    }
  }

  // Log all vendors from target with their keys and also log our source keys on each line so i can debug
  log(`Source vendor keys: ${sourceVendor.keys}`);
  for (let targetVendor of targetVendors) {
    log(`Target vendor: ${targetVendor.slug}, keys: ${targetVendor.keys} VS ${sourceVendor.keys} out of ${targetVendors.length}`);
  }


  // No match found, create new vendor
  log(`Creating new vendor: ${sourceVendor.slug}`);
  
  // Create vendor directory and info.json in target vendors directory
  const vendorPath = join(targetVendors[0].parent.path, "vendors", sourceVendor.slug);
  Deno.mkdirSync(vendorPath, { recursive: true });
  
  const newVendor = new Vendor();
  newVendor.slug = sourceVendor.slug;
  newVendor.info = { ...sourceVendor.info };
  newVendor.path = vendorPath;
  newVendor.keys = [...sourceVendor.keys];
  
  // Validate vendor info before writing
  if (!validateVendor(newVendor.info)) {
    log(`Invalid vendor info for ${sourceVendor.slug}, skipping`);
    log(validateVendor.errors);
    return undefined;
  }

  // Write vendor info
  Deno.writeTextFileSync(
    join(vendorPath, "info.json"),
    JSON.stringify(newVendor.info, null, 2)
  );
  
  return newVendor;
}

async function mergeDirectories(srcDir: string, targetDir: string) {
  // Load databases
  const targetDb = await loadDatabase(targetDir);
  log(`Loaded ${targetDb.vendorCount} vendors, ${targetDb.productCount} products, and ${targetDb.eqCount} EQs from target`);

  const sourceDb = await loadDatabase(srcDir);
  log(`Loaded ${sourceDb.vendorCount} vendors, ${sourceDb.productCount} products, and ${sourceDb.eqCount} EQs from source`);

  for (let vendor of sourceDb.vendors) {
    const targetVendor = mergeVendor(vendor, targetDb.vendors);
    if (!targetVendor) {
      continue;
    }
    for (let product of vendor.products) {
      const targetProduct = mergeProduct(product, targetVendor);
      if (!targetProduct) {
        continue;
      }
      for (let eq of product.eqs) {
        mergeEq(eq, targetProduct);
      }
    }
  }
}

// Entry point
if (import.meta.main) {
  const args = Deno.args;
  if (args.length !== 2) {
    log("Usage: merge.ts <source_dir> <target_dir>");
    Deno.exit(1);
  }

  await mergeDirectories(args[0], args[1]);
}
