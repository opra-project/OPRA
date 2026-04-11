# Import Corrections System

## Problem

Upstream data sources (AutoEQ, oratory1990) contain naming errors and inconsistencies that create duplicate products in the database. Examples:

- **Broken names**: `"Omega on-off-off)"` (unbalanced parenthesis) creates `omega_on_off_off/` instead of landing under `omega/` with variant `on-off-off`
- **Inconsistent slugs**: `"Timless II"` (typo) creates `timless_ii/` duplicating `timeless_ii/`
- **Slug collisions**: `"AB1-266 Phi TC"` generates `ab1_266_phi_tc` duplicating existing `ab_1266_phi_tc`

These issues recur on every automated import since the upstream data doesn't change. Manual fixes get overwritten.

## Design

### Corrections file per source

Each import source gets a `corrections.json` file in its tool directory:

- `tools/autoeq/corrections.json`
- `tools/oratory/corrections.json`

Separating by source makes it easy to track what needs to be reported upstream.

### File format

```json
{
  "name_corrections": {
    "Alpha Omega Omega on-off-off)": "Alpha Omega Omega (on-off-off)",
    "Timless II": "Timeless II"
  },
  "slug_remaps": {
    "7hz::timless_ii": "7hz::timeless_ii",
    "abyss::ab1_266_phi_tc": "abyss::ab_1266_phi_tc"
  }
}
```

**`name_corrections`**: Maps broken upstream product names to corrected names. Applied to raw product names before any slug generation. This fixes the root cause so the name flows through the pipeline normally (variant extraction, slug generation, etc).

**`slug_remaps`**: Maps `vendor_slug::product_slug` to canonical `vendor_slug::product_slug`. Applied after slug generation, before path construction. Catches cases where the upstream name isn't "wrong" but produces a different slug than what we already have.

Both sections are optional and default to empty objects.

### Integration points

#### Name corrections

Applied early, before slug generation:

- **AutoEQ** (`tools/autoeq/import.ts`): After stripping the ` ParametricEQ.txt` suffix to get `productNameWithoutSuffix`, check `name_corrections[productNameWithoutSuffix]` (exact match) and replace if found. This happens before variant extraction and `splitVendorProductOrUnknown`, so the corrected name flows through variant extraction, vendor splitting, and slug generation naturally. Keys must include the full vendor+product string as it appears in the filename (e.g. `"Alpha Omega Omega on-off-off)"`).

- **Oratory** (`tools/oratory/import.ts`): After reading `model` from the CSV (line 478), check `name_corrections[model]` and replace if found. Before `generateSlug(model)`.

#### Slug remaps

Applied after slug generation, before path construction:

- **AutoEQ** (after line 146): After `vendorSlug` and `productSlug` are computed, check `slug_remaps[vendorSlug + "::" + productSlug]`. If found, parse the replacement to extract new vendor and product slugs. Use those for all path construction.

- **Oratory** (after line 505): Same pattern.

#### Loading

Each importer loads its own `corrections.json` at startup. Static file read, no per-entry overhead. If the file doesn't exist, both sections default to empty objects.

### Edge cases

**Name correction triggers variant extraction**: `"Omega on-off-off)"` corrected to `"Omega (on-off-off)"` means the existing variant regex now matches. The EQ lands under `omega/` with variant `on_off_off` in the EQ slug. No special handling needed.

**Slug remap changes vendor**: A remap like `"wrong_vendor::product"` to `"right_vendor::product"` changes the vendor path too. Supported by parsing both parts from the remap value.

**EQ slug collisions after remap**: If the remapped product already has the same EQ slug, the existing "already exists + compare" logic handles it — reports "unchanged" or "updated". No data loss.

**Missing corrections file**: Importer runs normally with no corrections applied.

### Logging

When a correction or remap is applied, log at normal level:

```
Name correction: "Omega on-off-off)" -> "Omega (on-off-off)"
Slug remap: 7hz::timless_ii -> 7hz::timeless_ii
```

## Initial corrections data

### AutoEQ (`tools/autoeq/corrections.json`)

```json
{
  "name_corrections": {
    "Alpha Omega Omega on-off-off)": "Alpha Omega Omega (on-off-off)"
  },
  "slug_remaps": {
    "7hz::timless_ii": "7hz::timeless_ii",
    "abyss::ab1_266_phi_tc": "abyss::ab_1266_phi_tc"
  }
}
```

### Oratory (`tools/oratory/corrections.json`)

```json
{
  "name_corrections": {},
  "slug_remaps": {}
}
```

No known oratory corrections at this time. File created for future use.

## Testing

- Unit test: name corrections applied before slug generation
- Unit test: slug remaps applied after slug generation, paths use remapped slugs
- Unit test: missing corrections file produces no errors
- Unit test: EQ data lands under correct product after remap
