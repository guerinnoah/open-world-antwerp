import { mkdir, writeFile } from 'node:fs/promises';
import { BBOX, RAW_DIR } from './config.ts';
import { latLonToLambert72 } from './lambert72.ts';

// Antwerp's public tree inventory (Groeninventaris "boom", layer 5): every city-managed tree, as EPSG:31370 points.
// Fields LATBOOMSOORT (species) / GENUS / STAMOMTREK (trunk girth) exist, but we only need positions for city.trees.
const LAYER = 'https://geodata.antwerpen.be/arcgissql/rest/services/P_Groeninventaris/Groeninventaris_extern/MapServer/5/query';
const PAGE = 1000; // the service's maxRecordCount

// Our slice as a Lambert 72 envelope (x = easting, y = northing); take the min/max of all four projected corners.
const corners = [
  latLonToLambert72(BBOX.south, BBOX.west),
  latLonToLambert72(BBOX.south, BBOX.east),
  latLonToLambert72(BBOX.north, BBOX.west),
  latLonToLambert72(BBOX.north, BBOX.east),
];
const xs = corners.map((c) => c[0]), ys = corners.map((c) => c[1]);
const geometry = JSON.stringify({ xmin: Math.min(...xs), ymin: Math.min(...ys), xmax: Math.max(...xs), ymax: Math.max(...ys), spatialReference: { wkid: 31370 } });

async function page(offset: number): Promise<GeoJSON.Feature[]> {
  const params = new URLSearchParams({
    where: '1=1', geometry, geometryType: 'esriGeometryEnvelope', inSR: '31370', spatialRel: 'esriSpatialRelIntersects',
    outFields: 'LATBOOMSOORT,STAMOMTREK', returnGeometry: 'true', outSR: '4326', orderByFields: 'OBJECTID',
    resultOffset: String(offset), resultRecordCount: String(PAGE), f: 'geojson',
  });
  const res = await fetch(`${LAYER}?${params}`);
  if (!res.ok) throw new Error(`trees @${offset} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { features?: GeoJSON.Feature[]; error?: unknown };
  if (json.error) throw new Error(`trees @${offset}: ${JSON.stringify(json.error).slice(0, 200)}`);
  return json.features ?? [];
}

// [lat, lon, Latin species, trunk girth in cm] — build.ts maps the species to a crown type and the girth to a size.
const trees: [number, number, string | null, number][] = [];
const genus = new Map<string, number>();
for (let offset = 0; ; offset += PAGE) {
  const features = await page(offset);
  for (const f of features) {
    const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const latin = (f.properties?.LATBOOMSOORT as string) ?? null;
    trees.push([lat, lon, latin, Number(f.properties?.STAMOMTREK) || 0]);
    const g = latin?.split(/\s+/)[0] ?? '(unknown)';
    genus.set(g, (genus.get(g) ?? 0) + 1);
  }
  process.stdout.write('.');
  if (features.length < PAGE) break;
}
process.stdout.write('\n');

await mkdir(RAW_DIR, { recursive: true });
await writeFile(`${RAW_DIR}/trees.json`, JSON.stringify(trees));
const top = [...genus.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`Saved ${trees.length} trees to ${RAW_DIR}/trees.json. Top genera: ${top}`);
