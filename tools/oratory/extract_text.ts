/**
 * extract_text.ts - Extract text from Oratory1990 PDFs
 *
 * Uses unpdf library for cross-platform PDF text extraction.
 *
 * Usage:
 *   import { extractTextFromPdf } from "./extract_text.ts";
 *   const text = await extractTextFromPdf("path/to/file.pdf");
 */

import { getDocumentProxy, extractText } from "https://esm.sh/unpdf@0.12.1";

/**
 * Extract text content from a PDF file.
 *
 * @param pdfPath - Path to the PDF file
 * @returns The extracted text content
 */
export async function extractTextFromPdf(pdfPath: string): Promise<string> {
  const data = await Deno.readFile(pdfPath);
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

// CLI entry point
if (import.meta.main) {
  const args = Deno.args;

  if (args.length === 0) {
    console.log("Usage: deno run --allow-read tools/oratory/extract_text.ts <pdf_file>");
    Deno.exit(1);
  }

  const pdfPath = args[0];
  const text = await extractTextFromPdf(pdfPath);
  console.log(text);
}
