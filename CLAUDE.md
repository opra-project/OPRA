# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OPRA is an open, community-maintained database of headphone product information and EQ compensation curves. The database is stored in JSON format and automatically processed into a distributable format after each commit.

## Build & Validation Commands

```bash
# Build/validate the database and generate dist/ folder
deno run --allow-read --allow-write --allow-run tools/dist.ts

# Validate only (no file changes)
deno run --allow-read --allow-write --allow-run tools/dist.ts --validate-only
```

System dependencies for building: `librsvg2-bin`, `imagemagick` (provides `rsvg-convert` and `identify` commands)

## Architecture

### Directory Structure

- `database/vendors/` - Human-maintained vendor, product, and EQ data in JSON format
- `dist/` - Auto-generated distributable database (JSONL + content-addressed assets)
- `schemas/` - JSON schemas for validation (`vendor_info.json`, `product_info.json`, `eq_info.json`)
- `tools/` - Deno TypeScript scripts for processing and importing data

### Database Hierarchy

```
database/vendors/<vendor_slug>/
├── info.json                           # Vendor info (validated against schemas/vendor_info.json)
├── logo.png                            # 1024x1024 PNG logo
└── products/<product_slug>/
    ├── info.json                       # Product info (validated against schemas/product_info.json)
    ├── line_art.svg                    # 480x320 SVG line art
    └── eq/<eq_slug>/
        └── info.json                   # EQ curve (validated against schemas/eq_info.json)
```

### Build Pipeline (`tools/dist.ts`)

1. Walks `database/` for all `info.json` files
2. Validates each against JSON schemas using Ajv
3. Processes image assets (copies PNGs, converts SVGs to PNG at 96x64)
4. Stores assets in content-addressed paths: `dist/assets/<hash[0:2]>/<hash[2:4]>/<hash>.<ext>`
5. Writes `dist/database_v1.jsonl` with all entries (one JSON object per line)

### Output Format

`dist/database_v1.jsonl` contains newline-delimited JSON:
```json
{"type":"vendor","id":"sennheiser","data":{...}}
{"type":"product","id":"sennheiser::hd650","data":{...}}
{"type":"eq","id":"sennheiser:hd650::autoeq_harman","data":{...}}
```

## Key Tools

- `tools/dist.ts` - Main build script (generates dist/ from database/)
- `tools/import.ts` - Unified import entry point for external data sources
- `tools/autoeq/import.ts` - Imports data from the AutoEQ project
- `tools/oratory/import.ts` - CSV-driven oratory1990 import with PDF parsing
