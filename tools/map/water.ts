import polygonClipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';
import type { Area, CityData, Road } from '../../src/world/cityData.ts';
import { WaterMap } from '../../src/world/water.ts';
import { flat, type Pt } from './geo.ts';

type Box = [number, number, number, number];

function closed(r: number[]): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  return [...pts, pts[0]];
}

function boxOf(poly: Polygon): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of poly[0]) {
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], z);
    box[2] = Math.max(box[2], x);
    box[3] = Math.max(box[3], z);
  }
  return box;
}

const overlaps = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

const area = (k: Area['k'], poly: Polygon): Area => ({ k, rings: poly.map((r) => flat(r.slice(0, -1) as Pt[])) });

/** Overshoots each end by half a width so segments overlap at joins. */
function deck([x0, z0]: Pt, [x1, z1]: Pt, width: number): Polygon {
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  const ex = ((x1 - x0) / len) * (width / 2), ez = ((z1 - z0) / len) * (width / 2);
  const nx = -ez, nz = ex;
  return [[[x0 - ex + nx, z0 - ez + nz], [x1 + ex + nx, z1 + ez + nz], [x1 + ex - nx, z1 + ez - nz], [x0 - ex - nx, z0 - ez - nz], [x0 - ex + nx, z0 - ez + nz]]];
}

function wetSegment(map: WaterMap, [x0, z0]: Pt, [x1, z1]: Pt, half: number): boolean {
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  const nx = (-(z1 - z0) / len) * half, nz = ((x1 - x0) / len) * half;
  const steps = Math.ceil(len);
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps, z = z0 + ((z1 - z0) * s) / steps;
    if (map.contains(x, z) || map.contains(x + nx, z + nz) || map.contains(x - nx, z - nz)) return true;
  }
  return false;
}

/** Overlaps no other area, so ground, minimap and drowning agree. */
export function layWater(water: MultiPolygon, bounds: Polygon, roads: Road[], areas: Area[]): Area[] {
  const raw = polygonClipping.intersection(polygonClipping.union(water), bounds);
  const rawMap = new WaterMap({ areas: raw.map((poly) => area('water', poly)) } as CityData);
  const decks: Polygon[] = areas.filter((a) => a.k === 'plaza').map((a) => a.rings.map(closed));
  for (const r of roads) {
    const width = r.w + 1; // margin for the corners the ribbon mitres out
    for (let i = 0; i < r.p.length - 2; i += 2) {
      const a: Pt = [r.p[i], r.p[i + 1]], b: Pt = [r.p[i + 2], r.p[i + 3]];
      if (wetSegment(rawMap, a, b, width / 2)) decks.push(deck(a, b, width));
    }
  }
  const settled = decks.length ? polygonClipping.difference(raw, ...decks) : raw;
  const boxes = settled.map(boxOf);
  const out: Area[] = [];
  for (const a of areas) {
    const poly = a.rings.map(closed);
    if (a.k !== 'green' || !boxes.some((b) => overlaps(b, boxOf(poly)))) {
      out.push(a);
      continue;
    }
    for (const part of polygonClipping.difference(poly, settled)) out.push(area('green', part));
  }
  for (const poly of settled) out.push(area('water', poly));
  return out;
}
