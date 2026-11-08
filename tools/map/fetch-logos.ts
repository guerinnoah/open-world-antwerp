import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { RAW_DIR } from './config.ts';
import { logoItemsOf } from './signs.ts';

const DIR = `${RAW_DIR}/logos`;
const HEADERS = { 'User-Agent': 'open-world-antwerp-map-pipeline/0.1 (non-commercial hobby game)' };

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

const api = async (base: string, params: Record<string, string>) => {
  const res = await fetch(`${base}?${new URLSearchParams({ format: 'json', ...params })}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${base} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<Record<string, any>>;
};
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const plain = (html = '') => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { elements } = JSON.parse(await readFile(`${RAW_DIR}/osm.json`, 'utf8')) as { elements: { tags?: Record<string, string> }[] };
const items = [...new Set(elements.flatMap((e) => (e.tags ? logoItemsOf(e.tags) : [])))];
console.log(`${items.length} Wikidata items to check for a logo`);

const logoFile = new Map<string, string>();
const labels = new Map<string, string>();
for (const ids of chunks(items, 50)) {
  const { entities } = await api('https://www.wikidata.org/w/api.php', {
    action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels', languages: 'nl|en',
  });
  for (const [q, e] of Object.entries<any>(entities ?? {})) {
    const claims = ((e.claims?.P154 ?? []) as any[])
      .filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582 && c.mainsnak?.datavalue?.value)
      .sort((a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'));
    if (!claims.length) continue;
    logoFile.set(q, claims[0].mainsnak.datavalue.value);
    labels.set(q, e.labels?.nl?.value ?? e.labels?.en?.value ?? q);
  }
}
console.log(`${logoFile.size} have a logo on Wikidata`);

// public domain only: CC-BY/-SA logos are still copyrighted
const PD_LICENCE = /^(pd|cc0)/i;
const PD_NAME = /^(public domain|cc0)/i;
const info = new Map<string, any>();
for (const files of chunks([...new Set(logoFile.values())], 50)) {
  const res = await api('https://commons.wikimedia.org/w/api.php', {
    action: 'query', titles: files.map((f) => `File:${f}`).join('|'), prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: '500',
  });
  const renamed = new Map<string, string>([...(res.query?.normalized ?? [])].map((n: any) => [n.to, n.from]));
  for (const page of Object.values<any>(res.query?.pages ?? {})) {
    if (page.imageinfo?.[0]) info.set((renamed.get(page.title) ?? page.title).replace(/^File:/, ''), page.imageinfo[0]);
  }
}

await mkdir(DIR, { recursive: true });
const manifest: Record<string, LogoEntry> = {};
const skipped: string[] = [];
for (const [q, file] of logoFile) {
  const ii = info.get(file);
  const meta = ii?.extmetadata ?? {};
  const licence = plain(meta.LicenseShortName?.value);
  if (!ii || !(PD_LICENCE.test(meta.License?.value ?? '') || PD_NAME.test(licence))) {
    skipped.push(`${labels.get(q)} (${file}): ${licence || 'no licence found'}`);
    continue;
  }
  let url: string = ii.thumburl ?? ii.url;
  if (ii.thumburl && ii.width / ii.height > 3.9) url = url.replace(/\/500px-/, '/960px-');
  const image = `${q}.${/\.(png|jpe?g|gif|webp)$/i.exec(url)?.[1].toLowerCase() ?? 'png'}`;
  if (!existsSync(`${DIR}/${image}`)) {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      skipped.push(`${labels.get(q)} (${file}): download ${res.status}`);
      continue;
    }
    await writeFile(`${DIR}/${image}`, Buffer.from(await res.arrayBuffer()));
    await sleep(250);
  }
  manifest[q] = {
    label: labels.get(q)!, file, page: ii.descriptionurl, licence, licenceUrl: meta.LicenseUrl?.value,
    artist: plain(meta.Artist?.value) || 'unknown', trademarked: /trademark/i.test(meta.Restrictions?.value ?? ''), image,
  };
}
await writeFile(`${DIR}/logos.json`, JSON.stringify(manifest, null, 1));
console.log(`Saved ${Object.keys(manifest).length} logos to ${DIR}/`);
for (const [q, m] of Object.entries(manifest)) console.log(`  ${q} ${m.label}: ${m.licence}`);
if (skipped.length) console.log(`Skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
