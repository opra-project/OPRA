#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run --allow-net --allow-ffi

import { join, basename, extname, dirname } from "https://deno.land/std@0.203.0/path/mod.ts";
import { walk } from "https://deno.land/std@0.203.0/fs/walk.ts";

// Define Interfaces based on schemas

interface VendorInfo {
  name: string;
  official_name?: string;
  blurb: string;
  logo?: string;
}

interface ProductInfo {
  vendor_id?: string;
  name: string;
  blurb: string;
  line_art_svg?: string;
  line_art_96x64_png?: string;
  type: "headphones";
  subtype: "over_the_ear" | "on_ear" | "in_ear" | "earbuds";
}

interface EQParameter {
  type: "peak_dip" | "high_shelf" | "low_shelf" | "low_pass" | "high_pass" | "band_pass" | "band_stop";
  frequency: number;
  gain_db?: number;
  q?: number;
  slope?: 6 | 12 | 18 | 24 | 30 | 36;
}

interface EQParameters {
  gain_db: number;
  bands: EQParameter[];
}

interface EQInfo {
  product_id?: string;
  author: string;
  details: string;
  link?: string;
  type: "parametric_eq";
  parameters: EQParameters;
}

interface ParsedEQ {
  preamp: number;
  filters: EQParameter[];
}

// Utility Functions

/**
 * Converts a string to snake_case without punctuation.
 * @param str The input string.
 * @returns The snake_case version of the string.
 */
function generateSlug(str: string): string {
  return str
    .toLowerCase()
    .replace(/[\s\-()]+/g, "_")
    .replace(/[^\w_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function splitVendorModel(productName: string): Promise<string> {
    // Load API key from environment
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    
    if (!apiKey) {
        throw new Error("OpenAI API key not found in environment.");
    }

    let retries  = 10;
    let temp = 0.2;

    while (retries > 0) {
      try {
        // Define the GPT-4o-mini prompt
        const prompt = `Extract the vendor name and product name from the following product name: "${productName}". The vendor name is the part of the string that comes before the specific model or product designation. Your response should in the format { "vendorName": "Vendor Name", "productName": "Product Name" }.`;

        // Set up the API request
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                    { role: "system", content: "You are a helpful assistant." },
                    { role: "user", content: prompt }
                ],
                max_tokens: 100,
                temperature: temp,
            }),
        });

        // Parse the response
        const data = await response.json();
        
        // Extract the vendor name from the response
        const json = JSON.parse(data.choices?.[0]?.message?.content.trim());

        if (json && json.vendorName && json.productName) {
          return json;
        } else {
          console.error(`Failed to extract vendor and product names: ${data}`);
          retries--;
          temp += 0.05;
        }
      } catch (error) {
        console.error(`Failed to extract vendor and product names: ${error}`);
        retries--;
        temp += 0.05;
        continue;
      }
    }
}

/**
 * Parses a ParametricEQ.txt file content into a ParsedEQ object.
 * @param content The content of the ParametricEQ.txt file.
 * @returns The parsed EQ data.
 */
function parseParametricEQ(content: string): ParsedEQ {
  const lines = content.split("\n").map(line => line.trim()).filter(line => line);
  let preamp = 0;
  const filters: EQParameter[] = [];

  for (const line of lines) {
    if (line.startsWith("Preamp:")) {
      const match = line.match(/Preamp:\s*([-\d.]+)\s*dB/i);
      if (match) {
        preamp = parseFloat(match[1]);
      }
    } else if (line.startsWith("Filter")) {
      const filterMatch = line.match(
        /Filter\s+\d+:\s+ON\s+(\w+)\s+Fc\s+(\d+)\s+Hz\s+Gain\s+([-\d.]+)\s+dB(?:\s+Q\s+([-\d.]+))?/i
      );
      if (filterMatch) {
        const [, typeShort, freq, gain, q] = filterMatch;
        let type: EQParameter["type"] = "peak_dip";

        switch (typeShort.toUpperCase()) {
          case "LSC":
            type = "low_shelf";
            break;
          case "HSC":
            type = "high_shelf";
            break;
          case "PK":
            type = "peak_dip";
            break;
          // Add more mappings if needed
          default:
            type = "peak_dip";
        }

        const parameter: EQParameter = {
          type,
          frequency: parseFloat(freq),
          gain_db: parseFloat(gain),
        };

        if (type === "peak_dip" || type === "low_shelf" || type === "high_shelf") {
          parameter.q = q ? parseFloat(q) : undefined;
        }

        filters.push(parameter);
      }
    }
  }

  return { preamp, filters };
}

