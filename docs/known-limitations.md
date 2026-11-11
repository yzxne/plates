# Known Limitations

Updated each phase.

- **No vibration on iPhone.** iOS Safari doesn't support `navigator.vibrate`. Rest timer uses sound + visual cue.
- **No Apple Health / steps.** Not available to web apps.
- **Camera quirks on iOS Home Screen apps.** Reports of rotated frames on iOS 26 and repeated permission prompts. Still-photo and manual entry fallbacks exist.
- **Open Food Facts per-IP limits** (15 product reads/min). Cached foods avoid repeat lookups.
- **Cloudflare free plan: 10 ms CPU per request.** Heavy work (.xlsx) runs in the browser.
- **Google refresh token** stops working if access is revoked, unused for 6 months, or 100+ new tokens are issued for the same client. The app will show "Reconnect Google" when this happens.
- **AI meal scan values are estimates.**
- **Session lives in the browser's storage** (bearer token, 30 days). Safari blocks cross-site cookies between github.io and workers.dev, so a cookie isn't an option. A strict Content-Security-Policy limits script injection. "Log out everywhere" = rotate `SESSION_SECRET` (re-run `npm run setup-secrets`).
- **Home Screen app and Safari tab have separate storage** on iOS: you log in once in each.
- **Login lockout is approximate**: KV is eventually consistent (~60 s), so a few extra guesses may slip through across Cloudflare locations.
- **Passcode hashing is moderate** (PBKDF2, 20,000 rounds) to fit the free plan's CPU limit. Protection relies mostly on the lockout and on the hash staying in Cloudflare secrets. Use 8+ characters. [Assumption: 20,000 rounds fits in 10 ms CPU — to be confirmed after first deploy.]
- **USDA search without a personal key** uses USDA's shared DEMO_KEY (30 searches/hour). Add your key with `npm.cmd run setup-secrets -- --usda` in `backend`.
- **USDA generic foods (Foundation / SR Legacy)** come per 100 g without a serving size in search results; enter grams.
- **Open Food Facts text search** goes through the backend (their search service doesn't allow browser calls). Barcode lookups (Phase 3) go straight from the phone.
- **Label parser** handles US Nutrition Facts and EU per-100 g tables; unusual layouts may need manual fixes on the confirm screen.
- **Days totals** are recalculated whenever the Food Log for that day is opened or edited.
- **Writes that fail** are kept on the phone (in browser storage) and retried; clearing Safari website data deletes them.
