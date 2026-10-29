import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { MultiPolygon, Polygon } from 'polygon-clipping';
import type { Area, AreaKind, Building, CityData, GraphData, Road, RoadKind } from '../../src/world/cityData.ts';
import { BBOX, ORIGIN, OUT_DIR, RAW_DIR } from './config.ts';
import { buildGraphData, underground } from './graph.ts';
import { loadGrbHeights } from './grb.ts';
import { markFacades } from './facades.ts';
import { facadeOf } from './palette.ts';
import { OLD_TOWN_RADIUS } from '../../src/world/roofs.ts';
import { markShopKinds, offRoad, placeSigns, placeStreetPlates, veloStations } from './signs.ts';
import { renderMinimap } from './minimap.ts';
import { loadLogos } from './logos.ts';
import { extractLandmarks } from './landmarks.ts';
import { posts, solid, splitOutlines, type Mass } from './massing.ts';
import { streetDetail } from './street.ts';
import { WaterMap } from '../../src/world/water.ts';
import { treeKind } from '../../src/world/treeKinds.ts';
import { layWater } from './water.ts';
import {
  besideRoad, centroid, flat, interiorPoint, outlineGrid, pointInRing, polygonsOf, project, round, roadGrid, signedArea, toPts,
  type OsmElement, type Pt,
} from './geo.ts';

const { elements } = JSON.parse(await readFile(`${RAW_DIR}/osm.json`, 'utf8')) as { elements: OsmElement[] };

const [minX, maxZ] = project(BBOX.south, BBOX.west);
const [maxX, minZ] = project(BBOX.north, BBOX.east);
const inBounds = ([x, z]: Pt) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;