/**
 * Maps source type to schema subtype.
 * @param type The source type string.
 * @returns The corresponding subtype.
 */
function mapTypeToSubtype(type: string): ProductInfo["subtype"] {
  switch (type.toLowerCase()) {
    case "in-ear":
    case "in_ear":
      return "in_ear";
    case "over-ear":
    case "over_the_ear":
      return "over_the_ear";
    case "on-ear":
    case "on_ear":
      return "on_ear";
    case "earbud":
    case "earbuds":
      return "earbuds";
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}

/**
 * Logs messages with a timestamp.
 * @param message The message to log.
 */
function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// Main Processing Function

async function processSourceDirectory(srcDir: string, targetDir: string) {
  log(`Starting processing from "${srcDir}" to "${targetDir}"`);

  let gotit = false;

  // Iterate through all .txt files that end with 'ParametricEQ.txt'
  for await (const entry of walk(srcDir, { exts: [".txt"], includeFiles: true })) {
    const fileName = basename(entry.path);
    if (!fileName.endsWith("ParametricEQ.txt")) continue;

    if (entry.path == "../AutoEq/results/ToneDeafMonk/in-ear/EPZ Q5/EPZ Q5 ParametricEQ.txt") {
      gotit = true;
    }
    if (!gotit) {
      log(`Skipping ${entry.path}`);
      continue;
    }

    log(`Processing EQ file: "${entry.path}"`);

    // Extract paths
    const relativePath = entry.path.replace(srcDir, "").replace(/^\/+/, '').split(Deno.build.os === "windows" ? "\\" : "/");
    // Remove any leading empty strings due to leading '/'
    while (relativePath.length > 0 && relativePath[0] === "") {
      relativePath.shift();
    }

    // Expected relativePath structures:
    // 1. /<measurer>/<type>/<product_dir>/<product_name> ParametricEQ.txt
    // 2. /<measurer>/<product_dir_with_type>/<product_name> ParametricEQ.txt

    if (relativePath.length < 3) {
      log(`    Skipping invalid path: "${entry.path}" (insufficient path depth)`);
      continue;
    }

    const measurer = relativePath[0];
    let type: string;
    let productDirName: string;

    // Determine if the second segment is a type or part of the product directory
    const possibleType = relativePath[1].toLowerCase();
    const typeOptions = ["in-ear", "over-ear", "on-ear", "earbud", "earbuds"];

    if (typeOptions.includes(possibleType)) {
      // Structure: /<measurer>/<type>/<product_dir>/<file>
      type = possibleType;
      productDirName = relativePath[2];
    } else {
      // Structure: /<measurer>/<product_dir_with_type>/<file>
      // Attempt to extract type from product_dir_name
      const productDirMatch = relativePath[1].match(/(.+?)\s+(in-ear|over-ear|on-ear|earbud|earbuds)$/i);
      if (productDirMatch) {
        productDirName = productDirMatch[1];
        type = productDirMatch[2].toLowerCase();
        log(`    Extracted type "${type}" from product directory name.`);
      } else {
        log(`    Unable to determine type from path: "${entry.path}"`);
        continue;
      }
    }

    const productNameWithoutSuffix = fileName.replace(" ParametricEQ.txt", "");

    // Infer vendor/product split
    const { vendorName, productName } = await splitVendorModel(productNameWithoutSuffix);
    const vendorSlug = generateSlug(vendorName);
    const productSlug = generateSlug(productName);

    // Define target paths
    const vendorPath = join(targetDir, "vendors", vendorSlug);
    const vendorInfoPath = join(vendorPath, "info.json");
    const productsPath = join(vendorPath, "products");
    const productPath = join(productsPath, productSlug);
    const productInfoPath = join(productPath, "info.json");
    const eqPath = join(productPath, "eq");
    const eqSlug = `autoeq_${generateSlug(measurer)}`;
    const eqInfoPath = join(eqPath, eqSlug, "info.json");
    log(`    Vendor name: "${vendorName}", slug: "${vendorSlug}"`);
    log(`    Product name: "${productName}", slug: "${productSlug}`);
    log(`    EQ slug: "${eqSlug}"`);
    log(`    Vendor path: "${vendorPath}"`);
    log(`    Product path: "${productPath}"`);
    log(`    EQ path: "${eqPath}"`);

    // Ensure directories exist
    await Deno.mkdir(eqPath, { recursive: true });
    await Deno.mkdir(join(eqPath, eqSlug), { recursive: true });

    // Read ParametricEQ.txt
    let eqContent: string;
    try {
      eqContent = await Deno.readTextFile(entry.path);
    } catch (error) {
      log(`    Failed to read EQ file "${entry.path}": ${error}`);
      continue;
    }

    const parsedEQ = parseParametricEQ(eqContent);

    // Construct EQInfo
    const eqInfo: EQInfo = {
      author: `AutoEQ`,
      details: `Measured by ${measurer}`,
      type: "parametric_eq",
      parameters: {
        gain_db: parsedEQ.preamp,
        bands: parsedEQ.filters,
      },
    };

    // Write EQ info.json
    try {
      await Deno.writeTextFile(eqInfoPath, JSON.stringify(eqInfo, null, 2));
      log(`    Wrote EQ info.json at "${eqInfoPath}"`);
    } catch (error) {
      log(`    Failed to write EQ info.json at "${eqInfoPath}": ${error}`);
      continue;
    }

    // Construct ProductInfo
    const productInfo: ProductInfo = {
      name: productName,
      type: "headphones",
      subtype: mapTypeToSubtype(type),
    };

    // Write Product info.json
    try {
      await Deno.mkdir(productPath, { recursive: true });
      await Deno.writeTextFile(productInfoPath, JSON.stringify(productInfo, null, 2));
      log(`    Wrote Product info.json at "${productInfoPath}"`);
    } catch (error) {
      log(`    Failed to write Product info.json at "${productInfoPath}": ${error}`);
      continue;
    }

    // Construct VendorInfo if not exists
    try {
      await Deno.stat(vendorInfoPath);
      log(`    Vendor info.json already exists at "${vendorInfoPath}"`);
    } catch {
      // Vendor info.json does not exist, create it
      const vendorInfo: VendorInfo = {
        name: vendorName,
      };
      try {
        await Deno.writeTextFile(vendorInfoPath, JSON.stringify(vendorInfo, null, 2));
        log(`    Wrote Vendor info.json at "${vendorInfoPath}"`);
      } catch (error) {
        log(`    Failed to write Vendor info.json at "${vendorInfoPath}": ${error}`);
        continue;
      }
    }
  }

  log(`Processing completed.`);
}

// Entry Point
if (import.meta.main) {
  const args = Deno.args;
  if (args.length < 2) {
    console.error(`Usage: ${args[0]} <path/to/AutoeQ/results> <path/to/database>`);
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

  // Create target directory if it doesn't exist
  try {
    await Deno.mkdir(targetDir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create target directory "${targetDir}": ${error}`);
    Deno.exit(1);
  }

  await processSourceDirectory(srcDir, targetDir);
}

