# Phase 0 Report — Verification

Checked against official docs and live API calls on **2026-11-10**. Status: **Confirmed** / **Changed** (differs from the brief) / **Could not verify**.

## Summary

| # | Item | Status | Impact |
|---|---|---|---|
| 1 | Cloudflare Workers free tier | Confirmed, with one constraint | 10 ms CPU per request → generate .xlsx in the browser, not the Worker |
| 2 | Google OAuth "In production" | Changed (better) | `drive.file` is non-sensitive → likely **no** "unverified app" warning at all |
| 3 | `drive.file` + Sheets | Confirmed | `spreadsheets.create` accepts `drive.file` |
| 4 | Sheets API quotas | Confirmed | 60 reads + 60 writes / min per user — plenty with batching |
| 5 | USDA FoodData Central | Confirmed | 1,000 req/hr; UPC search works via `/foods/search` (tested) |
| 6 | Open Food Facts | Changed | Use **v3** (v2 deprecated). 15 product reads/min **per IP** — risk on Cloudflare shared IPs |
| 7 | iOS Safari camera | Partly verified | Works in tab + Home Screen; iOS 26 rotation reports; needs on-device test |
| 8 | Anthropic Haiku 5.5 | Confirmed / Changed | `claude-haiku-5-5`, $0.10 / $0.50 per MTok; ~$0.0005–0.001 per meal (cheaper than brief) |
| 9 | Spending controls | Confirmed | Console workspace spend limits exist (not on Default workspace) |
| 10 | xlsx library | Confirmed | `write-excel-file` 4.1.1 (MIT), in browser |
| — | **Local tooling** | **Missing** | Node.js, npm and Git are **not installed** on this PC |

---

## 1. Cloudflare Workers (free plan) — Confirmed