function parseMeters(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

type HeightSource = 'tag' | 'levels' | 'default';

function heightOf(t: Record<string, string>, id: number): { h: number; mh: number; source: HeightSource } {
  const levels = parseMeters(t['building:levels']);
  const roofLevels = parseMeters(t['roof:levels']) ?? 0;
  const minLevel = parseMeters(t['building:min_level']);
  const mh = parseMeters(t.min_height) ?? (minLevel !== undefined ? minLevel * 3.2 : 0);
  const tagged = parseMeters(t.height);
  if (tagged !== undefined && tagged > mh) return { h: tagged, mh, source: 'tag' };
  if (levels !== undefined) return { h: (levels + roofLevels) * 3.2 + 1.5, mh, source: 'levels' };
  const kind = t.building ?? t['building:part'];
  const base = kind === 'garage' || kind === 'shed' || kind === 'roof' ? 4 : kind === 'church' ? 22 : 10;
  return { h: base + hash(id) * 6, mh, source: 'default' };
}

/** Stable pseudo-random in [0, 1) per OSM id: rebuilds give the same city. */
function hash(id: number): number {
  let x = id ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const PLAIN_WALLS = new Set(['church', 'cathedral', 'chapel', 'basilica', 'tower', 'monument']);
const PLAIN_PARTS = new Set(['tower', 'steeple', 'spire', 'church', 'chapel', 'roof', 'dome', 'column', 'chimney']);

/** Guessed heights for small things: a bus shelter or a kiosk is not a town house. */
function smallHeight(t: Record<string, string>, area: number, h: number): number {
  if (t.amenity === 'shelter') return 2.8;
  return area < 12 ? Math.min(h, 3) : area < 30 ? Math.min(h, 4.5) : h;
}

interface Candidate extends Mass {
  /** Height before any GRB measurement: OSM's own, or a guess. */
  osmH: number;
  source: HeightSource | 'grb';
}
const candidates: Candidate[] = [];
const heightSources = { tag: 0, levels: 0, grb: 0, default: 0 };
const grbMatch = await loadGrbHeights();
let slivers = 0;

for (const e of elements) {
  const t = e.tags;
  if (!t || !(t.building || t['building:part'])) continue;
  if (e.type === 'relation' && t.type !== 'multipolygon') continue;
  if (t.building === 'no' || t['building:part'] === 'no' || t.location === 'underground') continue;
  const isPart = !!t['building:part'];
  const { h, mh, source } = heightOf(t, e.id);
  for (const rings of polygonsOf(e)) {
    const centre = centroid(rings[0]);
    if (!inBounds(centre)) continue;
    if (!solid(rings)) {
      slivers++;
      continue;
    }
    // Height: explicit OSM height > measured 3D GRB (not for parts or raised sections) > OSM levels > default.
    const grb = source !== 'tag' && !isPart && mh === 0 ? grbMatch?.(rings[0]) : undefined;
    heightSources[grb ? 'grb' : source]++;
    let top = grb?.height ?? h;
    let base = mh;
    // A canopy (OSM roof, GRB afdak) is a slab on posts; a GRB upper floor with open ground below spans a passage.
    const canopy = t.building === 'roof' || (t['building:part'] === 'roof' && mh === 0) || grb?.type === 'afdak';
    const area = Math.abs(signedArea(rings[0]));
    if (canopy) {
      // LiDAR over an awning against a tall facade reads the facade: only a big canopy is measured, not a high one.
      if (source === 'default' && (!grb || (grb.height > 8 && area < 1000))) top = area < 30 ? 3.5 : 4.5 + hash(e.id) * 2.5;
      top = Math.max(top, 2.8);
      if (base === 0) base = top - 0.4;
    } else if (grb?.type === 'verdieping' && grb.ground < 0.35) {
      base = Math.min(4, top * 0.4);
    } else if (source === 'default' && !grb) {
      top = smallHeight(t, area, top);
    }
    const look = facadeOf(t, top, area, Math.hypot(...centre) < OLD_TOWN_RADIUS, (salt) => hash(e.id * 31 + salt));
    const b: Building = { h: round(top), ...look, rings: rings.map(flat) };
    if (base > 0) b.mh = round(base);
    // nw: no windows (churches, towers, raised parts); nc: no collider, so raised sections and canopies don't block the street.
    if (PLAIN_WALLS.has(t.building) || PLAIN_PARTS.has(t['building:part']) || base > 0) b.nw = 1;
    if (base > 0) b.nc = 1;
    candidates.push({ b, outer: rings[0], rings, isPart, canopy, osmH: h, source: grb ? 'grb' : source });
  }
}

const parts = candidates.filter((c) => c.isPart);
const ownHeight = (c: Candidate) => c.source === 'tag' || c.source === 'levels';
/**
 * Height for what of an outline its parts leave uncovered. GRB's 99th percentile over a footprint with a tower on it is
 * the tower, so when it matches the tallest part the rest gets OSM's guess, kept a few metres below that.
 */
function remainderHeight(o: Candidate, on: Mass[]): number {
  const tallest = Math.max(0, ...(on as Candidate[]).filter(ownHeight).map((p) => p.b.h));
  if (o.source !== 'grb' || !tallest || o.b.h < tallest - 1.5) return o.b.h;
  return round(Math.max(3, Math.min(o.osmH, tallest - 3)));
}
// Parts with no height of their own take their outline's.
for (const p of parts) {
  if (ownHeight(p)) continue;
  const c = interiorPoint(p.outer);
  const host = candidates.find((o) => !o.isPart && o.source !== 'default' && pointInRing(c, o.outer));
  if (!host) continue;
  const h = remainderHeight(host, parts.filter((q) => pointInRing(interiorPoint(q.outer), host.outer)));
  if (h > (p.b.mh ?? 0) + 2) p.b.h = h;
}
const landmarks = extractLandmarks(elements, candidates); // before splitting, so the pieces of a landmark stay hidden too
const split = splitOutlines(candidates.filter((c) => !c.isPart), parts, (o, on) => remainderHeight(o as Candidate, on));
const masses: Mass[] = [...candidates.filter((c) => !split.replaced.has(c)), ...split.masses];
const buildings = masses.map((m) => m.b);
const standing = masses.filter((m) => !m.b.mh && !m.b.nc);
const outlines = masses.filter((m) => !m.isPart);
const occupied = outlineGrid(candidates.filter((c) => !c.isPart));
const inBuilding = (p: Pt) => occupied(p).some((o) => pointInRing(p, o.outer));
const near = outlineGrid(masses.filter((m) => !m.b.mh));

const ROAD_TYPES: Record<string, [RoadKind, number]> = {
  motorway: ['major', 14], trunk: ['major', 13], primary: ['major', 12], secondary: ['major', 11],
  tertiary: ['minor', 9], primary_link: ['minor', 8], secondary_link: ['minor', 8], tertiary_link: ['minor', 7],
  residential: ['minor', 7], unclassified: ['minor', 7], living_street: ['minor', 6], busway: ['minor', 6],
  service: ['service', 4], pedestrian: ['pedestrian', 6], footway: ['foot', 2.5], path: ['foot', 2],
  steps: ['foot', 2.5], track: ['service', 3.5], cycleway: ['cycle', 2],
};

function roadWidth(t: Record<string, string>): number | undefined {
  const type = ROAD_TYPES[t.highway];
  if (!type) return undefined;
  const lanes = parseMeters(t.lanes);
  return type[0] === 'major' || type[0] === 'minor' ? Math.max(type[1], (lanes ?? 0) * 3.2) : type[1];
}

const roads: Road[] = [];
const trams: number[][] = [];
let areas: Area[] = [];
const water: MultiPolygon = [];
const bboxPoly: Polygon = [[[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ], [minX, minZ]]];

function areaKind(t: Record<string, string>): AreaKind | undefined {
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.waterway === 'dock' || t.landuse === 'basin') return 'water';
  if (t.leisure || ['grass', 'forest', 'recreation_ground', 'village_green'].includes(t.landuse)) return 'green';
  if (t.highway === 'pedestrian' && t.area === 'yes') return 'plaza';
  return undefined;
}

for (const e of elements) {
  const t = e.tags;
  if (!t) continue;
  const ak = areaKind(t);
  if (ak) {
    for (const rings of polygonsOf(e)) {
      if (ak === 'water') water.push(rings.map((r) => [...r, r[0]]));
      else if (inBounds(centroid(rings[0]))) areas.push({ k: ak, rings: rings.map(flat) });
    }
    continue;
  }
  if (e.type !== 'way' || !e.geometry || underground(t)) continue;
  const pts = toPts(e.geometry);
  if (!pts.some(inBounds)) continue;
  if (t.railway === 'tram') {
    trams.push(flat(pts));
    continue;
  }
  const kind = ROAD_TYPES[t.highway]?.[0];
  const w = roadWidth(t);
  if (!kind || !w) continue;
  roads.push({ k: kind, w, p: flat(pts) });
}

areas = layWater(water, bboxPoly, roads, areas);

const waterMap = new WaterMap({ areas } as CityData);
const open = (p: Pt) => !waterMap.contains(...p) && !inBuilding(p);

const roadsNear = roadGrid(roads, 40);
const ringPts = (flatRing: number[]): Pt[] => flatRing.flatMap((_, i) => (i % 2 ? [] : [[flatRing[i], flatRing[i + 1]] as Pt]));
const plazas = areas.filter((a) => a.k === 'plaza').map((a) => ringPts(a.rings[0]));
const onStreet = (p: Pt) => besideRoad(p, roadsNear(p), 8) || plazas.some((ring) => pointInRing(p, ring));
markFacades(outlines, elements, near, (p) => waterMap.contains(...p), onStreet);

const clearOfRoads = offRoad(roads);
const raised = masses.filter((m) => (m.b.mh ?? 0) > 0);
const postsUnder = posts(raised, standing, (p) => inBounds(p) && clearOfRoads(p) && !waterMap.contains(...p));
buildings.push(...postsUnder);
const buildingIndex = new Map(buildings.map((b, i) => [b, i]));
const logos = await loadLogos();
const shopfronts = placeSigns(elements, buildingIndex, near, (p) => clearOfRoads(p) && open(p), logos.of);
markShopKinds(shopfronts.signs, buildings);

// trees: flat [x, z, kind, girth] (kind = treeKind index, girth = trunk circumference in cm; 0 when unknown).
const trees: number[] = [];
const plantTree = (p: Pt, kind = 0, girth = 0) => {
  if (inBounds(p) && open(p)) trees.push(round(p[0]), round(p[1]), kind, round(girth));
};
// Prefer Antwerp's real tree inventory (pnpm map:fetch-trees); fall back to OSM tree nodes and tree_row ways.
const treeFile = `${RAW_DIR}/trees.json`;
if (existsSync(treeFile)) {
  const inventory = JSON.parse(await readFile(treeFile, 'utf8')) as [number, number, string | null, number][];
  for (const [lat, lon, latin, girth] of inventory) plantTree(project(lat, lon), treeKind(latin), girth);
  console.log(`trees: ${trees.length / 4} planted from the Antwerp inventory (${inventory.length} in the slice)`);
} else {
  console.warn('No tree inventory (run pnpm map:fetch-trees); falling back to OSM trees.');
  for (const e of elements) {
    if (e.type === 'node' && e.tags?.natural === 'tree') plantTree(project(e.lat!, e.lon!));
    if (e.type !== 'way' || e.tags?.natural !== 'tree_row' || !e.geometry) continue;
    const pts = toPts(e.geometry);
    for (let i = 0, carry = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      for (let d = carry; d < len; d += 9) plantTree([x0 + ((x1 - x0) * d) / len, z0 + ((z1 - z0) * d) / len]);
      carry = (carry - len) % 9;
      if (carry < 0) carry += 9;
    }
  }
}

const graph = buildGraphData({ elements, buildings, inBounds, roadWidth });
// Real De Lijn trips-per-hour (pnpm map:fetch-gtfs), keyed by line; the sim runs trams/buses to this schedule.
const gtfsFile = `${RAW_DIR}/gtfs-schedules.json`;
if (existsSync(gtfsFile)) {
  graph.schedules = JSON.parse(await readFile(gtfsFile, 'utf8')) as GraphData['schedules'];
  console.log(`schedules: ${Object.keys(graph.schedules!).length} lines from the De Lijn GTFS`);
} else {
  console.warn('No De Lijn schedules (run pnpm map:fetch-gtfs); trams/buses use a default service.');
}
const streetPlates = placeStreetPlates([graph.drive, graph.walk], buildingIndex, near);
const velo = veloStations(elements, roads, (p) => inBounds(p) && clearOfRoads(p) && open(p));

await mkdir(OUT_DIR, { recursive: true });
const logoRects = await logos.write();
const city: CityData = {
  version: 1,
  origin: ORIGIN,
  bounds: { minX: round(minX), minZ: round(minZ), maxX: round(maxX), maxZ: round(maxZ) },
  buildings,
  roads,
  areas,
  trams,
  landmarks,
  trees,
  signs: [...shopfronts.signs, ...streetPlates],
  ...(logoRects.length ? { logos: logoRects } : {}),
  terraces: shopfronts.terraces,
  velo,
  ...streetDetail(elements, roads, inBounds, open),
};
const json = JSON.stringify(city);
await writeFile(`${OUT_DIR}/city.json`, json);
const minimap = await renderMinimap(city, `${OUT_DIR}/minimap.webp`);

const graphJson = JSON.stringify(graph);
await writeFile(`${OUT_DIR}/graph.json`, graphJson);

const count = (k: AreaKind) => areas.filter((a) => a.k === k).length;
console.log(
  `buildings ${buildings.length} (heights: ${JSON.stringify(heightSources)}; ${split.replaced.size} outlines split around their parts into ${split.masses.length} pieces; ` +
    `${masses.filter((m) => m.canopy).length} canopies, ${raised.length} raised, ${postsUnder.length} posts; ${slivers} slivers dropped)\n` +
    `roads ${roads.length}, trams ${trams.length}, water ${count('water')}, green ${count('green')}, plazas ${count('plaza')}\n` +
    `landmarks ${landmarks.map((l) => `${l.id}(${l.parts.length})`).join(' ')}, trees ${trees.length / 4}, ` +
    `street-facing ${buildings.filter((b) => b.sf).length}, shops ${buildings.filter((b) => b.sh && b.sh !== 2).length}, ` +
    `cafés ${buildings.filter((b) => b.sh === 2).length}, signs ${shopfronts.signs.length} (${shopfronts.signs.filter((s) => s[7] !== undefined).length} with ${logoRects.length} logos, ${JSON.stringify(Object.fromEntries(['hotel', 'culture', 'public', 'plate'].map((k) => [k, shopfronts.signs.filter((s) => s[4] === k).length])))}), street plates ${streetPlates.length}, velo ${velo.length / 4}, terraces ${shopfronts.terraces.length / 4}, crossings ${city.crossings.length}, lamps ${city.props.lamps.length / 2}, benches ${city.props.benches.length / 2}, ` +
    `bollards ${city.props.bollards.length / 2}, signals ${city.props.signals.length / 3}\n` +
    `slice ${(maxX - minX).toFixed(0)} × ${(maxZ - minZ).toFixed(0)} m → ${OUT_DIR}/city.json ${(json.length / 1e6).toFixed(2)} MB`,
);
console.log(
  `drive graph ${graph.drive.edges.length} edges (${graph.drive.edges.filter((e) => e.o).length} one-way), ` +
    `walk graph ${graph.walk.edges.length} edges, tram runs ${graph.trams.length} ` +
    `(lines ${[...new Set(graph.trams.map((t) => t.line))].join(' ')}), bus runs ${graph.buses.length} ` +
    `(${new Set(graph.buses.map((b) => b.line)).size} lines, ${graph.buses.filter((b) => b.end).length} ending at a terminus), hospital ${graph.hospital} → ${OUT_DIR}/graph.json ${(graphJson.length / 1e6).toFixed(2)} MB`,
);
console.log(`minimap ${minimap.width}×${minimap.height} px, ${(minimap.bytes / 1024).toFixed(0)} KB → ${OUT_DIR}/minimap.webp`);
