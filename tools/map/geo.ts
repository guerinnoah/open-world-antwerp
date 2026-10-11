import type { Building, Road } from '../../src/world/cityData.ts';
import { project } from '../../src/world/projection.ts';

export { project };

export type Pt = [number, number]; // local metres from the Grote Markt: x east, z south (src/world/projection.ts)
type LatLon = { lat: number; lon: number };

/** An OSM element as Overpass returns it with `out geom`. */
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  nodes?: number[];
  geometry?: LatLon[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
  members?: { type: string; ref: number; role: string; geometry?: LatLon[]; lat?: number; lon?: number }[];
}

export interface Outline {
  b: Building;
  outer: Pt[];
}

export const round = (v: number) => Math.round(v * 10) / 10; // map coordinates are kept to 0.1 m
export const round2 = (v: number) => Math.round(v * 100) / 100;
export const toPts = (g: LatLon[]) => g.map((n) => project(n.lat, n.lon));
export const flat = (pts: Pt[]) => pts.flatMap(([x, z]) => [round(x), round(z)]);

export function signedArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

export function pointInRing([x, z]: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(ring: Pt[]): Pt {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p[0];
    z += p[1];
  }
  return [x / ring.length, z / ring.length];
}

/** A point inside the ring. The vertex centroid when it is inside; for L- and U-shapes, the middle of the widest span on a few scanlines. */
export function interiorPoint(ring: Pt[]): Pt {
  const c = centroid(ring);
  if (pointInRing(c, ring)) return c;
  const zs = ring.map((p) => p[1]);
  const top = Math.min(...zs), depth = Math.max(...zs) - top;
  let best = c, widest = 0;
  for (const f of [0.5, 0.25, 0.75]) {
    const z = top + depth * f;
    const xs: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z) xs.push(((xj - xi) * (z - zi)) / (zj - zi) + xi);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] <= widest) continue;
      widest = xs[k + 1] - xs[k];
      best = [(xs[k] + xs[k + 1]) / 2, z];
    }
  }
  return best;
}

export function cleanRing(ring: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length > 1 && out[0][0] === out.at(-1)![0] && out[0][1] === out.at(-1)![1]) out.pop();
  return out;
}

export function assembleRings(ways: Pt[][]): Pt[][] {
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const open = ways.filter((w) => w.length > 1).map((w) => [...w]);
  const rings: Pt[][] = [];
  while (open.length) {
    const ring = open.pop()!;
    let progress = true;
    while (key(ring[0]) !== key(ring.at(-1)!) && progress) {
      progress = false;
      const end = key(ring.at(-1)!);
      for (let i = 0; i < open.length; i++) {
        const w = open[i];
        if (key(w[0]) === end) ring.push(...w.slice(1));
        else if (key(w.at(-1)!) === end) ring.push(...w.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        progress = true;
        break;
      }
    }
    if (key(ring[0]) === key(ring.at(-1)!) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Rings of a closed way or multipolygon; outer wound positive, holes negative, so edge (dx, dz) faces out along (dz, -dx). */
export function polygonsOf(e: OsmElement): Pt[][][] {
  let outers: Pt[][];
  let inners: Pt[][] = [];
  if (e.type === 'way') {
    const g = e.geometry ?? [];
    if (g.length < 4 || g[0].lat !== g.at(-1)!.lat || g[0].lon !== g.at(-1)!.lon) return [];
    outers = [toPts(g)];
  } else {
    const ways = (role: string) =>
      (e.members ?? []).filter((m) => m.type === 'way' && m.role === role && m.geometry).map((m) => toPts(m.geometry!));
    outers = assembleRings(ways('outer'));
    inners = assembleRings(ways('inner'));
  }
  return outers.map((o) => {
    const outer = cleanRing(o);
    if (signedArea(outer) < 0) outer.reverse();
    const holes = inners
      .filter((h) => pointInRing(h[0], outer))
      .map((h) => {
        const hole = cleanRing(h);
        if (signedArea(hole) > 0) hole.reverse();
        return hole;
      });
    return [outer, ...holes].filter((r) => r.length >= 3);
  });
}

export function obb(ring: Pt[]): { cx: number; cz: number; angle: number; length: number; width: number } {
  let best = { area: Infinity, cx: 0, cz: 0, angle: 0, length: 0, width: 0 };
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    if (x0 === x1 && z0 === z1) continue;
    const a = Math.atan2(z1 - z0, x1 - x0);
    const c = Math.cos(a), s = Math.sin(a);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * c + z * s, v = -x * s + z * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area >= best.area) continue;
    const u = (minU + maxU) / 2, v = (minV + maxV) / 2;
    best = { area, cx: u * c - v * s, cz: u * s + v * c, angle: a, length: maxU - minU, width: maxV - minV };
  }
  if (best.width > best.length) best = { ...best, angle: best.angle + Math.PI / 2, length: best.width, width: best.length };
  return best;
}

export function segmentDistance([x, z]: Pt, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
}

export function besideRoad(p: Pt, roads: Road[], margin: number): boolean {
  return roads.some((r) => {
    for (let k = 0; k < r.p.length - 2; k += 2) {
      if (segmentDistance(p, r.p[k], r.p[k + 1], r.p[k + 2], r.p[k + 3]) < r.w / 2 + margin) return true;
    }
    return false;
  });
}

/** Roads near p: every road passing within size / 2 of it (and some further). */
export function roadGrid(roads: Road[], size: number) {
  const grid = new Map<string, Road[]>();
  for (const r of roads) {
    const keys = new Set<string>();
    // Every cell along each segment, not just the vertex cells: long straight streets have vertices 200+ m apart.
    for (let i = 0; i < r.p.length - 2; i += 2) {
      const [x0, z0, x1, z1] = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (size / 2)));
      for (let s = 0; s <= n; s++) keys.add(`${Math.floor((x0 + ((x1 - x0) * s) / n) / size)},${Math.floor((z0 + ((z1 - z0) * s) / n) / size)}`);
    }
    for (const k of keys) grid.set(k, [...(grid.get(k) ?? []), r]);
  }
  return (p: Pt) => {
    const out = new Set<Road>();
    const gx = Math.floor(p[0] / size), gz = Math.floor(p[1] / size);
    for (let x = gx - 1; x <= gx + 1; x++) for (let z = gz - 1; z <= gz + 1; z++) for (const r of grid.get(`${x},${z}`) ?? []) out.add(r);
    return [...out];
  };
}

const CELL = 50;

export function outlineGrid<T extends { outer: Pt[] }>(items: T[]) {
  const grid = new Map<string, T[]>();
  for (const item of items) {
    const xs = item.outer.map((p) => p[0]);
    const zs = item.outer.map((p) => p[1]);
    for (let gx = Math.floor(Math.min(...xs) / CELL); gx <= Math.floor(Math.max(...xs) / CELL); gx++) {
      for (let gz = Math.floor(Math.min(...zs) / CELL); gz <= Math.floor(Math.max(...zs) / CELL); gz++) {
        const k = `${gx},${gz}`;
        grid.set(k, [...(grid.get(k) ?? []), item]);
      }
    }
  }
  return ([x, z]: Pt) => grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [];
}
