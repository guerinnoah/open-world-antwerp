import { pointInRing, project, segmentDistance, type OsmElement, type Outline, type Pt } from './geo.ts';

const HORECA = new Set(['cafe', 'restaurant', 'bar', 'pub', 'ice_cream', 'fast_food']);

export function markFacades(
  outlines: Outline[], elements: OsmElement[], near: (p: Pt) => Outline[], wet: (p: Pt) => boolean, onStreet: (p: Pt) => boolean,
) {
  for (const o of outlines) {
    const r = o.outer;
    const sf: number[] = [];
    for (let i = 0; i < r.length; i++) {
      const [x0, z0] = r[i];
      const [x1, z1] = r[(i + 1) % r.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 2.5) continue;
      const p: Pt = [(x0 + x1) / 2 + ((z1 - z0) / len) * 3, (z0 + z1) / 2 - ((x1 - x0) / len) * 3];
      if (wet(p) || !onStreet(p) || near(p).some((other) => other !== o && pointInRing(p, other.outer))) continue;
      sf.push(i);
    }
    if (sf.length) o.b.sf = sf;
  }

  for (const e of elements) {
    const t = e.tags;
    if (e.type !== 'node' || !t || e.lat === undefined || !(t.shop || HORECA.has(t.amenity) || t.amenity === 'bank' || t.amenity === 'pharmacy')) continue;
    const p = project(e.lat, e.lon!);
    const candidates = near(p);
    let host = candidates.find((o) => pointInRing(p, o.outer));
    if (!host) {
      let best = 5;
      for (const o of candidates) {
        const d = distanceToRing(p, o.outer);
        if (d < best) [best, host] = [d, o];
      }
    }
    if (host) host.b.sh = HORECA.has(t.amenity) || host.b.sh === 2 ? 2 : 1;
  }
}

function distanceToRing(p: Pt, ring: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    best = Math.min(best, segmentDistance(p, ax, az, bx, bz));
  }
  return best;
}
