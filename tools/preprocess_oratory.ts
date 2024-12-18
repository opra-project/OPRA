#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run --allow-net --allow-ffi

import { join, basename, extname } from "https://deno.land/std@0.203.0/path/mod.ts";
import { walk } from "https://deno.land/std@0.203.0/fs/walk.ts";
import { encodeBase64 } from "jsr:@sigma/rust-base64";
import { sleep } from "https://deno.land/x/sleep/mod.ts";
import { generateSlug, splitVendorModel, toTitleCase } from "./utils.ts";

import { 
  VendorInfo,
  ProductInfo,
  EQParameter,
  EQParameters,
  EQInfo,
  ParsedFilename
} from "./schemas.ts";

const eq_schema = {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "gain_db": {
          "type": "number",
          "description": "An overall gain adjustment to apply as part of equalization.",
        },
        "bands": {
          "type": "array",
          "description": "The parametric EQ bands, sorted by priority. Software that supports a limited number of bands should truncate the list.",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "type": {
                "type": "string",
                "description": "The equalizer element type.",
                "enum": [
                  "peak_dip", "high_shelf", "low_shelf"
                ]
              },
              "frequency": {
                "type": "number",
                "description": "The center frequency of the filter in Hz."
              },
              "gain_db": {
                "type": "number",
                "description": "The gain at the center frequency, in dB.",
              },
              "q": {
                "type": "number",
                "description": "The Q value for the band, which determines the width of the filter in the frequency domain.",
              },
            },
            "required": ["type", "frequency", "gain_db", "q" ]
          }
        }
      },
      "required": ["gain_db", "bands"]
    };

/**
 * Extracts EQ data from a PDF using GPT-4.
 */
async function extractEQData(pdfPath: string): Promise<EQParameters> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error("OpenAI API key not found in environment.");
  }

  // Create temp directory if it doesn't exist
  await Deno.mkdir("temp", { recursive: true });
  
  // Convert PDF to PNG using ImageMagick
  const tempPngPath = `temp/${basename(pdfPath, ".pdf")}.png`;
  
  let base64image = '';
  try {
    // Convert PDF to PNG using ImageMagick
    const convertCmd = new Deno.Command("convert", {
      args: [
        "-density", "300",      
        "-quality", "100",       
        "-background", "white",   
        "-flatten",                
        pdfPath,                    
        "-crop", "60%x20%+0+2400",
        "-trim",
        tempPngPath                  
      ]
    });
    const convertArgs = [
      "-density", "300",
      "-quality", "100",
      "-background", "white",
      "-flatten",
      pdfPath,
      "-crop", "60%x33%+0+0",
      tempPngPath
    ];
    console.log("convert " + convertArgs.join(" "));

    const convertResult = await convertCmd.output();
    if (!convertResult.success) {
      throw new Error(`Failed to convert PDF to PNG: ${new TextDecoder().decode(convertResult.stderr)}`);
    }

    // Read PNG file and get size
    const pngData = await Deno.readFile(tempPngPath);
    console.log(`    Converted PDF to PNG: ${tempPngPath} (${pngData.length} bytes)`);

    // Convert to base64 using Deno's standard library
    base64image = encodeBase64(pngData);

  } finally {
    // Clean up temporary PNG file
    try {
      await Deno.remove(tempPngPath);
    } catch (error) {
      console.error(`Failed to remove temporary PNG file: ${error}`);
    }
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Extract parametric EQ settings from the image",
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64image}`,
                detail: "high"
              },
            },
          ],
        },
      ],
      response_format: {
        "type": "json_schema",
        "json_schema": {
          "name": "eq",
          strict: true,
          "schema": eq_schema,
        }
      },
      temperature: 0.1,
    }),
  });

  const data = await response.json();
  //log(`    Response: ${JSON.stringify(data, null, 2)}`);
  return JSON.parse(data.choices[0].message.content);
}

function log(message: string) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

async function parseFilename(filename: string): Promise<ParsedFilename> {
  // Remove .pdf extension and extract parts
  const baseName = basename(filename, ".pdf");
  const matches = baseName.match(/^(.+?)\s*(?:\((.*?)\))?$/);
  if (!matches) {
    throw new Error(`Invalid filename format: ${filename}`);
  }
  const [, productPart, metadata] = matches;

  log(`    Parsing filename: "${baseName} -> product: "${productPart}", metadata: "${metadata}"`);

  // Use splitVendorModel to get vendor and product names
  const { vendorName: vendor, productName: product } = await splitVendorModel(productPart);

  // Process metadata for target and extra info
  let target = "Harman Target";
  let extra: string | undefined;

  if (metadata) {
    const lowerMeta = metadata.toLowerCase();
    if (lowerMeta.includes("harman")) {
      target = "Harman Target";
    } else if (lowerMeta.includes("oratory")) {
      target = "oratory1990 Target";
    } else if (lowerMeta.includes("target")) {
      target = metadata;
    } else {
      extra = toTitleCase(metadata);
    }
  }

  return { vendor, product, extra, target };
}

