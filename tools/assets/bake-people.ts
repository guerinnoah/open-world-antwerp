import { readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { DEV, open, type Any } from '../dev/probe.ts';
import { ANIMS, AVATARS } from './fetch-people.ts';

const OUT = 'public/people';
await mkdir(OUT, { recursive: true });
const { browser, page } = await open();
await page.goto(`${DEV}/tools/assets/people/bake.html`);
await page.waitForFunction(() => (window as Any).ready, null, { timeout: 60_000 });

const manifest: unknown[] = [];
for (const name of AVATARS) {
  const dir = `data/raw/people/${name}`;
  const files = readdirSync(dir);
  const tex = (part: string) => {
    const f = files.find((f) => f.endsWith(`_${part}_color.tga`));
    return f ? `/${dir}/${f}` : null;
  };
  const g = name.startsWith('Female') ? 'f' : 'm';
  const anims = Object.fromEntries(Object.entries(ANIMS[g]).map(([k, p]) => [k, `/data/raw/people/anims/${p.split('/')[1]}.fbx`]));
  const input = { fbx: `/${dir}/${name}.fbx`, textures: { body: tex('body')!, head: tex('head')!, opacity: tex('opacity') }, anims };
  const t0 = Date.now();
  const result = await page.evaluate((i) => (window as Any).bake(i), input);
  const bin = Buffer.from(result.bin, 'base64');
  const atlas = Buffer.from(result.atlas.split(',')[1], 'base64');
  await writeFile(`${OUT}/${name}.bin`, bin);
  await writeFile(`${OUT}/${name}.webp`, atlas);
  const m = result.meta;
  manifest.push({ name, gender: g, ...m });
  console.log(`${name}: ${m.sourceTriangles}→${m.triangles} tris, ${m.vertices} verts, ${m.bones} bones, ${m.height} m, ` +
    `bin ${(bin.length / 1024).toFixed(0)} KB, atlas ${(atlas.length / 1024).toFixed(0)} KB, uv ${m.uvRange.join('/')}, ` +
    `clips ${JSON.stringify(m.clips)} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
await writeFile(`${OUT}/people.json`, JSON.stringify(manifest));
await browser.close();
