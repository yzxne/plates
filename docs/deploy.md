# First Deploy (Phase 1)

Run everything in **PowerShell** from `C:\dev\plates` unless it says otherwise. Do the setup guides first ([setup-guides.md](setup-guides.md): GitHub, Cloudflare, Google Cloud steps 1–10).

Never paste secrets into chat. The scripts below ask for them and send them straight to Cloudflare.

## A. Log in to Cloudflare from this PC

```bash
cd C:\dev\plates\backend
```
```bash
npx wrangler login
```
A browser opens → **Allow**. Back in PowerShell it says you're logged in.

## B. Create the storage (KV)

```bash
npx wrangler kv namespace create PLATES_KV
```
It prints an `id = "..."` value. Open `backend\wrangler.jsonc` in Notepad and replace `REPLACE_WITH_KV_NAMESPACE_ID` with that id. Save. (The id isn't secret.)

## C. Deploy the backend once (to get its URL)

```bash
npm run deploy
```
Note the URL it prints, like `https://plates-api.<your-subdomain>.workers.dev`. Send me the subdomain.

**Google Cloud check:** your OAuth client's redirect URI must be exactly `https://plates-api.<your-subdomain>.workers.dev/oauth/google/callback`. Fix it in Google Cloud → Google Auth Platform → Clients if needed.

## D. Set the secrets

```bash
npm run setup-secrets
```
It will:
1. Create two random keys (session + token encryption) — you see nothing, that's fine.
2. Ask for your **new passcode** twice (8+ characters; it's hidden). Pick something you'll remember — I can't recover it, only reset it.
3. Ask for your **Google Client ID**, then **Client secret** (hidden).

Each line should end in `done`.

## E. Put the code on GitHub (I'll do this with your OK)

The first commit + push makes the code public in `yzxne/plates`. The secret scanner runs first. I'll ask before pushing.

## F. Tell GitHub where the backend is

1. github.com/yzxne/plates → **Settings** → **Secrets and variables** → **Actions** → **Variables** tab → **New repository variable**.
2. Name `API_BASE`, value `https://plates-api.<your-subdomain>.workers.dev` → **Add variable**. (A variable, not a secret — it's public anyway.)
3. **Actions** tab → **Test and deploy frontend** → **Run workflow** (or push any change).
4. When it's green, open `https://yzxne.github.io/plates/`.

## G. Test on your iPhone

1. Open `https://yzxne.github.io/plates/` in **Safari**.
2. Enter your passcode → you should see the Dashboard.
3. **More** → **Connect Google** → pick your Gmail.
   - You'll likely see "Google hasn't verified this app" while the app is in **Testing**: tap **Continue**.
   - Make sure the box for Drive access is **ticked** → **Continue**.
4. Back in Plates: "Google connected". Tap **Create Plates spreadsheet**.
5. Tap **Open sheet** — a "Plates" spreadsheet with 12 tabs opens.
6. **More** → **Settings** → change **Goal** to "Lose weight" → **Save**. You should see "Saved to your Google Sheet".
7. In the spreadsheet, **Settings** tab → the `goal_type` row now says `lose`. ✅ That's the Phase 1 end-to-end test.
8. Share → **Add to Home Screen** → open Plates from the icon and log in once more (Home Screen apps have separate storage).

## H. Switch Google to "In production" (after step G works)

Google Cloud → **Google Auth Platform** → **Audience** → **Publish app** → **Confirm**. This stops the 7-day token expiry. Then in Plates: **More** → **Disconnect Google** → **Connect Google** again so the new long-lived token is used. Tell me whether Google showed a warning screen.

## If something fails

| You see | Fix |
|---|---|
| "Backend setup incomplete — missing: …" | Re-run `npm run setup-secrets` (or `-- --google` for just Google) |
| "This origin is not allowed" | Open the app at `https://yzxne.github.io/plates/` exactly |
| `redirect_uri_mismatch` from Google | Redirect URI in Google Cloud must match step C exactly |
| "Google sign-in failed" / access blocked | Add your Gmail under Audience → Test users (while in Testing) |
| Wrong passcode, locked out | Wait 15 minutes, or reset with `npm run setup-secrets -- --passcode` |
