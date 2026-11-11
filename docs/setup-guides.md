# Setup Guides

Do these in order. Website menus change often — if a button name differs, look for the closest match and tell me.

**Secret handling rule:** keys, client secrets and passcodes go into your **password manager** and later into Cloudflare via the terminal. Never paste them into chat, Obsidian, or any file in this folder.

You'll end up with these secrets (fill them in later in Phase 1):

| Name | From |
|---|---|
| `GOOGLE_CLIENT_ID` | Guide 3 |
| `GOOGLE_CLIENT_SECRET` | Guide 3 |
| `USDA_API_KEY` | Guide 4 |
| `ANTHROPIC_API_KEY` | Guide 5 |
| `PASSCODE_HASH`, `SESSION_SECRET`, `TOKEN_ENC_KEY` | Generated in Phase 1 |

---

## 0. Install tools on this PC

1. Open **PowerShell**.
2. Install Git:
   ```bash
   winget install --id Git.Git -e
   ```
3. Install Node.js (LTS):
   ```bash
   winget install --id OpenJS.NodeJS.LTS -e
   ```
4. Close and reopen PowerShell, then check:
   ```bash
   git --version
   ```
   ```bash
   node --version
   ```
5. Tell Git who you are (use the name/email you want on public commits — GitHub offers a private `noreply` email under Settings → Emails):
   ```bash
   git config --global user.name "Your Name"
   ```
   ```bash
   git config --global user.email "you@users.noreply.github.com"
   ```

## 1. GitHub repo + Pages

1. Sign in at https://github.com (create an account if needed).
2. Top right **+** → **New repository**.
3. Name: `plates`. Visibility: **Public**. Do **not** add a README, .gitignore or license (we have them).
4. Click **Create repository**. Leave the page open — I'll give you the push commands in Phase 1.
5. In the repo: **Settings** → **Pages** → **Build and deployment** → Source: **GitHub Actions**.
6. **Settings** → **Code security** (or "Advanced Security") → turn on **Secret Protection / Secret scanning** and **Push protection** (free for public repos).
7. Your app URL will be `https://<your-username>.github.io/plates/`. Send me your GitHub username (it's public anyway) so I can lock CORS to it.

## 2. Cloudflare account + Worker

1. Sign up at https://dash.cloudflare.com/sign-up (free plan; no card needed).
2. Verify your email.
3. Left menu → **Compute (Workers)** / **Workers & Pages**.
4. If asked, choose your **workers.dev subdomain** (e.g., `zane-plates`). Your backend URL will be `https://plates-api.<subdomain>.workers.dev`.
5. Stop there. In Phase 1, I'll create the Worker and KV storage from the terminal with `npx wrangler login` (opens a browser to approve), and you'll enter each secret with:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   ```
   It prompts for the value — you paste it into the terminal, not chat.
6. Send me your workers.dev subdomain.

## 3. Google Cloud project + OAuth

You need your workers.dev subdomain from Guide 2 for step 9.

1. Go to https://console.cloud.google.com and sign in with the Gmail that will own the spreadsheet.
2. Accept terms if asked. Top bar project picker → **New project** → Name `Plates` → **Create**. Make sure `Plates` is selected.
3. **Enable APIs**: menu ☰ → **APIs & Services** → **Library**.
   - Search **Google Sheets API** → **Enable**.
   - Back to Library → search **Google Drive API** → **Enable**.
4. Menu ☰ → **Google Auth Platform** (older name: "OAuth consent screen") → **Get started**.
   - App name: `Plates`. User support email: your Gmail.
   - Audience: **External**.
   - Contact email: your Gmail. Agree to the policy → **Create**.
5. **Data Access** → **Add or remove scopes** → find `.../auth/drive.file` ("See, edit, create, and delete only the specific Google Drive files you use with this app") → tick → **Update** → **Save**. Add no other scopes.
6. **Audience** → **Test users** → **Add users** → your Gmail → **Save**. (Status stays **Testing** for now.)
7. **Clients** → **Create client**.
8. Application type: **Web application**. Name: `Plates backend`.
9. **Authorized redirect URIs** → **Add URI**:
   `https://plates-api.<your-subdomain>.workers.dev/oauth/google/callback`
   (Leave "Authorized JavaScript origins" empty.)
10. **Create**. Copy the **Client ID** and **Client secret** into your password manager **immediately** — the secret may only be shown once.
11. **Don't publish yet.** In Phase 1, after the connection works, I'll ask you to go to **Audience** → **Publish app** → confirm, so status becomes **In production** (no more 7-day token expiry). Because we only use `drive.file`, I expect no verification and no warning screen — tell me if you see one.

## 4. USDA FoodData Central key

1. Go to https://fdc.nal.usda.gov/api-key-signup
2. Fill in name and email → submit.
3. The key arrives by email. Save it in your password manager.

## 5. Anthropic Console (API key, credit, spend limit)

1. Go to https://platform.claude.com and sign up / sign in.
2. **Settings** → **Billing** → **Buy credits**. Enter a small amount (the page shows the minimum). Leave **auto-reload off** — this makes the balance a hard cap.
3. **Settings** → **Workspaces** → **Create workspace** → name `Plates`.
4. Open the `Plates` workspace → set a **monthly spend limit** (e.g., $2). (The Default workspace can't have its own limit, which is why we make a new one.)
5. **API keys** → **Create key** → choose workspace **Plates** → name `plates-backend`.
6. Copy the key (starts with `sk-ant-`) into your password manager. It's shown once.

## What to send me (non-secret only)

- GitHub username
- Cloudflare workers.dev subdomain
- "Done" for Guides 0–5

Never send the client secret, API keys or passcode.
