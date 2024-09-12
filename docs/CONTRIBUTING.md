# How to Contribute

## Overview

1. Create a branch of this repository.

2. Add or update vendors, products, EQ curves, or artwork.

3. Submit a pull request

4. Confirm that CI/CD passes for your changes. This ensures that there are no duplicates, and that data is well formed, and also prepares assets for consumers of the system.

5. Wait for review

If you use Roon, you can test your changes prior to merge by pointing your Roon application at your development branch.

## Respository layout

Documentation lives in the `docs/` directory.

Schemas live in the `schemas/` directory.

The `dist/` directory contains the current version of all database assets in a form suitable for distribution.

Human-maintained vendor, product, and EQ entries are in `database/`.

Tools, scripts, and other resources are in the `tools/` directory. Tools should be written using Javascript + [Deno](https://deno.com/) whenever possible.

## Database Structure

### Folder Layout within `database/`

```
├── database/vendors/
│   ├── <vendor_slug>/               Unique identifier for the vendor, e.g. "senheiser" or "audeze"
│   │   ├── info.json                      Information about the vendor
│   │   ├── logo.png                       Square logo, 1024x1024 with transparent background
│   │   ├── products/                      Sub-folder where products are kept
│   │   │   ├── <product_slug>/            Unique identifier for the product among these vendor's products, e.g. "hd600" or "lcd_5"
│   │   │   │   ├── info.json              Information about the product
│   │   │   │   ├── photo.png              Square product photo, 1024x1024 PNG
│   │   │   │   ├── line_art.svg           Line art SVG for the product
│   │   │   │   ├── eq/
│   │   │   │   │   ├── <eq_slug>/
│   │   │   │   │   │   ├── info.json
│   ├── ...
```

The `*_slug` folders are intended to be used as unique IDs to identify those items. By convention, slugs are lowercase, with spaces replaced by underscores.
Slugs are scoped to their folder, for example: `vendor_slug=sennheiser, product_slug=hd600, eq_slug=autoeq_harman_target`.

### vendor `info.json`

#### Example

```
{
    "name": "Sennheiser",
    "official_name": "Sennheiser electronic GmbH & Co. KG",
    "blurb": "Sennheiser electronic GmbH & Co. KG is a German audio equipment manufacturer headquartered in Wedemark. Sennheiser specializes in equipment for both the consumer and professional audio markets, including microphones, headphones, and loudspeakers.",
    "logo": "logo.png",
}
```

_See also, [../schemas/vendor_info.json](schemas/vendor_info.json) for the JSON schema that is used for validation._

#### Fields

- `name`: A friendly name for the vendor, as people understand the brand.
- `official_name`: The official name of the vendor, including company desginations.
- `blurb`: a 1-3 sentence blurb describing the brand. It should describe the brand in a neutral fashion, and is not meant to contain marketing copy.
- `logo`: The filename of a logo, if available. Conventionally, this should be `logo.png` and it should be placed next to the `info.json`. Logos should be square PNG files at 1024x1024 resolution with a transparent background. Logos may be omitted, and Roon Labs will help fill in gaps. (TODO: spec from B2)


### Product `info.json`

#### Example

```
{
    "name": "HD650",
    "blurb": "The Sennheiser HD 650 is a high-end, open-back, over-ear headphone designed primarily for audiophiles, sound engineers, and professional users who require accurate and detailed sound reproduction. Released by Sennheiser, a renowned German audio company, the HD 650 is known for its balanced sound signature, exceptional clarity, and wide soundstage.",
    "photo": "photo.jpg",
    "line_art": "line_art.svg",
    "type": "headphones",
    "subtype": "over-the-ear",
}
```

_See also, [../schemas/product_info.json](schemas/product_info.json) for the JSON schema that is used for validation._

#### Fields:

- `name`: The name of the product, as it appears in the product's marketing materials.
- `blurb`: A 1-3 sentence description of the product.
- `photo`: A photo of the product. (TODO: spec from B2)
- `line_art`: An SVG line art image (TODO: spec from B2)
- `type`: "headphones"
- `subtype`: `over-the-ear`, `on-the-ear`, `in-ear`

### EQ `info.json`

#### Example

```
{
    "name": "Brian's Relaxed HD650",
    "author": "Brian Luczkiewicz",
    "link": "http://roonlabs.com",
    "blurb": "A good starting point for improving the HD650s",
    "type": "parametric_eq",
    "parameters": {
      "gain_db": 0.0","
      "bands": [
        { "type": "low_shelf",  "frequency":    45, "gain_db":  3.0, "q": 0.5 },
        { "type": "high_shelf", "frequency": 14000, "gain_db":  5.0, "q": 0.7 },
        { "type": "low_shelf",  "frequency":   120, "gain_db":  3.0, "q": 0.8 },
        { "type": "peak_dip",   "frequency":  1200, "gain_db":  3.0, "q": 0.5 },
        { "type": "peak_dip",   "frequency":  8000, "gain_db": -6.0, "q": 5.8 },
      ]
    }
}
```

_See also, [../schemas/eq_info.json](schemas/eq_info.json) for the JSON schema that is used for validation._

#### Fields

- `name`: The name of the EQ curve
- `author`: The author of the EQ curve. Please keep this consistent across the author's output
- `link`: A link to the source, if applicable. This might link to a measurement PDF, another git repository, a forum post, etc.
- `blurb`: A 1-3 sentence description of the EQ curve.
- `type`: `parametric_eq`. We may support more types later.
- `parameters`: The parameters for the parametric equalizer
  - `gain_db`: An overall gain adjustment to apply as part of equalization.
  - `bands`: The parametric EQ bands, sorted by priority. Software that supports a limited number of bands should truncate the list.
    - `type`: The equalizer element type (see below)
    - `...`: Other parameters, according to type

#### EQ Band types

- `peak_dip`
  - `frequency`: The center frequency of the filter in Hz.
  - `gain_db`: The gain at the center frequency, in dB.
  - `q`: The "q value" for the band, which determines the width of the filter in the frequency domain.
- `high_shelf`
  - `frequency`: The center frequency of the filter in Hz.
  - `gain_db`: The gain at the center frequency, in dB.
  - `q`: The "q value" for the band, which determines the width of the filter in the frequency domain.
- `low_shelf`
  - `frequency`: The center frequency of the filter in Hz.
  - `gain_db`: The gain at the center frequency, in dB.
  - `q`: The "q value" for the band, which determines the width of the filter in the frequency domain.
- `low_pass`
  - `frequency`: The center frequency of the filter in Hz.
  - `slope`: The "slope" of the filter in dB/Octave. 6dB..36dB in 6dB increments. This represents the order of the filter (first order = 6dB, etc)
- `high_pass`
  - `frequency`: The center frequency of the filter in Hz.
  - `slope`: The "slope" of the filter in dB/Octave. 6dB..36dB in 6dB increments. This represents the order of the filter (first order = 6dB, etc)
- `band_pass`
  - `frequency`: The center frequency of the filter in Hz.
  - `q`: The "q value" for the band, which determines the width of the filter in the frequency domain.
- `band_stop`
  - `frequency`: The center frequency of the filter in Hz.
  - `q`: The "q value" for the band, which determines the width of the filter in the frequency domain.
