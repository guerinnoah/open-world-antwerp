// Wikidata and Commons lookups for map:fetch-logos and map:fetch-brand-colours.
import { readFile } from 'node:fs/promises';
import { RAW_DIR } from './config.ts';

export const HEADERS = { 'User-Agent': 'open-world-antwerp-map-pipeline/0.1 (non-commercial hobby game)' };

const api = async (base: string, params: Record<string, string>) => {
  const res = await fetch(`${base}?${new URLSearchParams({ format: 'json', ...params })}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`${base} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<Record<string, any>>;
};
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function osmTags(): Promise<Record<string, string>[]> {
  const { elements } = JSON.parse(await readFile(`${RAW_DIR}/osm.json`, 'utf8')) as { elements: { tags?: Record<string, string> }[] };
  return elements.flatMap((e) => (e.tags ? [e.tags] : []));
}

/** Each item's current logo file (Wikidata P154, preferred rank first) and its label. */
export async function logoFiles(items: string[]): Promise<Map<string, { file: string; label: string }>> {
  const out = new Map<string, { file: string; label: string }>();
  for (const ids of chunks(items, 50)) {
    const { entities } = await api('https://www.wikidata.org/w/api.php', {
      action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels', languages: 'nl|en',
    });
    for (const [q, e] of Object.entries<any>(entities ?? {})) {
      const [claim] = ((e.claims?.P154 ?? []) as any[])
        .filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.P582 && c.mainsnak?.datavalue?.value)
        .sort((a, b) => Number(b.rank === 'preferred') - Number(a.rank === 'preferred'));
      if (claim) out.set(q, { file: claim.mainsnak.datavalue.value, label: e.labels?.nl?.value ?? e.labels?.en?.value ?? q });
    }
  }
  return out;
}

/** Commons imageinfo by file name, with a thumbnail `width` px wide. */
export async function commonsInfo(files: string[], iiprop: string, width: number): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  for (const batch of chunks([...new Set(files)], 50)) {
    const res = await api('https://commons.wikimedia.org/w/api.php', {
      action: 'query', titles: batch.map((f) => `File:${f}`).join('|'), prop: 'imageinfo', iiprop, iiurlwidth: String(width),
    });
    const renamed = new Map<string, string>([...(res.query?.normalized ?? [])].map((n: any) => [n.to, n.from]));
    for (const page of Object.values<any>(res.query?.pages ?? {})) {
      if (page.imageinfo?.[0]) out.set((renamed.get(page.title) ?? page.title).replace(/^File:/, ''), page.imageinfo[0]);
    }
  }
  return out;
}
