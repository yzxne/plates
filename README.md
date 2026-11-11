# Plates

Personal nutrition + workout tracker. Mobile web app for iPhone Safari (Home Screen), dark mode, data stored in a Google Sheet the app creates.

**Status:** Phases 0–4 built (food logging, barcode, workouts) + brief v2 rework (Today / Progress / + / Train). Next: Phase 5 (weight & coaching).

## Layout

```
frontend/   Preact + TypeScript + Vite → GitHub Pages (no secrets)
backend/    Cloudflare Worker (TypeScript) → holds secrets, talks to Google
shared/     Sheet schema + settings rules used by both
docs/       reports, setup guides, data model, licenses
scripts/    secret check, icon generator
```

## Stack choice

- **Preact** (~4 KB) instead of React or plain JS: components and hooks keep many screens manageable, and the whole app is ~13 KB gzipped on the phone.
- **No URL routing**: screens are in-app state. GitHub Pages has no single-page-app fallback, and iOS Home Screen apps can re-ask camera permission when the URL hash changes.
- **Backend has no framework**: a small router is enough and keeps CPU time low on the Workers free plan.
- **Vitest** for tests; the backend tests run against a fake in-memory Google Sheets API.

## Commands (run in `C:\dev\plates`)

| What | Command |
|---|---|
| Install | `npm install` |
| All tests | `npm test` |
| Type check | `npm run typecheck` |
| Local backend | `npm run dev:api` (needs `backend/.dev.vars`) |
| Local frontend | `npm run dev:web` → http://localhost:5173/plates/ |
| Set Cloudflare secrets | `npm run setup-secrets -w backend` |
| Deploy backend | `npm run deploy -w backend` |
| Deploy frontend | push to `main` (GitHub Actions) |
| Scan for secrets | `npm run check-secrets` |
| Redraw icons | `npm run icons` |

Turn on the pre-commit secret check once per clone:

```bash
git config core.hooksPath .githooks
```

## Setup and deploy

1. Accounts: [docs/setup-guides.md](docs/setup-guides.md)
2. First deploy: [docs/deploy.md](docs/deploy.md)

## Docs

- [Data model](docs/data-model.md)
- [Phase 0 report](docs/phase0-report.md)
- [Assets and licenses](docs/assets-and-licenses.md)
- [Known limitations](docs/known-limitations.md)

## Data attribution

- Food data from [USDA FoodData Central](https://fdc.nal.usda.gov/) (public domain, CC0).
- Barcode data from [Open Food Facts](https://world.openfoodfacts.org/) (ODbL / DbCL).
