import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { RAW_DIR } from './config.ts';
import { logoItemsOf } from './signs.ts';
import { HEADERS, commonsInfo, logoFiles, osmTags, sleep } from './wikimedia.ts';

const DIR = `${RAW_DIR}/logos`;

export interface LogoEntry {
  label: string;
  file: string;
  page: string;
  licence: string;
  licenceUrl?: string;
  artist: string;
  trademarked: boolean;
  image: string;
}

const plain = (html = '') => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const items = [...new Set((await osmTags()).flatMap((t) => logoItemsOf(t)))];
console.log(`${items.length} Wikidata items to check for a logo`);
const logos = await logoFiles(items);
console.log(`${logos.size} have a logo on Wikidata`);

// public domain only: CC-BY/-SA logos are still copyrighted
const PD_LICENCE = /^(pd|cc0)/i;
const PD_NAME = /^(public domain|cc0)/i;
const info = await commonsInfo([...logos.values()].map((l) => l.file), 'url|size|mime|extmetadata', 500);

await mkdir(DIR, { recursive: true });
const manifest: Record<string, LogoEntry> = {};
const skipped: string[] = [];
for (const [q, { file, label }] of logos) {
  const ii = info.get(file);
  const meta = ii?.extmetadata ?? {};
  const licence = plain(meta.LicenseShortName?.value);
  if (!ii || !(PD_LICENCE.test(meta.License?.value ?? '') || PD_NAME.test(licence))) {
    skipped.push(`${label} (${file}): ${licence || 'no licence found'}`);
    continue;
  }
  let url: string = ii.thumburl ?? ii.url;
  if (ii.thumburl && ii.width / ii.height > 3.9) url = url.replace(/\/500px-/, '/960px-');
  const image = `${q}.${/\.(png|jpe?g|gif|webp)$/i.exec(url)?.[1].toLowerCase() ?? 'png'}`;
  if (!existsSync(`${DIR}/${image}`)) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      skipped.push(`${label} (${file}): download ${res.status}`);
      continue;
    }
    await writeFile(`${DIR}/${image}`, Buffer.from(await res.arrayBuffer()));
    await sleep(250);
  }
  manifest[q] = {
    label: label, file, page: ii.descriptionurl, licence, licenceUrl: meta.LicenseUrl?.value,
    artist: plain(meta.Artist?.value) || 'unknown', trademarked: /trademark/i.test(meta.Restrictions?.value ?? ''), image,
  };
}
await writeFile(`${DIR}/logos.json`, JSON.stringify(manifest, null, 1));
console.log(`Saved ${Object.keys(manifest).length} logos to ${DIR}/`);
for (const [q, m] of Object.entries(manifest)) console.log(`  ${q} ${m.label}: ${m.licence}`);
if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
