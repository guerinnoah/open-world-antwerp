import earcut from 'earcut';
import type { Building } from './cityData';

export interface RoofPlan {
  kind: 'gable' | 'stepped' | 'hip';
  /** Eaves height (m), where the walls stop; the GRB 3D height is roughly the ridge, so the roof climbs to it. */
  eaves: number;
  ridge: number;
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  length: number;
  width: number;
}

export interface MeshArrays {
  pos: number[];
  nor: number[];
  col: number[];
  uvm: number[];
  surf: number[];
  fac: number[];
  idx: number[];
}

export interface Surface {
  layer: number;
  tint: { r: number; g: number; b: number };
}

type V = [number, number, number];

interface Paint extends Surface {
  windows: boolean;
  uv: (v: V) => [number, number];
  facade?: (v: V) => [number, number, number, number];
}

export const OLD_TOWN_RADIUS = 750; // m around the Grote Markt

export function planRoof(b: Building): RoofPlan | null {
  if (b.nw || b.mh || b.rings.length > 1 || b.h < 6 || b.h > 35) return null;
  const ring = b.rings[0];
  const box = orientedBox(ring);
  const area = Math.abs(ringArea(ring));
  if (area < 20 || box.width > 16 || area / (box.length * box.width) < 0.85) return null;

  const rise = Math.min(Math.max(box.width * 0.5, 2.5), 7, b.h * 0.45);
  const seed = hash(box.cx, box.cz);
  const oldTown = Math.hypot(box.cx, box.cz) < OLD_TOWN_RADIUS;
  const kind = box.width > 8.5 ? 'hip' : seed < (oldTown ? 0.45 : 0.08) ? 'stepped' : 'gable';
  return { kind, eaves: b.h - rise, ridge: b.h, ...box };
}

export function addRoof(out: MeshArrays, plan: RoofPlan, wallSurface: Surface, roofSurface: Surface, seed: number) {
  const { cx, cz, ux, uz, length: L, width: W, eaves, ridge } = plan;
  const vx = -uz, vz = ux;
  const at = (su: number, sv: number, y: number): V => [cx + ux * su + vx * sv, y, cz + uz * su + vz * sv];
  const centre: V = [cx, eaves - 1, cz];
  const o = 0.3; // eaves overhang (m)
  const hl = L / 2, hw = W / 2;
  const slope = Math.atan2(ridge - eaves, hw);
  const roof: Paint = { ...roofSurface, windows: false, uv: (p) => [p[0] * ux + p[2] * uz, p[1] / Math.sin(slope)] };
  const acrossRidge: Paint = { ...roofSurface, windows: false, uv: (p) => [p[0] * vx + p[2] * vz, p[1] / Math.sin(slope)] };
  // Gable ends carry on the wall material and windows: +5000 keeps u positive, top -1 = no cornice.
  const wall: Paint = {
    ...wallSurface, windows: true, uv: (p) => [p[0] * vx + p[2] * vz + 5000, p[1]],
    facade: (p) => [(p[0] - cx) * vx + (p[2] - cz) * vz + hw, W, -1, seed],
  };

  if (plan.kind === 'hip') {
    const r = Math.max(hl - hw, 0);
    quad(out, at(-hl - o, hw + o, eaves - 0.2), at(hl + o, hw + o, eaves - 0.2), at(r, 0, ridge), at(-r, 0, ridge), roof, centre);
    quad(out, at(hl + o, -hw - o, eaves - 0.2), at(-hl - o, -hw - o, eaves - 0.2), at(-r, 0, ridge), at(r, 0, ridge), roof, centre);
    tri(out, at(hl + o, hw + o, eaves - 0.2), at(hl + o, -hw - o, eaves - 0.2), at(r, 0, ridge), acrossRidge, centre);
    tri(out, at(-hl - o, -hw - o, eaves - 0.2), at(-hl - o, hw + o, eaves - 0.2), at(-r, 0, ridge), acrossRidge, centre);
    return;
  }

  const e = plan.kind === 'stepped' ? 0 : o; // stepped gables rise above the roof: no overhang at the ends
  quad(out, at(-hl - e, hw + o, eaves - 0.2), at(hl + e, hw + o, eaves - 0.2), at(hl + e, 0, ridge), at(-hl - e, 0, ridge), roof, centre);
  quad(out, at(hl + e, -hw - o, eaves - 0.2), at(-hl - e, -hw - o, eaves - 0.2), at(-hl - e, 0, ridge), at(hl + e, 0, ridge), roof, centre);
  for (const end of [-1, 1]) {
    if (plan.kind === 'gable') {
      tri(out, at(end * hl, -hw, eaves), at(end * hl, hw, eaves), at(end * hl, 0, ridge), wall, centre);
    } else {
      steppedGable(out, at, end * hl, end, hw, eaves, ridge, wall);
    }
  }
}

