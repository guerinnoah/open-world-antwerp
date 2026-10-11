import type { Building, BusRun, GraphData, GraphEdge, RoadGraph, TramRun } from '../../src/world/cityData.ts';
import { cumulative, offsetPolyline, pointAt } from '../../src/world/polyline.ts';
import { centroid, flat, project, round, round2, toPts, type OsmElement, type Pt } from './geo.ts';

interface GraphInput {
  elements: OsmElement[];
  buildings: Building[];
  inBounds: (p: Pt) => boolean;
  roadWidth: (tags: Record<string, string>) => number | undefined;
}

const BUS_LANE = 1.9; // m right of the centreline on two-way streets, where AI traffic drives (src/actors/traffic.ts)

const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link',
  'secondary_link', 'tertiary_link', 'residential', 'unclassified', 'living_street',
]);
const WALKABLE = new Set([
  'primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link', 'residential',
  'unclassified', 'living_street', 'service', 'pedestrian', 'footway', 'path', 'steps', 'track',
]);
/** Walked down the middle (sidewalks [0, 0]); other car roads get sidewalks at the kerb. */
const CENTRELINE = new Set(['pedestrian', 'footway', 'path', 'steps', 'track', 'living_street', 'service']);

const DEFAULT_KMH: Record<string, number> = { living_street: 20, residential: 30, unclassified: 30, tertiary: 30 };

const blocked = (t: Record<string, string>, mode: 'car' | 'foot') => {
  const no = (v?: string) => v === 'no' || v === 'private';
  if (no(t.access) && !(mode === 'foot' && (t.foot === 'yes' || t.foot === 'designated'))) return true;
  if (mode === 'car') return no(t.motor_vehicle) || no(t.motorcar) || no(t.vehicle);
  return no(t.foot);
};

export const underground = (t: Record<string, string>) =>
  t.tunnel === 'yes' || t.tunnel === 'building_passage' || parseFloat(t.layer ?? '0') < 0 || t.indoor === 'yes';

function speedOf(t: Record<string, string>): number {
  const kmh = t.maxspeed === 'walk' ? 6 : parseFloat(t.maxspeed ?? '') || DEFAULT_KMH[t.highway] || 50;
  return round(kmh / 3.6);
}

function buildGraph(
  ways: OsmElement[],
  inBounds: (p: Pt) => boolean,
  edgeProps: (w: OsmElement, p: number[]) => Omit<GraphEdge, 'a' | 'b' | 'p' | 'len'>,
): RoadGraph {
  const uses = new Map<number, number>();
  for (const w of ways) for (const n of w.nodes!) uses.set(n, (uses.get(n) ?? 0) + 1);
  const nodeIndex = new Map<number, number>();
  const nodes: number[] = [];
  const edges: GraphEdge[] = [];
  const nodeOf = (id: number, p: Pt) => {
    let i = nodeIndex.get(id);
    if (i === undefined) {
      i = nodes.length / 2;
      nodeIndex.set(id, i);
      nodes.push(round(p[0]), round(p[1]));
    }
    return i;
  };

  for (const w of ways) {
    const pts = toPts(w.geometry!);
    const ids = w.nodes!;
    let start = 0;
    for (let i = 1; i < ids.length; i++) {
      if (i < ids.length - 1 && uses.get(ids[i])! < 2) continue;
      const seg = pts.slice(start, i + 1);
      if (seg.some(inBounds)) {
        let len = 0;
        for (let k = 1; k < seg.length; k++) len += Math.hypot(seg[k][0] - seg[k - 1][0], seg[k][1] - seg[k - 1][1]);
        if (len > 0.5) {
          const p = flat(seg);
          edges.push({
            a: nodeOf(ids[start], seg[0]),
            b: nodeOf(ids[i], seg[seg.length - 1]),
            p,
            len: round(len),
            ...edgeProps(w, p),
          });
        }
      }
      start = i;
    }
  }
  return { nodes, edges };
}

