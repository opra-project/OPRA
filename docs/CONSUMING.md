# How to Consume the Database

The database is automatically generated in the `dist/` subfolder after every commit. 

## How to access the database

In order to minimize traffic to github, we have some guidelines for consuming the database:

 - For commercial products, please mirror or cache `dist/` folder on your own infrastructure. We have published sample code for proxying this database using the Cloudflare workers platform in `tools/rohdb-proxy`, and you are free to modify and deploy this as you see fit.
 - For open source, non-commercial, and personal use, feel free to fetch assets from `http://rohdb.roonlabs.net/database_v1.jsonl,assets/...`. This mirror is maintained by Roon Labs, served and cached globally by Cloudflare, and is no more than 5 minutes stale.
 - Access github directly only if you truly need up-to-the-minute results, for example for iterative development, debugging, or reviewing recently added data.

Thank you for following these guidelines, it helps us maintain availability of the database for all.

## Database Format

Start by downloading `database_v1.jsonl`. This contains a dump of all of the products, vendors, and EQs in JSONL format, with one entry per line. We 
expect this to contain 5,000-50,000 entries, so it should be practical for most apps to parse this on the fly without further processing.

The JSONL file is formatted as follows, with one JSON object per line, newline delimited:

    {"type":"vendor","id":"sennheiser","data":{...}}
    {"type":"product","id":"sennheiser_hd650","data":{...}}
    {"type":"eq","id":"sennheiser_hd650_brians_hd650","data":{...}}
    ...

The `data` property on each entry follows the following schemas:

- `vendor` => [vendor_info.json](../schemas/vendor_info.json)
- `product` => [product_info.json](../schemas/product_info.json)
- `eq` => [eq_info.json](../schemas/eq_info.json)

Graphics assets are referenced by a path relative to the `dist/` directory. For example:

    assets/31/13/31138e0c49d86b1c4b81c074b0b8157b8662512b1a9a92c814a4808e9060d65f.svg

can be found at

    REPOSITORY_ROOT/dist/assets/31/13/31138e0c49d86b1c4b81c074b0b8157b8662512b1a9a92c814a4808e9060d65f.svg


