# Security review (Phase 8, 2026-11-11)

Scope: the Worker (`backend/src`), the web app (`frontend/src`), secrets handling, dependencies. One user, personal app, public GitHub repo.

## What's in place

| Area | How | Status |
|---|---|---|
| Login | Passcode, PBKDF2-SHA256 (20k iterations, salted), constant-time compare. Hash stored only as a Worker secret. | OK |
| Brute force | 5 wrong passcodes per IP → 15 min lock; 20 wrong anywhere in an hour → all logins locked 1 h (KV). | OK |
| Sessions | HMAC-signed tokens, 30-day expiry, typed (`session` vs `oauth_state`). **New:** "Sign out other devices" rejects every session issued before that moment. | Fixed |
| CORS | Only `https://yzxne.github.io` gets CORS headers; other browser origins get 403. Requests without an Origin still need a valid session. | OK |
| Rate limit | 120 requests/min per IP per server instance on authenticated routes. AI calls also capped by the monthly $ cap and the Anthropic workspace limit. | OK (approximate by design) |
| Input validation | Tab names and columns checked against the schema; 500 rows / 1 MB per request (7 MB for photos); settings validated; AI images type/size checked. | OK |
| Spreadsheet injection | Writes use `RAW` input, so text like `=IMPORTDATA(…)` is stored as text, never run as a formula. Excel export writes strings as strings. | OK |
| Google tokens | Refresh token encrypted (AES-GCM) in KV; only the `drive.file` scope (Plates can see only files it created). | OK |
| Secrets in Git | None in the repo or history (scanned); pre-commit hook `scripts/check-secrets.sh` blocks key-like strings; `.dev.vars` git-ignored. | OK |
| Content-Security-Policy | Set in the built `index.html`: scripts only from the app itself (+ WebAssembly), API + Open Food Facts only for network, no plugins. **Fixed:** added `worker-src 'self' blob:` — without it the Excel export hung on the live site. | Fixed |
| XSS | No `innerHTML`/`dangerouslySetInnerHTML`/`eval` in app code; Preact escapes text. | OK |
| Files you import | Read on the device only. **Fixed:** pdf.js upgraded 5.7.284 → 6.5.438 (GHSA-hq66-cqwq-w95j: malicious PDF could run code). | Fixed |
| Dependencies | `npm audit`: 0 known vulnerabilities after the upgrade. | OK |
| Error messages | Unexpected errors return a generic message; details only in Worker logs. | OK |

## Accepted risks (single-user app)

- **Session token in localStorage.** Readable by script on the page; mitigated by the CSP and no third-party scripts. Cookies would need a same-site backend domain.
- **Rate limit is per server instance**, not global. The passcode lockout (KV) is global.
- **Sign-out-others takes up to ~1 minute** to reach every Cloudflare location (KV caching).
- **No 2FA.** The passcode + lockout is the only factor; keep it long (12+ characters).

## Recommendations for you

1. Use a long passcode (12+ characters). Change it with `npm.cmd run setup-secrets -w backend` if it was ever shared.
2. If a device is lost: Settings → **Sign out other devices**.
3. Export to Excel monthly (see `docs/backup.md`).
4. Keep the Anthropic workspace spend limit on.