function steppedGable(
  out: MeshArrays, at: (su: number, sv: number, y: number) => V, su: number, end: number, hw: number,
  eaves: number, ridge: number, wall: Paint,
) {
  const steps = 5;
  const top = ridge + 0.7;
  const outline: [number, number][] = [[-hw, eaves]];
  for (let i = 0; i < steps; i++) {
    const y = eaves + ((top - eaves) * (i + 1)) / steps;
    outline.push([-hw + (hw * i) / steps, y], [-hw + (hw * (i + 1)) / steps - (i === steps - 1 ? hw / steps / 2 : 0), y]);
  }
  for (let i = steps - 1; i >= 0; i--) {
    const y = eaves + ((top - eaves) * (i + 1)) / steps;
    outline.push([hw - (hw * (i + 1)) / steps + (i === steps - 1 ? hw / steps / 2 : 0), y], [hw - (hw * i) / steps, y]);
  }
  outline.push([hw, eaves]);

  const t = 0.35;
  const front = t / 2 + 0.05, back = -t / 2 + 0.05;
  const point = (sv: number, y: number, depth: number) => at(su + end * depth, sv, y);
  const centre: V = at(su - end * 5, 0, eaves);
  const tris = earcut(outline.flat(), undefined, 2);
  for (const depth of [front, back]) {
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]].map((k) => point(outline[k][0], outline[k][1], depth));
      tri(out, a, b, c, wall, depth > 0 ? centre : at(su + end * 5, 0, eaves));
    }
  }
  for (let i = 0; i < outline.length - 1; i++) {
    const [s0, y0] = outline[i], [s1, y1] = outline[i + 1];
    const mid = point((s0 + s1) / 2, (y0 + y1) / 2 - 1, 0.05);
    quad(out, point(s0, y0, front), point(s1, y1, front), point(s1, y1, back), point(s0, y0, back), { ...wall, windows: false }, mid);
  }
}

function tri(out: MeshArrays, a: V, b: V, c: V, paint: Paint, inside: V) {
  emit(out, [a, b, c], [[0, 1, 2]], paint, inside);
}

function quad(out: MeshArrays, a: V, b: V, c: V, d: V, paint: Paint, inside: V) {
  emit(out, [a, b, c, d], [[0, 1, 2], [0, 2, 3]], paint, inside);
}

function emit(out: MeshArrays, verts: V[], faces: number[][], paint: Paint, inside: V) {
  const [a, b, c] = verts;
  let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const len = Math.hypot(nx, ny, nz) || 1;
  const centre = verts.reduce((s, v) => [s[0] + v[0] / verts.length, s[1] + v[1] / verts.length, s[2] + v[2] / verts.length], [0, 0, 0]);
  const flip = nx * (centre[0] - inside[0]) + ny * (centre[1] - inside[1]) + nz * (centre[2] - inside[2]) < 0;
  if (flip) [nx, ny, nz] = [-nx, -ny, -nz];
  const base = out.pos.length / 3;
  for (const v of verts) {
    out.pos.push(...v);
    out.nor.push(nx / len, ny / len, nz / len);
    out.col.push(paint.tint.r, paint.tint.g, paint.tint.b);
    out.uvm.push(...paint.uv(v));
    out.surf.push(paint.layer, paint.windows ? 1 : 0);
    out.fac.push(...(paint.facade?.(v) ?? [0, 0, 0, 0]));
  }
  for (const f of faces) {
    if (flip) out.idx.push(base + f[0], base + f[2], base + f[1]);
    else out.idx.push(base + f[0], base + f[1], base + f[2]);
  }
}

function orientedBox(ring: number[]) {
  let best = { area: Infinity, cx: 0, cz: 0, ux: 1, uz: 0, length: 0, width: 0 };
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ux = ring[j * 2] - ring[i * 2], uz = ring[j * 2 + 1] - ring[i * 2 + 1];
    const len = Math.hypot(ux, uz);
    if (len < 0.01) continue;
    ux /= len;
    uz /= len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = ring[k * 2], z = ring[k * 2 + 1];
      const u = x * ux + z * uz, v = -x * uz + z * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area >= best.area) continue;
    const u = (minU + maxU) / 2, v = (minV + maxV) / 2;
    best = { area, cx: u * ux - v * uz, cz: u * uz + v * ux, ux, uz, length: maxU - minU, width: maxV - minV };
  }
  if (best.width > best.length) best = { ...best, ux: -best.uz, uz: best.ux, length: best.width, width: best.length };
  const { cx, cz, ux, uz, length, width } = best;
  return { cx, cz, ux, uz, length, width };
}

function ringArea(ring: number[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return a / 2;
}

/** Stable pseudo-random in [0, 1) from a position, so the city comes out the same on every load. */
export function hash(x: number, z: number, salt = 0): number {
  const s = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