async function processDirectory(srcDir: string, targetDir: string) {
  log(`Starting PDF processing from "${srcDir}" to "${targetDir}"`);

  // Create target directory if it doesn't exist
  await Deno.mkdir(targetDir, { recursive: true });
  log(`Ensured target directory exists: "${targetDir}"`);

  // Collect all PDF files first
  const pdfFiles = [];
  for await (const entry of walk(srcDir, { exts: [".pdf"] })) {
    pdfFiles.push(entry);
  }
  log(`Found ${pdfFiles.length} PDF files to process`);

  // Process PDFs in chunks of 8
  const chunkSize = 8;
  for (let i = 0; i < pdfFiles.length; i += chunkSize) {
    const chunk = pdfFiles.slice(i, i + chunkSize);
    log(`Processing chunk of ${chunk.length} PDFs (${i + 1}-${Math.min(i + chunkSize, pdfFiles.length)} of ${pdfFiles.length})`);
    
    // Process chunk in parallel
    await Promise.all(chunk.map(async (entry) => {
      log(`Processing PDF file: "${entry.path}"`);
      try {
        // Parse filename
        const parsed = await parseFilename(entry.path);
        
        // Create paths
        const vendorSlug = generateSlug(parsed.vendor);
        const productSlug = generateSlug(parsed.product);
        const targetSlug = generateSlug(parsed.target);
        const extraSlug = parsed.extra ? `_${generateSlug(parsed.extra)}` : '';
        const eqSlug = `oratory1990_${targetSlug}${extraSlug}`;

        const vendorPath = join(targetDir, "vendors", vendorSlug);
        const productPath = join(vendorPath, "products", productSlug);
        const eqPath = join(productPath, "eq", eqSlug);

        // Check if EQ info already exists
        if (await exists(eqPath)) {
          log(`    Skipping - EQ info already exists at "${eqPath}"`);
          return;
        }

        log(`    Parsed filename: ${JSON.stringify(parsed)}`);
        log(`    Vendor slug: ${vendorSlug}`);
        log(`    Product slug: ${productSlug}`);

        // Extract EQ data
        const eqData = await extractEQData(entry.path);

        log(`    Extracted EQ data: ${JSON.stringify(eqData)}`);

        await Deno.mkdir(eqPath, { recursive: true });

        // Create vendor info if it doesn't exist
        const vendorInfoPath = join(vendorPath, "info.json");
        if (!await exists(vendorInfoPath)) {
          const vendorInfo: VendorInfo = {
            name: parsed.vendor,
          };
          const vendorInfoContent = JSON.stringify(vendorInfo, null, 2);
          await Deno.writeTextFile(vendorInfoPath, vendorInfoContent);
          log(`    Created vendor info at "${vendorInfoPath}":`);
          log(`${vendorInfoContent.split('\n').map(line => `      ${line}`).join('\n')}`);
        }

        // Create product info if it doesn't exist
        const productInfoPath = join(productPath, "info.json");
        if (!await exists(productInfoPath)) {
          const productInfo: ProductInfo = {
            name: parsed.product,
            type: "headphones",
            subtype: "unknown", 
          };
          const productInfoContent = JSON.stringify(productInfo, null, 2);
          await Deno.writeTextFile(productInfoPath, productInfoContent);
          log(`    Created product info at "${productInfoPath}":`);
          log(`${productInfoContent.split('\n').map(line => `      ${line}`).join('\n')}`);
        }

        // Create EQ info
        const eqInfo: EQInfo = {
          author: "oratory1990",
          details: parsed.extra ? `${parsed.target} • ${parsed.extra}` : parsed.target,
          type: "parametric_eq",
          parameters: eqData,
        };

        const eqInfoPath = join(eqPath, "info.json");
        const eqInfoContent = JSON.stringify(eqInfo, null, 2);
        await Deno.writeTextFile(eqInfoPath, eqInfoContent);
        log(`    Created EQ info at "${eqInfoPath}":`);
        log(`${eqInfoContent.split('\n').map(line => `      ${line}`).join('\n')}`);

      } catch (error) {
        log(`Error processing "${entry.path}": ${error.stack || error}`);
      }
    }));
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

// Entry point
if (import.meta.main) {
  const args = Deno.args;
  if (args.length !== 2) {
    log("Usage: preprocess_oratory.ts <source_dir> <target_dir>");
    Deno.exit(1);
  }

  await processDirectory(args[0], args[1]);
}
