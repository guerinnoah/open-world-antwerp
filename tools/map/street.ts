import type { CityData, Road } from '../../src/world/cityData.ts';
import { besideRoad, flat, project, round, round2, roadGrid, toPts, type OsmElement, type Pt } from './geo.ts';

function nearestRoad(roads: Road[], p: Pt, max: number) {
  let best: { d: number; dx: number; dz: number; w: number; cx: number; cz: number } | null = null;
  for (const r of roads) {
    if (r.k !== 'major' && r.k !== 'minor') continue;
    for (let i = 0; i < r.p.length - 2; i += 2) {
      const [x0, z0, x1, z1] = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]];
      const sx = x1 - x0, sz = z1 - z0, len = Math.hypot(sx, sz);
      if (len < 0.1) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - x0) * sx + (p[1] - z0) * sz) / (len * len)));
      const cx = x0 + sx * t, cz = z0 + sz * t;
      const d = Math.hypot(p[0] - cx, p[1] - cz);
      if (d < max && (!best || d < best.d)) best = { d, dx: sx / len, dz: sz / len, w: r.w, cx, cz };
    }
  }
  return best;
}

export function streetDetail(
  elements: OsmElement[], roads: Road[], inBounds: (p: Pt) => boolean, free: (p: Pt) => boolean,
): Pick<CityData, 'crossings' | 'props'> {
  const crossings: number[][] = [];
  const props: CityData['props'] = { lamps: [], benches: [], bollards: [], signals: [] };
  const near = roadGrid(roads, 60);
  const inCarriageway = (p: Pt) => besideRoad(p, near(p).filter((r) => r.k === 'major' || r.k === 'minor' || r.k === 'service'), 0);

  for (const e of elements) {
    const t = e.tags ?? {};
    if (e.type === 'way' && t.footway === 'crossing' && e.geometry && t.crossing !== 'unmarked') {
      const pts = toPts(e.geometry);
      if (pts.some(inBounds)) crossings.push(flat(pts));
      continue;
    }
    if (e.type !== 'node' || e.lat === undefined) continue;
    const p = project(e.lat, e.lon!);
    if (!inBounds(p)) continue;
    if (t.highway === 'crossing' && t.crossing !== 'unmarked' && t.crossing !== 'no') {
      const road = nearestRoad(near(p), p, 3);
      if (!road) continue;
      const nx = -road.dz, nz = road.dx, h = road.w / 2 - 0.5;
      crossings.push([round(road.cx - nx * h), round(road.cz - nz * h), round(road.cx + nx * h), round(road.cz + nz * h)]);
    } else if (t.highway === 'traffic_signals') {
      // Mapped on the centreline: a pole on each kerb, facing along the road. At a junction node the kerb point
      // lies in the cross street, so the pole slides back along the kerb to its corner.
      const road = nearestRoad(near(p), p, 4);
      if (!road) continue;
      const nx = -road.dz, nz = road.dx, off = road.w / 2 + 0.7;
      const facing = Math.atan2(road.dz, road.dx);
      for (const [side, angle] of [[1, facing], [-1, facing > 0 ? facing - Math.PI : facing + Math.PI]]) {
        const pole = [0, 4, -4, 8, -8, 12, -12]
          .map((s): Pt => [road.cx + nx * off * side + road.dx * s, road.cz + nz * off * side + road.dz * s])
          .find((q) => !inCarriageway(q));
        if (pole) props.signals.push(round(pole[0]), round(pole[1]), round2(angle));
      }
    } else if (t.highway === 'street_lamp') props.lamps.push(round(p[0]), round(p[1]));
    else if (t.amenity === 'bench') props.benches.push(round(p[0]), round(p[1]));
    else if (t.barrier === 'bollard') props.bollards.push(round(p[0]), round(p[1]));
  }

  // Few lamps are mapped: add one every 28 m along every street, alternating kerbs, clear of junctions at either end.
  for (const r of roads) {
    if (r.k !== 'major' && r.k !== 'minor') continue;
    let total = 0;
    for (let i = 0; i < r.p.length - 2; i += 2) total += Math.hypot(r.p[i + 2] - r.p[i], r.p[i + 3] - r.p[i + 1]);
    let carry = 14, side = 1, walked = 0;
    for (let i = 0; i < r.p.length - 2; i += 2) {
      const [x0, z0, x1, z1] = [r.p[i], r.p[i + 1], r.p[i + 2], r.p[i + 3]];
      const len = Math.hypot(x1 - x0, z1 - z0);
      walked += len;
      if (len < 0.1) continue;
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      let d = carry;
      for (; d < len; d += 28) {
        const at = walked - len + d;
        if (at < 8 || at > total - 8) continue;
        const off = side * (r.w / 2 + 0.7);
        const p: Pt = [x0 + ux * d - uz * off, z0 + uz * d + ux * off];
        side = -side;
        if (inBounds(p) && free(p) && !inCarriageway(p)) props.lamps.push(round(p[0]), round(p[1]));
      }
      carry = d - len;
    }
  }
  return { crossings, props };
}
