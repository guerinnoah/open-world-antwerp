import { mkdir, rename, writeFile } from 'node:fs/promises';
import { BBOX, RAW_DIR } from './config.ts';

const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;

const query = `
[out:json][timeout:300];
(
  way["building"](${b});
  relation["building"](${b});
  way["building:part"](${b});
  relation["building:part"](${b});
  way["highway"](${b});
  way["railway"="tram"](${b});
  way["natural"="water"](${b});
  relation["natural"="water"](${b});
  way["waterway"~"riverbank|dock"](${b});
  way["landuse"~"basin|grass|forest|recreation_ground|village_green"](${b});
  way["leisure"~"park|garden|pitch|playground"](${b});
  relation["leisure"="park"](${b});
  relation["route"="tram"](${b});
  relation["route"="bus"]["operator"="De Lijn"](${b});
  nwr["amenity"="hospital"](${b});
  node["natural"="tree"](${b});
  way["natural"="tree_row"](${b});
  way["amenity"="fountain"]["name"~"Brabo"](${b});
  node["name"="Lange Wapper"](${b});
  node["highway"~"^(crossing|traffic_signals|street_lamp)$"](${b});
  node["amenity"="bench"](${b});
  node["barrier"="bollard"](${b});
  nwr["shop"](${b});
  nwr["amenity"~"^(cafe|restaurant|bar|pub|fast_food|bank|pharmacy|ice_cream)$"](${b});
  nwr["tourism"~"^(hotel|hostel|guest_house|museum|gallery)$"](${b});
  nwr["amenity"~"^(cinema|theatre|nightclub|library|post_office|arts_centre|casino|events_venue|bureau_de_change|dentist|doctors|clinic|school|university|college|townhall|courthouse|community_centre|kindergarten|car_rental)$"](${b});
  nwr["leisure"~"^(fitness_centre|sports_centre)$"](${b});
  nwr["office"]["name"](${b});
  nwr["craft"]["name"](${b});
  node["amenity"="bicycle_rental"](${b});
);
out geom;
`;

console.log('Querying Overpass…');
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'open-world-antwerp-map-pipeline/0.1' },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 500)}`);
const text = await res.text();
const { elements, remark } = JSON.parse(text) as { elements: unknown[]; remark?: string };
// Overpass timeouts and OOM aborts return HTTP 200 with partial elements and a remark
if (remark && /error|timed out|out of memory/i.test(remark)) throw new Error(`Overpass: ${remark}`);

await mkdir(RAW_DIR, { recursive: true });
await writeFile(`${RAW_DIR}/osm.json.tmp`, text);
await rename(`${RAW_DIR}/osm.json.tmp`, `${RAW_DIR}/osm.json`);
console.log(`Saved ${elements.length} elements (${(text.length / 1e6).toFixed(1)} MB) to ${RAW_DIR}/osm.json`);