function makeClearance(buildings: Building[]) {
  const CELL = 25;
  const grid = new Map<string, number[]>();
  for (const b of buildings) {
    if (b.nc) continue;
    for (const r of b.rings) {
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length;
        const [x0, z0, x1, z1] = [r[i], r[i + 1], r[j], r[j + 1]];
        for (let gx = Math.floor(Math.min(x0, x1) / CELL); gx <= Math.floor(Math.max(x0, x1) / CELL); gx++) {
          for (let gz = Math.floor(Math.min(z0, z1) / CELL); gz <= Math.floor(Math.max(z0, z1) / CELL); gz++) {
            const k = `${gx},${gz}`;
            let list = grid.get(k);
            if (!list) grid.set(k, (list = []));
            list.push(x0, z0, x1, z1);
          }
        }
      }
    }
  }
  return (x: number, z: number, dx: number, dz: number, max: number) => {
    let best = max;
    const ex = x + dx * max, ez = z + dz * max;
    for (let gx = Math.floor(Math.min(x, ex) / CELL); gx <= Math.floor(Math.max(x, ex) / CELL); gx++) {
      for (let gz = Math.floor(Math.min(z, ez) / CELL); gz <= Math.floor(Math.max(z, ez) / CELL); gz++) {
        const s = grid.get(`${gx},${gz}`);
        if (!s) continue;
        for (let i = 0; i < s.length; i += 4) {
          const sx = s[i + 2] - s[i], sz = s[i + 3] - s[i + 1];
          const den = dx * sz - dz * sx;
          if (Math.abs(den) < 1e-9) continue;
          const qx = s[i] - x, qz = s[i + 1] - z;
          const t = (qx * sz - qz * sx) / den;
          const u = (qx * dz - qz * dx) / den;
          if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
        }
      }
    }
    return best;
  };
}

/** Sidewalk offsets [left, right] (m from the centreline) from the median room to the building line; -1: no room. */
function sidewalks(p: number[], width: number, clearance: ReturnType<typeof makeClearance>): [number, number] {
  const sides: number[][] = [[], []];
  let travelled = 0;
  for (let i = 0; i < p.length - 2; i += 2) {
    const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1];
    const len = Math.hypot(dx, dz);
    if (!len) continue;
    const ux = dx / len, uz = dz / len;
    for (let d = (8 - (travelled % 8)) % 8; d < len; d += 8) {
      const x = p[i] + ux * d, z = p[i + 1] + uz * d;
      sides[0].push(clearance(x, z, uz, -ux, 25));
      sides[1].push(clearance(x, z, -uz, ux, 25));
    }
    travelled += len;
  }
  return sides.map((s) => {
    if (!s.length) return width / 2 + 1.5;
    const median = [...s].sort((a, b) => a - b)[Math.floor(s.length / 2)];
    const free = median - width / 2;
    return free < 1.2 ? -1 : round(width / 2 + Math.min(free / 2, 2));
  }) as [number, number];
}

interface RoutePoint {
  p: Pt;
  way: OsmElement;
  fwd: boolean;
}

interface RoutePiece {
  pts: RoutePoint[];
  terminus: boolean;
}

function chainRoute(route: OsmElement, ways: Map<number, OsmElement>, inBounds: (p: Pt) => boolean): RoutePiece[] {
  const tracks = route.members!.filter((m) => m.type === 'way' && (m.role === '' || m.role === 'forward' || m.role === 'backward'));
  const pieces: RoutePiece[] = [];
  let current: RoutePoint[] = [];
  const flush = (terminus: boolean) => {
    if (current.length > 1) pieces.push({ pts: current, terminus });
    current = [];
  };
  const turn = () => {
    current.reverse();
    for (const q of current) q.fwd = !q.fwd;
  };
  const key = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  for (let i = 0; i < tracks.length; i++) {
    const way = ways.get(tracks[i].ref);
    if (!way || underground(way.tags!) || !tracks[i].geometry) {
      flush(false);
      continue;
    }
    const pts = toPts(tracks[i].geometry!);
    let fwd = true;
    if (current.length) {
      const end = key(current[current.length - 1].p);
      if (key(pts[pts.length - 1]) === end) fwd = false;
      else if (key(pts[0]) !== end) {
        if (key(current[0].p) === key(pts[0])) turn();
        else if (key(current[0].p) === key(pts[pts.length - 1])) {
          turn();
          fwd = false;
        } else flush(true);
      }
    } else if (i + 1 < tracks.length && tracks[i + 1].geometry) {
      // A piece's first way may be stored backwards: flip it if that's what connects it to the next.
      const next = toPts(tracks[i + 1].geometry!);
      const ends = [key(next[0]), key(next[next.length - 1])];
      if (ends.includes(key(pts[0])) && !ends.includes(key(pts[pts.length - 1]))) fwd = false;
    }
    if (!fwd) pts.reverse();
    for (const p of current.length ? pts.slice(1) : pts) {
      if (inBounds(p)) current.push({ p, way, fwd });
      else flush(false);
    }
  }
  flush(true);
  return pieces;
}

