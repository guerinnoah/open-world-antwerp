import polygonClipping, { type Polygon } from 'polygon-clipping';
import type { Building } from '../../src/world/cityData.ts';
import { cleanRing, flat, outlineGrid, pointInRing, segmentDistance, signedArea, type Outline, type Pt } from './geo.ts';

export interface Mass extends Outline {
  rings: Pt[][];
  isPart: boolean;
  canopy?: boolean;
}

const closed = (rings: Pt[][]): Polygon => rings.map((r) => [...r, r[0]]);

function opened(poly: Polygon): Pt[][] {
  return poly.map((r, i) => {
    const ring = cleanRing(r as Pt[]);
    if (signedArea(ring) > 0 !== (i === 0)) ring.reverse();
    return ring;
  });
}

const area = (rings: Pt[][]) => rings.reduce((s, r) => s + signedArea(r), 0);

function perimeter(rings: Pt[][]): number {
  let p = 0;
  for (const r of rings) for (let i = 0; i < r.length; i++) p += Math.hypot(r[(i + 1) % r.length][0] - r[i][0], r[(i + 1) % r.length][1] - r[i][1]);
  return p;
}

/** Drops slivers (GRB overhang strips, clipping crumbs) that would stand as lone walls. */
export const solid = (rings: Pt[][]) => area(rings) >= 1.5 && (2 * area(rings)) / perimeter(rings) >= 0.7;

function bbox(ring: Pt[]): [number, number, number, number] {
  const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}

function overlap(a: Mass, b: Mass): number {
  const [ax0, az0, ax1, az1] = bbox(a.outer);
  const [bx0, bz0, bx1, bz1] = bbox(b.outer);
  if (ax1 < bx0 || bx1 < ax0 || az1 < bz0 || bz1 < az0) return 0;
  try {
    return polygonClipping.intersection(closed(a.rings), closed(b.rings)).reduce((s, poly) => s + area(opened(poly)), 0);
  } catch {
    return 0;
  }
}

function pieces(geom: Polygon[], make: (rings: Pt[][]) => Mass): Mass[] {
  return geom.map(opened).filter((rings) => rings[0].length >= 3 && solid(rings)).map(make);
}

/** Outline minus its parts, plus a ground floor under raised parts (inside the outline only). */
export function splitOutlines(
  outlines: Mass[], parts: Mass[], remainderHeight: (o: Mass, parts: Mass[]) => number,
): { replaced: Set<Mass>; masses: Mass[] } {
  const replaced = new Set<Mass>();
  const masses: Mass[] = [];
  for (const o of outlines) {
    const on = parts.filter((p) => overlap(o, p) > 1);
    if (!on.length) continue;
    replaced.add(o);
    try {
      const h = remainderHeight(o, on);
      const rest = polygonClipping.difference(closed(o.rings), ...on.map((p) => closed(p.rings)));
      masses.push(...pieces(rest, (rings) => ({ b: { ...o.b, h, rings: rings.map(flat) }, outer: rings[0], rings, isPart: false })));
      for (const p of on) {
        const mh = p.b.mh ?? 0;
        if (mh < 0.5 || p.canopy) continue;
        const lower = on.filter((q) => q !== p && (q.b.mh ?? 0) < mh - 0.05);
        const under = polygonClipping.intersection(closed(o.rings), closed(p.rings));
        const gap = lower.length ? polygonClipping.difference(under, ...lower.map((q) => closed(q.rings))) : under;
        const base: Building = { h: mh, c: o.b.c, r: o.b.r, m: o.b.m, rings: [] };
        if (o.b.nw) base.nw = 1;
        if (o.b.hd) base.hd = 1;
        masses.push(...pieces(gap, (rings) => ({ b: { ...base, rings: rings.map(flat) }, outer: rings[0], rings, isPart: false })));
      }
    } catch {
      // polygon-clipping gives up on some degenerate rings: keep just the parts
    }
  }
  return { replaced, masses };
}

/** Douglas–Peucker: curved canopies get posts at real corners, not every vertex. */
export function simplify(ring: Pt[], tolerance: number): Pt[] {
  if (ring.length <= 4) return ring;
  const keep = new Set([0]);
  let far = 0;
  for (let i = 1; i < ring.length; i++) if (Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]) > Math.hypot(ring[far][0] - ring[0][0], ring[far][1] - ring[0][1])) far = i;
  keep.add(far);
  const chain = (a: number, b: number) => {
    let best = -1, dist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(ring[i % ring.length], ...ring[a % ring.length], ...ring[b % ring.length]);
      if (d > dist) [best, dist] = [i, d];
    }
    if (best < 0) return;
    keep.add(best % ring.length);
    chain(a, best);
    chain(best, b);
  };
  chain(0, far);
  chain(far, ring.length);
  const out = [...keep].sort((a, b) => a - b).map((i) => ring[i]);
  return out.length >= 3 ? out : ring;
}

const POST = 0.4; // m square
const POST_SPACING = 9; // m along an edge
const POST_INSET = 0.35; // m in from the roof edge

export function posts(raised: Mass[], ground: Mass[], free: (p: Pt) => boolean): Building[] {
  const near = outlineGrid(ground);
  const carried = (p: Pt) =>
    near(p).some((g) => pointInRing(p, g.outer) || g.outer.some((a, i) => segmentDistance(p, ...a, ...g.outer[(i + 1) % g.outer.length]) < 0.8));
  const taken = new Map<string, Pt[]>();
  const out: Building[] = [];
  for (const m of raised) {
    const top = m.b.mh ?? 0;
    if (top < 2 || m.b.hd) continue;
    const ring = simplify(m.outer, 1);
    const n = ring.length;
    const normals = ring.map((a, i) => {
      const b = ring[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len] as Pt; // inward: outer rings wind positive
    });
    const spots: [Pt, Pt][] = [];
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const [nx, nz] = normals[i];
      const [px, pz] = normals[(i + n - 1) % n];
      spots.push([a, [nx + px, nz + pz]]);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.ceil(len / POST_SPACING);
      for (let s = 1; s < steps; s++) spots.push([[a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps], normals[i]]);
    }
    for (const [at, [ix, iz]] of spots) {
      let p: Pt | undefined;
      for (const k of [1, 4, 8]) {
        const q: Pt = [at[0] + ix * POST_INSET * k, at[1] + iz * POST_INSET * k];
        if (!pointInRing(q, m.outer) || carried(q)) break;
        if (free(q)) {
          p = q;
          break;
        }
      }
      if (!p) continue;
      const cell = (dx: number, dz: number) => `${Math.floor(p[0] / 2) + dx},${Math.floor(p[1] / 2) + dz}`;
      const crowded = [-1, 0, 1].some((dx) => [-1, 0, 1].some((dz) => taken.get(cell(dx, dz))?.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 2)));
      if (crowded) continue;
      taken.set(cell(0, 0), [...(taken.get(cell(0, 0)) ?? []), p]);
      const [x, z] = p, r = POST / 2;
      out.push({ h: top, c: m.b.c, r: m.b.r, nw: 1, rings: [flat([[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]])] });
    }
  }
  return out;
}
