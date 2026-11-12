# Backing up your Plates data

All your data lives in **one Google Sheet** called "Plates" in your Google Drive. Plates itself stores nothing else (the backend only keeps your Google connection and settings for push notifications).

## What already protects you

1. **Google Sheets version history.** Every change is saved. In the Sheet: **File → Version history → See version history**. Pick a time and **Restore this version** to undo anything (a bad import, an accidental delete).
2. **Soft deletes.** When you delete something in Plates it stays in the Sheet with a `deleted_at` date; it is only hidden.
3. **Retry queue.** If a save fails (no signal), Plates keeps it on the phone and retries; Settings shows anything still waiting.

## Automatic weekly backups (nothing to do)

Every **Monday at 10:00 UTC** the Plates server asks Google to export your Sheet as Excel and stores the file on Cloudflare (outside Google). The newest **8** are kept (about 2 months).

- See or download them: Plates → gear → **Import & export** → **Automatic backups**.
- **Back up now** makes one immediately (e.g. before a big import).
- Now and then, download one to your PC / iCloud Drive for a third copy.

Manual export (**Export to Excel**) still works the same.

## If something goes wrong

| Problem | Fix |
|---|---|
| You deleted or changed something by mistake | Sheet → File → Version history → restore an earlier version. |
| An import added something wrong | Version history → restore the version from just before the import. |
| The Sheet was deleted | Google Drive → Trash → restore it. Then in Plates: Settings → Google connection → it reconnects to the same file. |
| Your Google account is gone | Create a new Sheet (Settings → Google connection → Create new), then open your latest .xlsx and copy each tab's rows into the matching tab. |
| A phone is lost | Settings → **Sign out other devices**. Others are signed out within about a minute. Change the passcode too if it was saved on that phone (`npm.cmd run setup-secrets -w backend` on your PC). |

## What is *not* in the Sheet

- The rest-timer notification subscription (re-enable in Settings → Notifications).
- Photos used for AI estimates (never stored).
- Your secrets (passcode hash, Google and Anthropic keys) — they live only in Cloudflare's secret storage. If you ever rebuild the backend, run the setup guides again.