const lineColour = (t: Record<string, string>) => (/^#[0-9a-f]{6}$/i.test(t.colour ?? '') ? parseInt(t.colour.slice(1), 16) : 0xf2c400);

function tramRuns(elements: OsmElement[], inBounds: (p: Pt) => boolean): TramRun[] {
  const tramWays = new Map(elements.filter((e) => e.type === 'way' && e.tags?.railway === 'tram').map((e) => [e.id, e]));
  const runs: TramRun[] = [];
  for (const route of elements.filter((e) => e.type === 'relation' && e.tags?.route === 'tram')) {
    const line = route.tags!.ref ?? '?';
    const to = (route.tags!.to ?? '').replace(/^Boechout\s+/, '').trim();
    const colour = lineColour(route.tags!);
    const stopPts = route.members!.filter((m) => m.type === 'node' && m.role.startsWith('stop')).map((m) => project(m.lat!, m.lon!));

    for (const { pts } of chainRoute(route, tramWays, inBounds)) {
      const piece = pts.map((q) => q.p);
      const along = cumulative(piece.flat());
      const len = along[along.length - 1];
      if (len < 150) continue;
      const stops: number[] = [];
      for (const s of stopPts) {
        let best = Infinity, at = 0;
        for (let i = 0; i < piece.length; i++) {
          const d = Math.hypot(piece[i][0] - s[0], piece[i][1] - s[1]);
          if (d < best) [best, at] = [d, along[i]];
        }
        if (best < 10) stops.push(round(at));
      }
      runs.push({ line, colour, to, p: flat(piece), len: round(len), stops: stops.sort((a, b) => a - b) });
    }
  }
  return runs;
}

function flow(t: Record<string, string>): -1 | 0 | 1 {
  if (t.oneway === '-1') return -1;
  return t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.junction === 'roundabout' || t.highway === 'motorway' ? 1 : 0;
}

function nearestAlong(p: number[], q: Pt): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  let travelled = 0;
  for (let i = 0; i < p.length - 2; i += 2) {
    const sx = p[i + 2] - p[i], sz = p[i + 3] - p[i + 1];
    const len = Math.hypot(sx, sz);
    const u = len ? Math.max(0, Math.min(1, ((q[0] - p[i]) * sx + (q[1] - p[i + 1]) * sz) / (len * len))) : 0;
    const d = Math.hypot(q[0] - p[i] - sx * u, q[1] - p[i + 1] - sz * u);
    if (d < best.d) best = { s: travelled + len * u, d };
    travelled += len;
  }
  return best;
}

