export interface Env {
  PLATES_KV: KVNamespace;

  // Plain vars (wrangler.jsonc / .dev.vars)
  ALLOWED_ORIGINS: string; // comma-separated, e.g. "https://yzxne.github.io"
  APP_URL: string; // where the OAuth callback sends you back, e.g. "https://yzxne.github.io/plates/"

  // Secrets (wrangler secret put)
  PASSCODE_HASH?: string;
  SESSION_SECRET?: string;
  TOKEN_ENC_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  USDA_API_KEY?: string; // optional: falls back to USDA's DEMO_KEY (30 requests/hour)
}

export const REQUIRED_SECRETS = [
  'PASSCODE_HASH',
  'SESSION_SECRET',
  'TOKEN_ENC_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
] as const;
