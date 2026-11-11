/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

// Adds a Content-Security-Policy to the built index.html. The API origin comes from VITE_API_BASE.
function csp(apiBase: string): Plugin {
  return {
    name: 'plates-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!apiBase) {
        throw new Error('VITE_API_BASE is not set. Example: VITE_API_BASE=https://plates-api.<subdomain>.workers.dev');
      }
      const api = new URL(apiBase).origin;
      const policy = [
        "default-src 'self'",
        "script-src 'self' 'wasm-unsafe-eval'", // WebAssembly barcode decoder
        "style-src 'self'",
        "img-src 'self' data: blob:",
        `connect-src 'self' ${api} https://world.openfoodfacts.org`,
        "media-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ');
      return html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.VITE_BASE || '/plates/',
    plugins: [preact(), csp(env.VITE_API_BASE ?? '')],
    server: { fs: { allow: ['..'] } },
    build: { target: 'safari16', sourcemap: false },
    test: { include: ['test/**/*.test.ts'], environment: 'node' },
  };
});