function busRuns(elements: OsmElement[], inBounds: (p: Pt) => boolean): BusRun[] {
  const roads = new Map(elements.filter((e) => e.type === 'way' && e.tags?.highway).map((e) => [e.id, e]));
  const runs: BusRun[] = [];
  for (const route of elements.filter((e) => e.type === 'relation' && e.tags?.route === 'bus')) {
    const line = route.tags!.ref ?? '?';
    const to = (route.tags!.to ?? '').trim();
    const colour = lineColour(route.tags!);
    const stopPts = route.members!.filter((m) => m.type === 'node' && /^(stop|platform)/.test(m.role)).map((m) => project(m.lat!, m.lon!));

    for (const { pts, terminus } of chainRoute(route, roads, inBounds)) {
      const centre = pts.flatMap(({ p }) => p);
      const along = cumulative(centre);
      const total = along[along.length - 1];
      const lane = pts.slice(1).map(({ way, fwd }) => {
        const f = flow(way.tags!);
        return f !== 0 && f === (fwd ? 1 : -1) ? 0 : BUS_LANE;
      });
      const laneAt = (s: number) => {
        const lo = Math.max(s - 8, 0), hi = Math.min(s + 8, total);
        let sum = 0;
        for (let i = 0; i < lane.length; i++) sum += Math.max(0, Math.min(hi, along[i + 1]) - Math.max(lo, along[i])) * lane[i];
        return sum / (hi - lo || 1);
      };
      const samples = [...along];
      for (let i = 1; i < lane.length; i++) {
        if (lane[i] !== lane[i - 1]) samples.push(Math.max(along[i] - 8, 0), Math.min(along[i] + 8, total));
      }
      samples.sort((x, y) => x - y);
      const at = samples.filter((s, i) => i === 0 || s - samples[i - 1] > 0.5 || i === samples.length - 1);
      const path = at.flatMap((s) => {
        const q = pointAt(centre, along, s);
        return [q.x, q.z];
      });
      const p = offsetPolyline(path, at.map(laneAt)).map(round);
      const len = cumulative(p).at(-1)!;
      if (len < 150) continue;
      const stops: number[] = [];
      for (const s of stopPts) {
        const near = nearestAlong(p, s);
        if (near.d < 15) stops.push(near.s);
      }
      stops.sort((a, b) => a - b);
      // A stop is often mapped twice (stop position on the road, platform at the kerb): merge within 25 m.
      const kept = stops.filter((s, i) => i === 0 || s - stops[i - 1] > 25).map(round);
      runs.push({ line, colour, to, p, len: round(len), stops: kept, ...(terminus ? { end: 1 as const } : {}) });
    }
  }
  return runs;
}

export function buildGraphData({ elements, buildings, inBounds, roadWidth }: GraphInput): GraphData {
  const ways = elements.filter(
    (e) => e.type === 'way' && e.nodes && e.geometry && e.tags?.highway && e.tags.area !== 'yes' && !underground(e.tags),
  );

  // oneway=-1 ways are drawn against the flow: reverse them so every one-way edge runs a → b.
  const driveWays = ways
    .filter((w) => DRIVABLE.has(w.tags!.highway) && !blocked(w.tags!, 'car'))
    .map((w) =>
      w.tags!.oneway === '-1'
        ? { ...w, nodes: [...w.nodes!].reverse(), geometry: [...w.geometry!].reverse(), tags: { ...w.tags, oneway: 'yes' } }
        : w,
    );
  const drive = buildGraph(driveWays, inBounds, (w) => {
    const t = w.tags!;
    const oneway = flow(t) !== 0;
    return { s: speedOf(t), w: roadWidth(t) ?? 7, ...(oneway ? { o: 1 as const } : {}), ...(t.name ? { n: t.name } : {}) };
  });

  const clearance = makeClearance(buildings);
  const walk = buildGraph(
    ways.filter((w) => WALKABLE.has(w.tags!.highway) && !blocked(w.tags!, 'foot')),
    inBounds,
    (w, p) => {
      const width = roadWidth(w.tags!) ?? 2;
      return { s: 1.4, w: width, sw: CENTRELINE.has(w.tags!.highway) ? [0, 0] : sidewalks(p, width, clearance) };
    },
  );

  const hospital = elements.find((e) => e.tags?.amenity === 'hospital' && /Sint-Elisabeth/.test(e.tags.name ?? ''));
  const hc: Pt = hospital?.geometry ? centroid(toPts(hospital.geometry)) : [0, 0];
  let spawn: [number, number, number] = [hc[0], hc[1], 0];
  let best = Infinity;
  for (const e of drive.edges) {
    for (let i = 0; i < e.p.length - 2; i += 2) {
      const [x0, z0, x1, z1] = [e.p[i], e.p[i + 1], e.p[i + 2], e.p[i + 3]];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 4) continue;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const d = Math.hypot(mx - hc[0], mz - hc[1]);
      if (d >= best) continue;
      best = d;
      const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
      const side = (hc[0] - mx) * nx + (hc[1] - mz) * nz > 0 ? 1 : -1;
      spawn = [round(mx + nx * side * (e.w / 2 + 1)), round(mz + nz * side * (e.w / 2 + 1)), round2(Math.atan2(z1 - z0, x1 - x0))];
    }
  }

  return { version: 1, drive, walk, trams: tramRuns(elements, inBounds), buses: busRuns(elements, inBounds), hospital: spawn };
}
