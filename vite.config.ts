import { defineConfig, type Plugin } from 'vite';
import { attachRelay } from './server/relay';

/** The dev and preview servers host the multiplayer relay on /net, so `pnpm dev` alone is enough to play together. */
const relay: Plugin = {
  name: 'multiplayer-relay',
  configureServer(server) {
    if (server.httpServer) attachRelay(server.httpServer);
  },
  configurePreviewServer(server) {
    attachRelay(server.httpServer);
  },
};

/** Link previews want absolute og: URLs: fills %SITE_URL% from SITE_URL or Vercel's domain (empty locally). */
const siteUrl: Plugin = {
  name: 'site-url',
  transformIndexHtml: {
    order: 'pre', // before Vite's own %ENV% replacement, which would warn about an unknown variable
    handler(html) {
      const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
      const url = process.env.SITE_URL ?? (vercel ? `https://${vercel}` : '');
      return html.replaceAll('%SITE_URL%', url.replace(/\/$/, ''));
    },
  },
};

export default defineConfig({
  plugins: [relay, siteUrl],
  build: { chunkSizeWarningLimit: 4500 }, // three.js + Rapier's WASM inlined as base64: one ~1.4 MB gzipped chunk, expected
  server: { watch: { ignored: ['**/data/**', '**/screenshots/**', '**/dist/**'] } }, // bulky generated folders kept the dev server busy
});
