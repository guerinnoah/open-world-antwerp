// pnpm map:fetch-brand-colours: house colours for chains BRANDS lacks, sampled from their Wikidata logo; the logo itself is never kept.
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { RAW_DIR } from './config.ts';
import { houseOf, qid } from './signs.ts';
import { HEADERS, commonsInfo, logoFiles, osmTags, sleep } from './wikimedia.ts';

const OUT = `${RAW_DIR}/brand-colours.json`;
const CHROMA_SHARE = 0.2; // of the inked pixels: a colour this common beats black lettering

/** Most common colour among the inked pixels; a clearly coloured one wins over black or grey. */
function dominantColour(rgba: Uint8Array): number | null {
  const bins = new Map<number, { n: number; r: number; g: number; b: number; chroma: boolean }>();
  let inked = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    if (a < 128 || Math.min(r, g, b) > 225) continue; // background
    inked++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0, chroma: Math.max(r, g, b) - Math.min(r, g, b) > 60 };
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }
  if (!inked) return null;
  const sorted = [...bins.values()].sort((a, b) => b.n - a.n);
  const chroma = sorted.find((b) => b.chroma);
  const pick = chroma && chroma.n / inked >= CHROMA_SHARE ? chroma : sorted[0];
  return (Math.round(pick.r / pick.n) << 16) | (Math.round(pick.g / pick.n) << 8) | Math.round(pick.b / pick.n);
}

const items = [...new Set((await osmTags()).flatMap((t) => {
  const q = qid(t['brand:wikidata']);
  return t.name && q && !houseOf(t) ? [q] : [];
}))];
console.log(`${items.length} chains without a curated colour`);
const logo = await logoFiles(items);
const thumbs = await commonsInfo([...logo.values()].map((l) => l.file), 'url', 200);

const colours: Record<string, { label: string; colour: number }> = {};
for (const [q, { file, label }] of logo) {
  const ii = thumbs.get(file);
  const url: string | undefined = ii?.thumburl ?? ii?.url;
  if (!url) continue;
  await sleep(150);
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) continue;
  const { data } = await sharp(Buffer.from(await res.arrayBuffer())).resize(160, 160, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colour = dominantColour(new Uint8Array(data));
  if (colour !== null) colours[q] = { label, colour };
}
await mkdir(RAW_DIR, { recursive: true });
await writeFile(OUT, JSON.stringify(colours, null, 1));
console.log(`${logo.size} have a logo on Wikidata; ${Object.keys(colours).length} colours → ${OUT}`);
