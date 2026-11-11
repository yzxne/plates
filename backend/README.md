# Plates backend

Cloudflare Worker. Holds all secrets and proxies Google Sheets/Drive, USDA FoodData Central and Anthropic.

Secrets are set with `npx wrangler secret put <NAME>` and never committed. Local dev values go in `.dev.vars` (git-ignored).

No app code yet (Phase 1).
