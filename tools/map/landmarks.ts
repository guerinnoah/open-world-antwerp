import type { Landmark, LandmarkId } from '../../src/world/cityData.ts';
import { centroid, obb, pointInRing, project, round2, toPts, type OsmElement, type Outline, type Pt } from './geo.ts';

const BUILDINGS: [LandmarkId, number, '+x' | '+z', 'tallest' | LandmarkId | null][] = [
  ['cathedral', 26495164, '+x', 'tallest'],
  ['centraal', 24029676, '+x', 'tallest'],
  ['boerentoren', 40102689, '+x', 'tallest'],
  ['stadhuis', 22966134, '+z', 'brabo'],
  ['steen', 29067925, '+z', 'langeWapper'],
  ['mas', 25364883, '+x', null],
];

export function extractLandmarks(elements: OsmElement[], candidates: Outline[]): Landmark[] {
  const byId = new Map(elements.map((e) => [`${e.type}/${e.id}`, e]));
  const points: Partial<Record<LandmarkId, Pt>> = {};

  const brabo = elements.find((e) => e.tags?.amenity === 'fountain' && /Brabo/.test(e.tags.name ?? '') && e.geometry);
  const wapper = elements.find((e) => e.type === 'node' && e.tags?.name === 'Lange Wapper');
  const landmarks: Landmark[] = [];
  if (brabo) {
    const ring = toPts(brabo.geometry!);
    const box = obb(ring);
    points.brabo = [box.cx, box.cz];
    landmarks.push(place('brabo', box.cx, box.cz, box.angle, box.length, box.width, 0, ring, []));
  }
  if (wapper) {
    points.langeWapper = project(wapper.lat!, wapper.lon!);
    landmarks.push(place('langeWapper', ...points.langeWapper, 0, 2, 2, 0, [], []));
  }

  for (const [id, wayId, axis, ref] of BUILDINGS) {
    const e = byId.get(`way/${wayId}`);
    if (!e?.geometry) continue;
    const ring = toPts(e.geometry);
    ring.pop();
    const inside = candidates.filter((c) => pointInRing(centroid(c.outer), ring));
    for (const c of inside) c.b.hd = 1;
    const parts = inside.map((c) => ({ h: c.b.h, mh: c.b.mh ?? 0, outer: c.outer }));
    const height = Math.max(0, ...parts.map((p) => p.h));

    const box = obb(ring);
    let angle = box.angle;
    const target =
      ref === 'tallest' ? centroid(parts.reduce((a, b) => (b.h > a.h ? b : a)).outer) : ref ? points[ref] : undefined;
    if (target) {
      const [lx, lz] = toLocal(target, box.cx, box.cz, angle);
      if ((axis === '+x' ? lx : lz) < 0) angle += Math.PI;
    }
    landmarks.push(place(id, box.cx, box.cz, angle, box.length, box.width, height, ring, parts));
  }
  return landmarks;
}

function toLocal([x, z]: Pt, cx: number, cz: number, angle: number): Pt {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [(x - cx) * c + (z - cz) * s, -(x - cx) * s + (z - cz) * c];
}

function place(
  id: LandmarkId, cx: number, cz: number, angle: number, length: number, width: number, height: number,
  ring: Pt[], parts: { h: number; mh: number; outer: Pt[] }[],
): Landmark {
  const local = (r: Pt[]) => r.flatMap((p) => toLocal(p, cx, cz, angle).map(round2));
  return {
    id, x: round2(cx), z: round2(cz), angle: round2(Math.atan2(Math.sin(angle), Math.cos(angle))),
    length: round2(length), width: round2(width), height: round2(height),
    ring: local(ring),
    parts: parts.map((p) => ({ h: p.h, mh: p.mh, ring: local(p.outer) })),
  };
}
