import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import sharp, { type OverlayOptions } from 'sharp';
import { OPERATORS, type LogoRect, type Operator } from '../../src/world/cityData.ts';
import { OUT_DIR, RAW_DIR } from './config.ts';
import type { LogoEntry } from './fetch-logos.ts';
import { houseOf, logoItemsOf } from './signs.ts';

/** Takedowns: Wikidata Q-ids never shown; rerun pnpm map:build. */
const BLOCKED = new Set<string>([]);

const H = 48; // px: signs draw a logo LOGO_SHARE of their 64 px cell, so no bigger
const ATLAS_W = 1024;
const MAX_W = 384;
const EMBLEM = 2.5; // w / h below this: an emblem, name written beside it

interface Prepared {
  entry: LogoEntry;
  pixels: Buffer;
  w: number;
  h: number;
  plate?: number; // the logo's own opaque background
  neutral: number; // a panel it reads on
  bg?: number; // chosen at first use
  index?: number;
}

interface Logos {
  of(tags: Record<string, string>): { index: number; aspect: number; named: boolean } | undefined;
  operator(key: Operator): number | undefined;
  write(): Promise<LogoRect[]>;
}

const rgbOf = (hex: number) => ({ r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 });
const lin = (c: number) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const luminance = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** Whether nearly all of a transparent logo stands out on `bg`, at WCAG contrast 3 or more. */
function readsOn(pixels: Buffer, bg: number): boolean {
  const { r, g, b } = rgbOf(bg);
  const lb = luminance(r, g, b);
  let ink = 0, clear = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 200) continue;
    ink++;
    const l = luminance(pixels[i], pixels[i + 1], pixels[i + 2]);
    if ((Math.max(l, lb) + 0.05) / (Math.min(l, lb) + 0.05) >= 3) clear++;
  }
  return ink > 0 && clear / ink >= 0.9;
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);

export async function loadLogos(): Promise<Logos> {
  const dir = `${RAW_DIR}/logos`;
  const manifest: Record<string, LogoEntry> = existsSync(`${dir}/logos.json`) ? JSON.parse(await readFile(`${dir}/logos.json`, 'utf8')) : {};
  const logos = new Map<string, Prepared>();
  for (const [q, entry] of Object.entries(manifest)) {
    if (BLOCKED.has(q) || !existsSync(`${dir}/${entry.image}`)) continue;
    const file = `${dir}/${entry.image}`;
    // top-left pixel is the background: the sign takes it on, or a panel if transparent
    const corner = await sharp(file).ensureAlpha().extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer();
    const { data, info } = await sharp(file).ensureAlpha().trim({ threshold: 24 })
      .resize({ height: H, width: MAX_W, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
    let lum = 0, weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      lum += a * (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      weight += a;
    }
    logos.set(q, {
      entry, pixels: data, w: info.width, h: info.height, neutral: lum / (weight || 1) > 0.75 ? 0x161616 : 0xf5f4f0,
      plate: corner[3] > 250 ? (corner[0] << 16) | (corner[1] << 8) | corner[2] : undefined,
    });
  }
  const used: Prepared[] = [];

  return {
    of(tags) {
      const logo = logoItemsOf(tags).map((q) => logos.get(q)).find(Boolean);
      if (!logo) return undefined;
      // A chain's transparent logo goes on its house colour where it still reads there.
      const house = houseOf(tags)?.colour;
      logo.bg ??= logo.plate ?? (house !== undefined && readsOn(logo.pixels, house) ? house : logo.neutral);
      logo.index ??= used.push(logo) - 1;
      return { index: logo.index, aspect: logo.w / logo.h, named: logo.w / logo.h < EMBLEM };
    },

    operator(key) {
      const { q, bg, ink } = OPERATORS[key];
      const logo = logos.get(q);
      if (!logo) return undefined;
      const pixels = Buffer.from(logo.pixels);
      if (ink !== undefined) {
        const { r, g, b } = rgbOf(ink);
        for (let i = 0; i < pixels.length; i += 4) pixels.set([r, g, b], i);
      }
      return used.push({ ...logo, pixels, bg }) - 1;
    },

    async write() {
      const rects: LogoRect[] = [];
      const tiles: OverlayOptions[] = [];
      let x = 0, y = 0;
      for (const { pixels, w, h, bg = 0 } of used) {
        if (x + w > ATLAS_W) {
          x = 0;
          y += H;
        }
        // On its sign's own background already: signs draw it there anyway, and the atlas needs no alpha.
        const flat = await sharp(pixels, { raw: { width: w, height: h, channels: 4 } }).flatten({ background: rgbOf(bg) }).raw().toBuffer();
        tiles.push({ input: flat, raw: { width: w, height: h, channels: 3 }, left: x, top: y });
        rects.push([x, y, w, h, bg, w / h < EMBLEM ? 1 : 0]);
        x += w + 2;
      }
      if (tiles.length) {
        await sharp({ create: { width: ATLAS_W, height: y + H, channels: 3, background: { r: 0, g: 0, b: 0 } } })
          .composite(tiles).webp({ quality: 88, smartSubsample: true, effort: 6 }).toFile(`${OUT_DIR}/logos.webp`);
      }
      // credited once, though an operator's logo can have a second cell
      const credits = [...new Map(used.map(({ entry }) => [entry.page, entry])).values()].map((c) =>
        `<li>${escape(c.label)}: <a href="${escape(c.page)}">${escape(c.file)}</a> by ${escape(c.artist)}, ${c.licenceUrl ? `<a href="${escape(c.licenceUrl)}">${escape(c.licence)}</a>` : escape(c.licence)}</li>`);
      await writeFile(`${OUT_DIR}/logos.html`, `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Open World Antwerp: names and logos</title>
<style>body { font: 15px/1.5 system-ui, sans-serif; max-width: 42em; margin: 2em auto; padding: 0 1em; color: #222; }</style>
<h1>Names and logos</h1>
<p>Open World Antwerp is a free, non-commercial hobby game. It is not affiliated with, sponsored or endorsed by any business
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
