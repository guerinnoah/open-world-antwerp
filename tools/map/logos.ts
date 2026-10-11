import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import sharp, { type OverlayOptions } from 'sharp';
import type { LogoRect } from '../../src/world/cityData.ts';
import { OUT_DIR, RAW_DIR } from './config.ts';
import type { LogoEntry } from './fetch-logos.ts';
import { logoItemsOf } from './signs.ts';

/** Logos never shown, by Wikidata item. To take one down (say its owner asks): add its Q-id here and rerun pnpm map:build. */
const BLOCKED = new Set<string>([]);

const H = 64; // px per logo in the atlas: the sign texture is 64 px tall
const ATLAS_W = 1024;
const MAX_W = 512;
const EMBLEM = 2.5; // narrower than this (w / h), a logo is an emblem and the sign writes the name beside it

interface Prepared {
  entry: LogoEntry;
  pixels: Buffer;
  w: number;
  h: number;
  bg: number;
  index?: number;
}

interface Logos {
  of(tags: Record<string, string>): { index: number; aspect: number; named: boolean } | undefined;
  write(): Promise<LogoRect[]>;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

/** Packs the free-licence logos signs use into logos.webp; credits and the no-affiliation notice go to logos.html. */
export async function loadLogos(): Promise<Logos> {
  const dir = `${RAW_DIR}/logos`;
  const manifest: Record<string, LogoEntry> = existsSync(`${dir}/logos.json`) ? JSON.parse(await readFile(`${dir}/logos.json`, 'utf8')) : {};
  const logos = new Map<string, Prepared>();
  for (const [q, entry] of Object.entries(manifest)) {
    if (BLOCKED.has(q) || !existsSync(`${dir}/${entry.image}`)) continue;
    const file = `${dir}/${entry.image}`;
    // The top-left pixel is the background: a solid colour the sign takes on, or transparent (a light or dark panel).
    const corner = await sharp(file).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    const { data, info } = await sharp(file).ensureAlpha().trim({ threshold: 24 })
      .resize({ height: H, width: MAX_W, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    let bg: number;
    if (corner[3] > 250) bg = (corner[0] << 16) | (corner[1] << 8) | corner[2];
    else {
      let lum = 0, weight = 0;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255;
        lum += a * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        weight += a;
      }
      bg = lum / (weight || 1) > 0.75 ? 0x161616 : 0xf5f4f0;
    }
    logos.set(q, { entry, pixels: data, w: info.width, h: info.height, bg });
  }
  const used: Prepared[] = [];

  return {
    of(tags) {
      const logo = logoItemsOf(tags).map((q) => logos.get(q)).find(Boolean);
      if (!logo) return undefined;
      logo.index ??= used.push(logo) - 1;
      return { index: logo.index, aspect: logo.w / logo.h, named: logo.w / logo.h < EMBLEM };
    },

    async write() {
      const rects: LogoRect[] = [];
      const tiles: OverlayOptions[] = [];
      let x = 0, y = 0;
      for (const { pixels, w, h, bg } of used) {
        if (x + w > ATLAS_W) {
          x = 0;
          y += H;
        }
        tiles.push({ input: pixels, raw: { width: w, height: h, channels: 4 }, left: x, top: y });
        rects.push([x, y, w, h, bg, w / h < EMBLEM ? 1 : 0]);
        x += w + 2;
      }
      if (tiles.length) {
        await sharp({ create: { width: ATLAS_W, height: y + H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite(tiles).webp({ lossless: true }).toFile(`${OUT_DIR}/logos.webp`);
      }
      const credits = used.map(({ entry: c }) =>
        `<li>${escape(c.label)}: <a href="${escape(c.page)}">${escape(c.file)}</a> by ${escape(c.artist)}, ${c.licenceUrl ? `<a href="${escape(c.licenceUrl)}">${escape(c.licence)}</a>` : escape(c.licence)}</li>`);
      await writeFile(`${OUT_DIR}/logos.html`, `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GTA Antwerp: names and logos</title>
<style>body { font: 15px/1.5 system-ui, sans-serif; max-width: 42em; margin: 2em auto; padding: 0 1em; color: #222; }</style>
<h1>Names and logos on signs</h1>
<p>GTA Antwerp is a free, non-commercial hobby game. It is not affiliated with, sponsored or endorsed by any business
or organisation whose name or logo appears in it. Names and logos are shown only to depict the city as it really is,
and remain the trademarks of their owners.</p>
<p>Shop and venue names come from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>.${credits.length ? ` The logos
below come from <a href="https://commons.wikimedia.org/">Wikimedia Commons</a>, under the licence shown:</p>
<ul>
${credits.join('\n')}
</ul>` : '</p>'}
</html>
`);
      return rects;
    },
  };
}
