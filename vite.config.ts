import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { attachRelay } from './server/relay.ts';

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

/** Content hashes for asset(). */
const versions: Record<string, string> = {};
const assetVersions: Plugin = {
  name: 'asset-versions',
  apply: 'build',
  config() {
    for (const dir of ['map', 'people', 'textures']) {
      const path = fileURLToPath(new URL(`public/${dir}/`, import.meta.url));
      for (const f of readdirSync(path, { withFileTypes: true })) {
        if (f.isFile()) versions[`/${dir}/${f.name}`] = createHash('sha256').update(readFileSync(path + f.name)).digest('hex').slice(0, 10);
      }
    }
    return { define: { __ASSET_VERSIONS__: JSON.stringify(versions) } };
  },
  // preloads must match the fetch() URL exactly, else the file downloads twice
  transformIndexHtml: (html) => html.replace(/(<link rel="preload" href=")([^"?]+)"/g, (m, head: string, path: string) => (versions[path] ? `${head}${path}?v=${versions[path]}"` : m)),
};

/** Ship Rapier's WASM as a file, not 3.2 MB of base64: a third smaller, and it compiles while streaming. */
const rapierWasm: Plugin = {
  name: 'rapier-wasm-file',
  apply: 'build',
  transform(code, id) {
    if (!id.endsWith('rapier2d-compat/dist/rapier.mjs')) return;
    const inline = /module_or_path:\w+\.toByteArray\("AGFzbQ[A-Za-z0-9+/=]+"\)\.buffer/;
    if (!inline.test(code)) this.error('Rapier no longer inlines its WASM the way rapierWasm expects: update vite.config.ts');
    const wasm = JSON.stringify(`${id.replace(/rapier\.mjs$/, 'rapier_wasm2d_bg.wasm')}?url`);
    return { code: `import rapierWasmUrl from ${wasm};\n${code.replace(inline, 'module_or_path:rapierWasmUrl')}`, map: null };
  },
};

export default defineConfig({
  plugins: [relay, siteUrl, assetVersions, rapierWasm],
  build: {
    chunkSizeWarningLimit: 600, // three.js alone is ~590 kB
    rolldownOptions: {
      // own chunks, so a code-only deploy leaves the libraries cached
      output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ }, { name: 'rapier', test: /rapier2d-compat/ }] } },
    },
  },
  server: { watch: { ignored: ['**/data/**', '**/screenshots/**', '**/dist/**'] } }, // bulky generated folders kept the dev server busy
});