- 100,000 requests/day; **10 ms CPU** per request (waiting on network doesn't count as CPU); 50 subrequests per request; 128 MB memory; 64 secrets/vars per Worker.
- Secrets: stored encrypted via `wrangler secret put` or dashboard → not visible after saving.
- Workers KV (free): 100,000 reads/day, 1,000 writes/day, 1 write/sec per key. Enough for storing the Google refresh token and login-lockout counters.
- Durable Objects (SQLite-backed) are available on the free plan if we ever need them.
- **Rate Limiting binding**: documented, but I **could not verify** whether it's included on the free plan. Fallback: failed-login counter in KV with lockout.
- **Enough for one user?** Yes. Design consequences:
  - [Assumption] Passcode hashing with PBKDF2 must fit in 10 ms CPU. Workers caps PBKDF2 at ~100,000 iterations (third-party reports, not official docs). I'll measure in Phase 1; if it doesn't fit, options are fewer iterations + lockout, or Workers Paid ($5/mo — I'll ask first).
  - Sessions: stateless signed tokens (HMAC), no KV write per request.
  - .xlsx generation moves to the **browser** (see #10). The brief's `/export/xlsx` endpoint becomes a "fetch all data" endpoint.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [Rate limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [Durable Objects free tier](https://developers.cloudflare.com/changelog/post/2025-04-07-durable-objects-free-tier/)

## 2. Google OAuth — Changed (better than expected)

- Personal Gmail → **External** user type: confirmed.
- **"Testing" status → refresh tokens expire after 7 days**: confirmed.
- `drive.file` is a **non-sensitive** scope. Google shows the "unverified app" warning and applies the 100-user cap for **sensitive/restricted** scopes. So with only `drive.file`, publishing to **In production** most likely needs **no verification and shows no warning**. [Assumption] I'll confirm when you do it.
- Production refresh tokens have no fixed lifetime. They stop working if:
  - you revoke access (Google Account → Security → Third-party connections),
  - unused for **6 months** (our Worker uses it regularly, so not an issue),
  - more than **100 refresh tokens** are issued for the same client — oldest is silently invalidated (only matters if you reconnect 100+ times),
  - you grant time-limited access, or the request scopes don't match the consent screen.
- Password changes only revoke tokens with Gmail scopes — not ours.

Sources: [OAuth 2.0 refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Manage App Audience](https://support.google.com/cloud/answer/15549945), [Unverified apps](https://support.google.com/cloud/answer/7454865)

## 3. `drive.file` + Sheets API — Confirmed

- `spreadsheets.create` lists `drive.file` as an accepted scope. Files the app creates are covered for later reads/writes.
- Side effect: the app can't see sheets it didn't create (by design — good).

Sources: [spreadsheets.create](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/create), [Sheets scopes](https://developers.google.com/workspace/sheets/api/scopes), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

## 4. Sheets API quotas — Confirmed

- Reads: 300/min per project, **60/min per user**. Writes: same. No daily limit. 180 s timeout. ~2 MB payload recommended.
- Over quota → HTTP 429 → exponential backoff (up to 32–64 s).
- Design: one `batchGet` to load a screen, one `batchUpdate`/`append` per save, client-side debounce, backoff on 429, entries stay in a retry queue on failure.

Source: [Sheets API limits](https://developers.google.com/workspace/sheets/api/limits)

## 5. USDA FoodData Central — Confirmed

- Base `https://api.nal.usda.gov/fdc/v1/`. Endpoints: `/foods/search`, `/food/{fdcId}`, `/foods`, `/foods/list`.
- Key via data.gov signup. **1,000 requests/hour**; over → HTTP 429 and key blocked for 1 hour. `DEMO_KEY`: 30/hr, 50/day.
- Data: public domain (CC0). They ask for credit to FoodData Central.
- **Nutrient mapping (tested live)** — use `nutrientId`:

  | Nutrient | nutrientId | number |
  |---|---|---|
  | Energy (kcal) | 1008 | 208 |
  | Protein | 1003 | 203 |
  | Fat | 1004 | 204 |
  | Carbs (by difference) | 1005 | 205 |
  | Fiber | 1079 | 291 |
  | Sugars | 2000 | 269 |
  | Sodium (mg) | 1093 | 307 |

  Some Foundation foods report energy as 2047/2048 (Atwater) instead of 1008 → fallback order 1008 → 2047 → 2048 → compute 4/4/9.
- **UPC lookup**: not documented, but **works in testing** — `/foods/search?query=<UPC>&dataType=Branded` returned the matching product (`gtinUpc` field). Values for Branded foods are per 100 g, with `servingSize`/`servingSizeUnit`.

Source: [FDC API guide](https://fdc.nal.usda.gov/api-guide/)

## 6. Open Food Facts — Changed

- **v3 is current** (v3.6); v2 deprecated but working. Barcode: `GET https://world.openfoodfacts.org/api/v3.6/product/{barcode}.json?fields=...` (tested — works).
- User-Agent required: `AppName/Version (contact)`. I'll use `Plates/0.1 (<contact you choose>)` — **you pick the contact** (email or GitHub URL); it's sent to OFF.
- Rate limits **per IP**: 15 product reads/min, 10 searches/min (no search-as-you-type). Abuse can lead to an IP ban.
- Nutrient fields (tested): `nutriments.energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`, `fiber_100g`, `sugars_100g`, `sodium_100g` (**grams**, not mg), plus `_serving` variants; `serving_size` (text) and `serving_quantity` (number). Many products leave serving fields or fiber empty — must handle.
- License: database **ODbL**, contents **DbCL**, images **CC BY-SA**. Attribution: show "Data from Open Food Facts (ODbL)" with a link where OFF data appears; Foods cached in your sheet stay ODbL. We won't use their images.
- **Risk**: a Worker's outgoing IP is shared with other Cloudflare customers, so OFF's per-IP limit could be hit by others' traffic. **Option**: call OFF directly from your phone (no secret involved, so this doesn't break the security rule). Decision needed — see end.

Sources: [OFF API docs](https://openfoodfacts.github.io/openfoodfacts-server/api/)

## 7. Barcode scanning on iOS Safari — Partly verified

- `getUserMedia` works in Safari tabs and Home Screen web apps since iOS 13.4 (WebKit bug fixed).
- Known issues to design around (user reports, not Apple-confirmed):
  - iOS 26 Home Screen apps: camera frames reported **rotated 90°**, orientation stuck at portrait.
  - Standalone mode may **re-prompt camera permission when the URL hash changes** → avoid hash routing on the scanner screen.
  - `<video>` must have `playsinline` or iOS opens a black fullscreen player.
- **Decoder: `zxing-wasm` 3.1.6, MIT** (bundled zxing-cpp Apache-2.0). Reads EAN-13, EAN-8, UPC-A, UPC-E. Reader WASM ~1 MB, can be self-hosted (no CDN). Loaded only on the scan screen.
- **Could not verify** on your iPhone — Phase 3 test checklist covers it. Still-photo fallback (`<input type="file" capture>`) avoids the live-camera bugs.

Sources: [WebKit 185448](https://bugs.webkit.org/show_bug.cgi?id=185448), [Apple forum: iOS 26 camera rotation](https://developer.apple.com/forums/thread/801146), [WebKit 215884](https://bugs.webkit.org/show_bug.cgi?id=215884), [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)

## 8. Anthropic API — Confirmed / cost changed

- Model ID: **`claude-haiku-5-5`**.
- Price (prompts ≤100K tokens): **$0.10 / MTok input, $0.50 / MTok output**. (>100K: $0.50 / $2.50 — we'll never reach that.)
- Images: tokens = ⌈width/28⌉ × ⌈height/28⌉. High-resolution tier (max 2,576 px long edge, 4,784 tokens) applies to "Claude 4.7 and later" — Haiku 5.5 falls in that range by version. Max 600 images/request, 10 MB each, JPEG/PNG/GIF/WebP.
- Haiku 5.5 thinking is on by default (effort `medium`); thinking tokens bill as output. I'll set effort `low` and use structured JSON output.
- **Cost per meal** (2 photos at 1280×960 ≈ 46×35 = 1,610 tokens each):
  - Input ≈ 3,220 image + ~600 prompt = ~3,800 tokens → $0.00038
  - Output incl. thinking ≈ 300–1,000 tokens → $0.00015–0.0005
  - **≈ $0.0005–0.001 per two-photo meal** → $1 cap ≈ 1,000–2,000 scans/month. Brief estimated $0.001–0.002.
- 1280 px long edge is a good size; no need to go larger.
- Billing: **prepaid credits required** (Console → Billing → Buy credits). I **could not verify** a minimum purchase amount — the page will show it.

Sources: [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision), [Pricing](https://platform.claude.com/docs/en/about-claude/pricing), [How to pay for API usage](https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage)

## 9. Spending controls — Confirmed

- Console has **workspace spend limits**. Not available on the Default Workspace → create a "Plates" workspace, set a low monthly limit (e.g., $2), and create the API key inside it.
- Org-level monthly caps also exist by usage tier.
- Prepaid credits are a natural hard stop: buy a small amount, leave auto-reload **off**.
- App's own cap ($1 default) is still built in Phase 6.

Sources: [Workspaces](https://platform.claude.com/docs/en/manage-claude/workspaces), [Create and manage Workspaces](https://support.claude.com/en/articles/9796807-create-and-manage-workspaces-in-the-claude-console)

## 10. xlsx generation — Confirmed

| Library | Version | License | Notes |
|---|---|---|---|
| **write-excel-file** (pick) | 4.1.1 | MIT | Small, write-only, browser-friendly |
| exceljs | 4.4.0 | MIT | Fuller but heavy |
| xlsx (SheetJS) | npm 0.18.5 | Apache-2.0 | npm copy is stale (2022, known CVEs); current builds only on cdn.sheetjs.com |

- Generate in the **browser** (lazy-loaded) — avoids the Worker's 10 ms CPU limit.

---

## Other findings

- **Not installed**: Node.js, npm, Git. Needed before Phase 1 (setup guide step 0).
- **Vibration**: `navigator.vibrate` is **not supported** in iOS Safari. Rest timer will use a sound (after a tap unlocks audio) plus a visual flash.
- **Project location**: the original folder is in **OneDrive**, which is slow with `node_modules` and can corrupt `.git`. Code moved to `C:\dev\plates`.
- **Public repo + brief**: the brief contains your name, so it stays in the Obsidian vault, not the repo (also git-ignored as a backstop).

## Changes to the brief I'm proposing

1. .xlsx built in the browser; backend just returns the data.
2. OFF called from the phone directly (approved).
3. Login rate limiting via KV lockout counter unless the free-plan rate-limit binding is confirmed.
4. Hash-free routing (or at least on the scanner screen).

## Decisions (answered 2026-11-10)

1. License: **MIT** (`LICENSE`; copyright line says "Plates author" — change to your name/username if you like).
2. Repo location: **`C:\dev\plates`** (outside OneDrive). The Obsidian vault keeps the brief.
3. Open Food Facts: called **from the phone** directly. USDA and Anthropic stay behind the Worker.
4. Reference repo (someone else's calorie tracker): read for ideas only; copy code only if its license allows, with attribution; no branding/design.

Still open: OFF User-Agent contact (email or GitHub URL) — needed in Phase 3.

## Tested

- Git 2.56.0, Node 26.13.0, npm 11.20.0 installed (2026-11-10).
- Pre-commit hook blocks a fake `sk-ant-` key and a staged `.dev.vars` file; clean files pass. Repo initialized, nothing committed yet.

## Reference repo review (cal_scanner, Flutter, by another author)

- README claims MIT, but no LICENSE file in the download. No hidden content; `.env` holds only a placeholder.
- Nothing copied. Different stack (Flutter). Its AI call ships the API key inside the app and asks the AI for calories directly; its "Mifflin–St Jeor" function actually uses the revised Harris–Benedict constants. Its branding resembles a commercial app, so its images/assets are off-limits.

## Correction (2026-11-12, during Phase 3)

Open Food Facts **v3.6** returns nutrients in `product.nutrition.aggregated_set.nutrients` and an empty `nutriments`. My Phase 0 field-name test used the v3 endpoint, which still fills `nutriments`. Plates now reads both.

## Brief v2 checks (2026-11-11)

| # | Item | Status | Result |
|---|---|---|---|
| 11 | **Web push, Home Screen apps** | Confirmed (needs on-device test) | Works only from the **Home Screen app** (iOS 16.4+), permission must come from a tap, every push must show a notification. iOS 26 opens Home Screen sites as web apps by default. Plan: payload-free push signed with VAPID via Web Crypto (no extra library), scheduled by a **SQLite Durable Object alarm** (available on the free plan). Uses: rest-timer alert (normal notification sound, works locked, mirrors to Apple Watch, doesn't pause music) and optional reminders, off by default. |
| 12 | **Charting library** | Confirmed | **uPlot 1.6.32, MIT, ~21 KB gzip**, canvas, fast on phones — recommended for Progress charts, loaded only on that tab. Chart.js 4.6.1, MIT, ~69 KB gzip — heavier. Tiny sparklines/muscle bars stay as the custom SVG already built (0 KB). |
| 13 | **Chain calorie posting** | Confirmed | FDA: chains with **20+ locations**, same name, substantially the same menu must post calories and give written nutrition (calories, fats, cholesterol, sodium, carbs, sugar, fiber, protein) on request. Plates will look in saved foods / USDA branded / Open Food Facts first; it won't scrape restaurant sites. |
| 14 | **Native-app feel** | Partly verified | `touch-action: manipulation` speeds taps and is widely reported to stop double-tap zoom (WebKit documents only the speed-up). `user-scalable=no` is ignored since iOS 10 — not used. `overscroll-behavior` works on Safari 16+. Needs your on-device test. |
| 15 | **AI text-estimate cost** | Computed | ~800 input + ~600 output tokens (incl. thinking) on Haiku 5.5 ≈ **$0.0004 per estimate**, about half a two-photo scan. $1 cap ≈ 2,500 text estimates. |

Sources: [OneSignal iOS web push](https://documentation.onesignal.com/docs/en/web-push-for-ios), [progressivewebapps.com iOS push](https://progressivewebapps.com/background/ios-web-push/), [Cloudflare DO free tier](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier), [FDA menu labeling](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/menu-labeling-requirements), [WebKit: responsive tapping](https://webkit.org/blog/5610/more-responsive-tapping-on-iOS/), npm registry (uPlot, Chart.js).
