import { writeFile } from 'node:fs/promises';
import type { District } from '../../src/world/districts.ts';
import { BBOX, OUT_DIR } from './config.ts';
import { flat, polygonsOf, project, signedArea, type OsmElement } from './geo.ts';
import { simplify } from './massing.ts';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const TOLERANCE = 4; // m

const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const query = `[out:json][timeout:120];(way["place"~"^(quarter|suburb)$"](${b});relation["place"~"^(quarter|suburb)$"](${b}););out geom;`;

console.log('Querying Overpass for quarters…');
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gta-antwerp-map-pipeline/0.1' },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 500)}`);
const { elements } = (await res.json()) as { elements: OsmElement[] };

const [minX, maxZ] = project(BBOX.south, BBOX.west);
const [maxX, minZ] = project(BBOX.north, BBOX.east);
const found: (District & { area: number })[] = [];
for (const e of elements) {
  // "Zurenborg (Berchem)" → "Zurenborg"
  const name = e.tags?.name?.replace(/\s*\(.*\)$/, '');
  if (!name) continue;
  for (const [outer] of polygonsOf(e)) {
    if (!outer.some(([x, z]) => x >= minX && x <= maxX && z >= minZ && z <= maxZ)) continue;
    const ring = simplify(outer, TOLERANCE);
    found.push({ n: name, p: flat(ring), area: signedArea(ring) });
  }
}
// Smallest first, so a quarter wins over the suburb around it (Districts.at).
found.sort((a, c) => a.area - c.area);
const districts: District[] = found.map(({ n, p }) => ({ n, p }));
const json = JSON.stringify(districts);
await writeFile(`${OUT_DIR}/districts.json`, json);
console.log(`${districts.length} rings (${[...new Set(districts.map((d) => d.n))].join(', ')}) → ${OUT_DIR}/districts.json ${(json.length / 1024).toFixed(0)} KB`);
