#!/usr/bin/env -S deno run --allow-env --allow-read --allow-write --allow-run --allow-net

/**
 * import.ts - Unified import script for OPRA database
 *
 * Fetches and imports EQ profiles from AutoEQ and Oratory sources.
 *
 * Usage:
 *   deno run --allow-all tools/import.ts [options]
 *
 * Options:
 *   --autoeq-only           Only import AutoEQ source
 *   --oratory-only          Only import Oratory source
 *   --oratory-csv <path>    Path to oratory CSV file (required for oratory import)
 *   --skip-fetch            Skip fetching sources (use existing ./sources/)
 *   --skip-dist             Skip dist.ts rebuild after import
 *   --dry-run               Show what would change without writing
 *   --output-json           Output JSON summary (for CI/Slack integration)
 *   --verbose               Enable verbose logging
 *   --help                  Show this help message
 */

import { parse } from "https://deno.land/std@0.224.0/flags/mod.ts";
import { join, dirname, fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { ensureDir, exists } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { gray, brightGreen, yellow, red, cyan } from "https://deno.land/std@0.224.0/fmt/colors.ts";

// Import the actual import modules
import { importAutoEQ } from "./autoeq/import.ts";
import { importOratory } from "./oratory/import.ts";

// =============================================================================
// Types
// =============================================================================

interface ImportOptions {
  autoeqOnly: boolean;
  oratoryOnly: boolean;
  oratoryCsv: string;
  skipFetch: boolean;
  skipDist: boolean;
  dryRun: boolean;
  outputJson: boolean;
  verbose: boolean;
  help: boolean;
}

interface ImportStats {
  newVendors: number;
  newProducts: number;
  newEqs: number;
  updatedEqs: number;
  unchangedEqs: number;
  errors: number;
}

interface ImportSummary {
  autoeq: ImportStats;
  oratory: ImportStats;
  unknownTypes: string[];
  errors: { source: string; file: string; message: string }[];
}

// =============================================================================
// Constants
// =============================================================================

const SOURCES_DIR = "./sources";
const AUTOEQ_DIR = join(SOURCES_DIR, "autoeq");
const DATABASE_DIR = "./database";

const AUTOEQ_REPO = "https://github.com/jaakkopasanen/AutoEq.git";
const AUTOEQ_SPARSE_PATH = "results";

// =============================================================================
// Logging
// =============================================================================

let verboseEnabled = false;

const LOG_PREFIX = {
  INFO: brightGreen("[INFO]    "),
  WARN: yellow("[WARN]    "),
  ERROR: red("[ERROR]   "),
  DEBUG: gray("[DEBUG]   "),
  FETCH: cyan("[FETCH]   "),
  IMPORT: brightGreen("[IMPORT]  "),
  SKIP: gray("[SKIP]    "),
};

function log(level: keyof typeof LOG_PREFIX, message: string) {
  if (level === "DEBUG" && !verboseEnabled) return;
  console.log(`${LOG_PREFIX[level]}${message}`);
}

// =============================================================================
// CLI
// =============================================================================

function parseArgs(): ImportOptions {
  const args = parse(Deno.args, {
    boolean: ["autoeq-only", "oratory-only", "skip-fetch", "skip-dist", "dry-run", "output-json", "verbose", "help"],
    string: ["oratory-csv"],
    alias: {
      h: "help",
      v: "verbose",
      n: "dry-run",
    },
  });

  return {
    autoeqOnly: args["autoeq-only"] || false,
    oratoryOnly: args["oratory-only"] || false,
    oratoryCsv: args["oratory-csv"] || "",
    skipFetch: args["skip-fetch"] || false,
    skipDist: args["skip-dist"] || false,
    dryRun: args["dry-run"] || false,
    outputJson: args["output-json"] || false,
    verbose: args.verbose || false,
    help: args.help || false,
  };
}

function printHelp() {
  console.log(`
${brightGreen("import.ts")} - Unified import script for OPRA database

${cyan("USAGE:")}
  deno run --allow-all tools/import.ts [OPTIONS]

${cyan("OPTIONS:")}
  --autoeq-only           Only import AutoEQ source
  --oratory-only          Only import Oratory source
  --oratory-csv <path>    Path to oratory CSV (required for oratory import)
  --skip-fetch            Skip fetching sources (use existing ./sources/)
  --skip-dist             Skip dist.ts rebuild after import
  --dry-run, -n           Show what would change without writing
  --output-json           Output JSON summary (for CI/Slack integration)
  --verbose, -v           Enable verbose logging
  --help, -h              Show this help message

${cyan("EXAMPLES:")}
  # Import oratory from CSV (skip dist rebuild)
  deno run --allow-all tools/import.ts --oratory-csv ~/Downloads/Oratory_Feb25_2026.csv --skip-dist --verbose

  # Dry run to see what would change
  deno run --allow-all tools/import.ts --oratory-csv ~/Downloads/Oratory_Feb25_2026.csv --dry-run

  # Import AutoEQ only, skip fetching (use existing sources)
  deno run --allow-all tools/import.ts --autoeq-only --skip-fetch

  # CI mode with JSON output
  deno run --allow-all tools/import.ts --output-json

${cyan("SOURCES:")}
  AutoEQ:  ${AUTOEQ_REPO}
  Oratory: CSV with Dropbox links (--oratory-csv)
`);
}

// =============================================================================
// Git Operations
// =============================================================================

async function runCommand(cmd: string[], options?: { cwd?: string }): Promise<{ success: boolean; stdout: string; stderr: string }> {
  log("DEBUG", `Running: ${cmd.join(" ")}`);

  const process = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: options?.cwd,
    stdout: "piped",
    stderr: "piped",
  });

  const { code, stdout, stderr } = await process.output();

  return {
    success: code === 0,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function detectDefaultBranch(repoUrl: string): Promise<string> {
  log("DEBUG", `Detecting default branch for ${repoUrl}`);

  const result = await runCommand(["git", "ls-remote", "--symref", repoUrl, "HEAD"]);

  if (result.success) {
    const match = result.stdout.match(/ref: refs\/heads\/(\S+)\s+HEAD/);
    if (match) {
      log("DEBUG", `Detected default branch: ${match[1]}`);
      return match[1];
    }
  }

  for (const branch of ["main", "master"]) {
    const checkResult = await runCommand(["git", "ls-remote", "--heads", repoUrl, branch]);
    if (checkResult.success && checkResult.stdout.trim()) {
      log("DEBUG", `Found branch: ${branch}`);
      return branch;
    }
  }

  log("WARN", "Could not detect default branch, falling back to 'master'");
  return "master";
}

async function gitSparseClone(repoUrl: string, targetDir: string, sparsePath: string, branch?: string): Promise<boolean> {
  log("FETCH", `Sparse cloning ${repoUrl} (path: ${sparsePath})`);

  const targetBranch = branch || await detectDefaultBranch(repoUrl);
  log("INFO", `Using branch: ${targetBranch}`);

  const gitDir = join(targetDir, ".git");
  if (await exists(gitDir)) {
    log("INFO", `Repository already exists at ${targetDir}, pulling latest...`);

    const pullResult = await runCommand(["git", "pull", "--ff-only"], { cwd: targetDir });
    if (!pullResult.success) {
      log("ERROR", `Git pull failed: ${pullResult.stderr}`);
      return false;
    }

    log("INFO", "Pull successful");
    return true;
  }

  await ensureDir(dirname(targetDir));

  log("FETCH", "Initializing sparse clone...");

  const cloneResult = await runCommand([
    "git", "clone",
    "--depth", "1",
    "--filter=blob:none",
    "--sparse",
    "--branch", targetBranch,
    repoUrl,
    targetDir,
  ]);

  if (!cloneResult.success) {
    log("ERROR", `Git clone failed: ${cloneResult.stderr}`);
    return false;
  }

  log("FETCH", `Setting sparse-checkout to '${sparsePath}'...`);

  const sparseResult = await runCommand(
    ["git", "sparse-checkout", "set", sparsePath],
    { cwd: targetDir }
  );

  if (!sparseResult.success) {
    log("ERROR", `Sparse checkout failed: ${sparseResult.stderr}`);
    return false;
  }

  log("INFO", `Sparse clone complete at ${targetDir}`);
  return true;
}

// =============================================================================
// Source Fetching
// =============================================================================

async function fetchAutoEQ(dryRun: boolean): Promise<boolean> {
  log("FETCH", "Fetching AutoEQ source...");

  if (dryRun) {
    log("INFO", `[DRY-RUN] Would sparse clone AutoEQ to ${AUTOEQ_DIR}`);
    return true;
  }

  return await gitSparseClone(AUTOEQ_REPO, AUTOEQ_DIR, AUTOEQ_SPARSE_PATH);
}

// =============================================================================
// Import Operations
// =============================================================================

function createEmptyStats(): ImportStats {
  return {
    newVendors: 0,
    newProducts: 0,
    newEqs: 0,
    updatedEqs: 0,
    unchangedEqs: 0,
    errors: 0,
  };
}

async function runAutoEQImport(options: ImportOptions): Promise<{ stats: ImportStats; unknownTypes: string[]; errors: { source: string; file: string; message: string }[] }> {
  log("IMPORT", "Starting AutoEQ import...");

  const resultsDir = join(AUTOEQ_DIR, "results");

  if (!await exists(resultsDir)) {
    log("ERROR", `AutoEQ results directory not found: ${resultsDir}`);
    log("INFO", "Run without --skip-fetch to clone the AutoEQ repository");
    return {
      stats: { ...createEmptyStats(), errors: 1 },
      unknownTypes: [],
      errors: [{ source: "autoeq", file: resultsDir, message: "Results directory not found" }],
    };
  }

  const result = await importAutoEQ(resultsDir, DATABASE_DIR, {
    dryRun: options.dryRun,
    verbose: options.verbose,
    onProgress: (msg) => log("DEBUG", msg),
  });

  return {
    stats: result.stats,
    unknownTypes: result.unknownTypes,
    errors: result.errors.map(e => ({ source: "autoeq", ...e })),
  };
}

async function runOratoryImport(options: ImportOptions): Promise<{ stats: ImportStats; unknownTypes: string[]; errors: { source: string; file: string; message: string }[] }> {
  log("IMPORT", "Starting Oratory import...");

  if (!options.oratoryCsv) {
    log("ERROR", "No --oratory-csv path provided");
    return {
      stats: { ...createEmptyStats(), errors: 1 },
      unknownTypes: [],
      errors: [{ source: "oratory", file: "cli", message: "Missing --oratory-csv argument" }],
    };
  }

  const result = await importOratory(DATABASE_DIR, {
    csvPath: options.oratoryCsv,
    dryRun: options.dryRun,
    verbose: options.verbose,
    onProgress: (msg) => log("DEBUG", msg),
  });

  return {
    stats: result.stats,
    unknownTypes: result.unknownTypes,
    errors: result.errors.map(e => ({ source: "oratory", ...e })),
  };
}

async function rebuildDist(dryRun: boolean): Promise<boolean> {
  log("INFO", "Rebuilding dist database...");

  if (dryRun) {
    log("INFO", "[DRY-RUN] Would run dist.ts to rebuild database");
    return true;
  }

  const scriptDir = dirname(fromFileUrl(import.meta.url));
  const result = await runCommand([
    "deno", "run", "--allow-all",
    join(scriptDir, "dist.ts"),
  ]);

  if (!result.success) {
    log("ERROR", `dist.ts failed: ${result.stderr}`);
    return false;
  }

  return true;
}

// =============================================================================
// Summary Output
// =============================================================================

function printSummary(summary: ImportSummary, asJson: boolean) {
  if (asJson) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log("\n" + "=".repeat(60));
  console.log(brightGreen("Import Summary"));
  console.log("=".repeat(60));

  console.log("\nAutoEQ:");
  console.log(`  New vendors:    ${summary.autoeq.newVendors}`);
  console.log(`  New products:   ${summary.autoeq.newProducts}`);
  console.log(`  New EQs:        ${summary.autoeq.newEqs}`);
  console.log(`  Updated EQs:    ${summary.autoeq.updatedEqs}`);
  console.log(`  Unchanged EQs:  ${summary.autoeq.unchangedEqs}`);
  console.log(`  Errors:         ${summary.autoeq.errors}`);

  console.log("\nOratory:");
  console.log(`  New vendors:    ${summary.oratory.newVendors}`);
  console.log(`  New products:   ${summary.oratory.newProducts}`);
  console.log(`  New EQs:        ${summary.oratory.newEqs}`);
  console.log(`  Updated EQs:    ${summary.oratory.updatedEqs}`);
  console.log(`  Unchanged EQs:  ${summary.oratory.unchangedEqs}`);
  console.log(`  Errors:         ${summary.oratory.errors}`);

  if (summary.unknownTypes.length > 0) {
    console.log(yellow("\nProducts with unknown type (need manual review):"));
    for (const product of summary.unknownTypes.slice(0, 10)) {
      console.log(`  - ${product}`);
    }
    if (summary.unknownTypes.length > 10) {
      console.log(`  ... and ${summary.unknownTypes.length - 10} more`);
    }
  }

  if (summary.errors.length > 0) {
    console.log(red("\nErrors:"));
    for (const error of summary.errors.slice(0, 10)) {
      console.log(`  [${error.source}] ${error.file}: ${error.message}`);
    }
    if (summary.errors.length > 10) {
      console.log(`  ... and ${summary.errors.length - 10} more`);
    }
  }

  console.log("\n" + "=".repeat(60));
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    Deno.exit(0);
  }

  verboseEnabled = options.verbose;

  log("INFO", "OPRA Import Pipeline");
  log("DEBUG", `Options: ${JSON.stringify(options)}`);

  if (options.dryRun) {
    log("WARN", "DRY-RUN MODE - no changes will be made");
  }

  const summary: ImportSummary = {
    autoeq: createEmptyStats(),
    oratory: createEmptyStats(),
    unknownTypes: [],
    errors: [],
  };

  // Step 1: Fetch sources (AutoEQ only — Oratory downloads are handled by the CSV importer)
  if (!options.skipFetch) {
    if (!options.oratoryOnly) {
      const autoeqSuccess = await fetchAutoEQ(options.dryRun);
      if (!autoeqSuccess) {
        log("ERROR", "Failed to fetch AutoEQ source");
        summary.errors.push({ source: "autoeq", file: "fetch", message: "Failed to fetch" });
      }
    }
  } else {
    log("INFO", "Skipping source fetch (--skip-fetch)");
  }

  // Step 2: Import AutoEQ
  if (!options.oratoryOnly) {
    const result = await runAutoEQImport(options);
    summary.autoeq = result.stats;
    summary.unknownTypes.push(...result.unknownTypes);
    summary.errors.push(...result.errors);
  }

  // Step 3: Import Oratory
  if (!options.autoeqOnly) {
    const result = await runOratoryImport(options);
    summary.oratory = result.stats;
    summary.unknownTypes.push(...result.unknownTypes);
    summary.errors.push(...result.errors);
  }

  // Step 4: Rebuild dist
  if (!options.skipDist) {
    const distSuccess = await rebuildDist(options.dryRun);
    if (!distSuccess) {
      log("ERROR", "Failed to rebuild dist");
      summary.errors.push({ source: "dist", file: "dist.ts", message: "Failed to rebuild" });
    }
  } else {
    log("INFO", "Skipping dist rebuild (--skip-dist)");
  }

  // Step 5: Print summary
  printSummary(summary, options.outputJson);

  // Exit with appropriate code
  const hasErrors = summary.errors.length > 0;
  Deno.exit(hasErrors ? 1 : 0);
}

// Entry point
if (import.meta.main) {
  main();
}
