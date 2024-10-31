# OPRA Database Proxy

This is a proxy for the OPRA database to avoid excessive traffic 
to github.com, which bills by the gigabyte.

This is built to run on the Cloudflare Workers platform, which is a serverless
platform that runs JavaScript code at the edge of Cloudflare's network.

The cache uses standard HTTP headers like `ETag`, `If-None-Match` and `Cache-Control` 
along with Cloudflare's caching infrastructure.

In order to deploy this yourself, you will need a Cloudflare domain configured with
workers support enabled. Edit `wrangler.toml` to set the `account_id` and `route` 
appropriately, `wrangler deploy` and then you should be running.

