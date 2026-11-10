import * as THREE from 'three';
import { rand } from '../buildings';
import type { Building, SignStyle } from '../cityData';
import { bays, doorBay, facadeStyle } from '../facadeLayout';
import { inRing } from '../polyline';
import type { Door } from '../signs';
import { DAY, lamp, type Lamp } from './lighting';
import { CYL, FRONT, Items, Mesher, at } from './mesher';
import { REPEAT, type FloorKind, type WallKind } from './surfaces';

export type Place = Exclude<SignStyle, 'street'>;

/** m: [along the street, depth], shrunk to fit the building. */
const SIZE: Record<Place, [number, number]> = {
  cafe: [9, 11], restaurant: [10, 12], fastfood: [8, 9], bakery: [6, 8], jewelry: [6, 8], fashion: [9, 12], food: [12, 14],
  shop: [7, 10], pharmacy: [7, 9], bank: [8, 10], service: [6, 8], hotel: [10, 12], culture: [11, 14], club: [11, 14], public: [10, 12],
  plate: [6, 7],
};

export const ENTRY_X = 1.05, ENTRY_Z = 2.4; // m, entrance kept clear of furniture
export const SPAWN_Z = 1.5; // m: where enter() puts the player

/** Always past the spawned player (radius 0.35). */
export const entryZ = (depth: number) => Math.max(SPAWN_Z + 0.4, Math.min(ENTRY_Z, depth - 2.2));

export const inEntry = (k: Kit, x: number, z: number, sx: number, sz: number) => Math.abs(x) - sx / 2 < ENTRY_X && z - sz / 2 < entryZ(k.fit.depth);

export type Wall = 'back' | 'left' | 'right';

export interface Fit {
  x0: number;
  x1: number;
  depth: number;
  height: number;
}

export interface Board {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  wall: Wall;
  glow: boolean;
  draw: (g: CanvasRenderingContext2D) => void;
}

export interface Kit {
  fit: Fit;
  solid: Mesher;
  shiny: Mesher;
  glow: Mesher;
  glass: Mesher;
  beam: Mesher;
  floor: Mesher;
  wall: Mesher;
  back: Mesher;
  ceiling: Mesher;
  items: Items;
  blocks: [number, number, number, number][];
  people: [number, number, number, number, boolean][];
  lamps: Lamp[];
  boards: Board[];
  r: () => number;
}

export function toLocal(d: Door, x: number, z: number): [number, number] {
  const dx = x - d.x, dz = z - d.z;
  return [dx * d.ux + dz * d.uz, -(dx * d.nx + dz * d.nz)];
}

export function toWorld(d: Door, x: number, z: number): [number, number] {
  return [d.x + d.ux * x - d.nx * z, d.z + d.uz * x - d.nz * z];
}

function segmentHitsRect(ax: number, az: number, bx: number, bz: number, x0: number, x1: number, z0: number, z1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function fitRoom(door: Door, neighbours: Building[]): Fit | null {
  if (door.style === 'street') return null;
  const b = door.building;
  const height = Math.min(door.groundH - 0.1, b.h - 0.5, 4.3);
  if (height < 2.9) return null;
  const walls: number[][] = [];
  const addWalls = (ring: number[], skip = -1) => {
    const l: number[] = [];
    for (let i = 0; i < ring.length; i += 2) l.push(...toLocal(door, ring[i], ring[i + 1]));
    for (let i = 0; i < l.length; i += 2) if (i / 2 !== skip) walls.push([l[i], l[i + 1], l[(i + 2) % l.length], l[(i + 3) % l.length]]);
  };
  b.rings.forEach((ring, r) => addWalls(ring, r === 0 ? door.edge : -1));
  for (const n of neighbours) addWalls(n.rings[0]);
  const outer = b.rings[0];
  const [wantW, wantD] = SIZE[door.style];
  const fits = (left: number, right: number, depth: number) => {
    const m = 0.08;
    if (walls.some(([ax, az, bx, bz]) => segmentHitsRect(ax, az, bx, bz, -left - m, right + m, 0.04, depth + m))) return false;
    return inRing(outer, ...toWorld(door, (right - left) / 2, depth / 2));
  };
  const maxLeft = door.along - 0.25, maxRight = door.length - door.along - 0.25;
  const sizes = [0.9, 1.3, 1.8, 2.4, 3, 3.6, 4.5, 5.5, 6.5, 8];
  let best: Fit | null = null, bestScore = 0;
  for (const l of sizes) {
    for (const r of sizes) {
      const left = Math.min(l, maxLeft), right = Math.min(r, maxRight);
      if (left < 0.9 || right < 0.9 || left + right < 3.4 || left + right > wantW + 0.01) continue;
      if ((left < l && l > sizes[0]) || (right < r && r > sizes[0])) {
        // Clipped by the wall's end: only try the clipped size once.
        if (sizes[sizes.indexOf(l) - 1] >= maxLeft || sizes[sizes.indexOf(r) - 1] >= maxRight) continue;
      }
      for (let depth = wantD; depth >= 4; depth -= 0.5) {
        const area = (left + right) * depth * (depth >= 5 ? 1 : 0.6);
        if (area <= bestScore) break;
        if (fits(left, right, depth)) {
          best = { x0: -left, x1: right, depth, height };
          bestScore = area;
          break;
        }
      }
    }
  }
  return best;
}

interface ShellLook {
  floor: FloorKind;
  carpet?: string;
  finish: WallKind;
  back?: WallKind;
  wall: number;
  backWall?: number;
  wainscot?: number;
  ceiling: number;
  beams?: number;
  cornice?: boolean;
  ambient: [number, number]; // colour, irradiance
}

const SHELLS: Record<Place, ShellLook> = {
  cafe: { floor: 'planksDark', finish: 'plaster', back: 'brick', wall: 0xd6bf92, backWall: 0xffffff, wainscot: 0x3d2716, ceiling: 0xd8c7a4, beams: 0x4a3020, ambient: [0xffc890, 0.75] },
  restaurant: { floor: 'planks', finish: 'stripes', back: 'brick', wall: 0xe8dcc6, backWall: 0xf2e6dc, wainscot: 0x5d3f27, ceiling: 0xf3eee4, cornice: true, ambient: [0xffd8b0, 0.9] },
  fastfood: { floor: 'checker', finish: 'subway', wall: 0xffffff, wainscot: 0xb5372a, ceiling: 0xf4f4f2, ambient: [0xfff2e6, 1.25] },
  bakery: { floor: 'checker', finish: 'plaster', back: 'subway', wall: 0xeee1c6, backWall: 0xf6efe0, wainscot: 0xf2f0ea, ceiling: 0xf2ece0, ambient: [0xffe6c8, 1.1] },
  jewelry: { floor: 'carpet', carpet: '#5a2e3c', finish: 'stripes', wall: 0xa8949e, wainscot: 0x2a2427, ceiling: 0xd8cfc8, cornice: true, ambient: [0xffe4c8, 1.3] },
  fashion: { floor: 'planks', finish: 'plaster', back: 'whiteBrick', wall: 0xf3f1ec, backWall: 0xffffff, ceiling: 0xf5f5f3, ambient: [0xfff4ea, 1.05] },
  food: { floor: 'tiles', finish: 'plaster', wall: 0xf0efeb, ceiling: 0xf4f4f2, ambient: [0xf2f5ff, 1.3] },
  shop: { floor: 'planks', finish: 'plaster', back: 'whiteBrick', wall: 0xece6dc, backWall: 0xf4efe6, ceiling: 0xf2f0ec, ambient: [0xfff2e4, 1.05] },
  pharmacy: { floor: 'tiles', finish: 'plaster', wall: 0xf4f6f4, ceiling: 0xf6f7f6, ambient: [0xf2f6ff, 1.3] },
  bank: { floor: 'marble', finish: 'plaster', wall: 0xe8e6e0, wainscot: 0x2f3b4e, ceiling: 0xf2f2f0, cornice: true, ambient: [0xf6f4f0, 1.05] },
  service: { floor: 'checker', finish: 'plaster', wall: 0xf1ece6, ceiling: 0xf4f2ef, ambient: [0xfaf6f0, 1.05] },
  hotel: { floor: 'marble', finish: 'stripes', wall: 0xe7dcc6, wainscot: 0x4a2f1d, ceiling: 0xf0e9dc, cornice: true, ambient: [0xffdcb4, 0.85] },
  culture: { floor: 'concrete', finish: 'plaster', wall: 0xf4f3f0, ceiling: 0xf6f6f4, ambient: [0xf8f6f2, 1.0] },
  club: { floor: 'carpet', carpet: '#17151c', finish: 'brick', wall: 0x3a3044, ceiling: 0x0c0b10, ambient: [0x6a50a0, 0.3] },
  public: { floor: 'planks', finish: 'plaster', wall: 0xe9e4d8, wainscot: 0x6b5236, ceiling: 0xf0ede6, cornice: true, ambient: [0xffe4c4, 0.9] },
  plate: { floor: 'carpet', carpet: '#4a5260', finish: 'plaster', wall: 0xf1f1ef, ceiling: 0xf6f6f5, ambient: [0xf4f6fa, 1.1] },
};

export function shell(k: Kit, door: Door): ShellLook {
  const { x0, x1, depth: d, height: h } = k.fit;
  const look = SHELLS[door.style as Place];
  const cx = (x0 + x1) / 2, hw = (x1 - x0) / 2, cz = (FRONT + d) / 2, hd = (d - FRONT) / 2;
  const rep = REPEAT[look.finish];
  k.floor.quad([cx, 0.012, cz], [hw, 0, 0], [0, 0, hd], [0, 1, 0], 0xffffff, 2);
  k.ceiling.quad([cx, h, cz], [hw, 0, 0], [0, 0, hd], [0, -1, 0], look.ceiling, REPEAT.plaster);
  (look.back ? k.back : k.wall).quad([cx, h / 2, d], [hw, 0, 0], [0, h / 2, 0], [0, 0, -1], look.backWall ?? look.wall, look.back ? REPEAT[look.back] : rep);
  k.wall.quad([x0, h / 2, cz], [0, h / 2, 0], [0, 0, hd], [1, 0, 0], look.wall, rep);
  k.wall.quad([x1, h / 2, cz], [0, h / 2, 0], [0, 0, hd], [-1, 0, 0], look.wall, rep);
  const low = look.wainscot ?? 0x5a5550;
  const lh = look.wainscot ? 1.05 : 0.09;
  const band = (t: number, y: number, bh: number, colour = low, front = false) => {
    k.solid.box(cx, d - t / 2, y, x1 - x0, t, bh, colour);
    k.solid.box(x0 + t / 2, cz, y, t, d - FRONT, bh, colour);
    k.solid.box(x1 - t / 2, cz, y, t, d - FRONT, bh, colour);
    if (front) k.solid.box(cx, FRONT + t / 2, y, x1 - x0, t, bh, colour);
  };
  band(0.03, 0, lh);
  if (look.wainscot) {
    band(0.06, lh, 0.05);
    const m = 0.035, ph = lh - 0.3, col = new THREE.Color(low).multiplyScalar(0.75).getHex();
    const panels = (a0: number, a1: number, put: (s: number, w: number) => void) => {
      const n = Math.max(1, Math.round((a1 - a0) / 0.9)), w = (a1 - a0) / n;
      for (let i = 0; i < n; i++) put(a0 + (i + 0.5) * w, w - 0.16);
    };
    panels(x0, x1, (s, w) => {
      for (const y of [0.15, 0.15 + ph]) k.solid.box(s, d - 0.03 - m / 2, y, w, m, m, col);
      for (const e of [-1, 1]) k.solid.box(s + e * (w / 2 - m / 2), d - 0.03 - m / 2, 0.15, m, m, ph, col);
    });
    for (const [x, sgn] of [[x0, 1], [x1, -1]] as const) {
      panels(FRONT, d, (s, w) => {
        for (const y of [0.15, 0.15 + ph]) k.solid.box(x + sgn * (0.03 + m / 2), s, y, m, w, m, col);
        for (const e of [-1, 1]) k.solid.box(x + sgn * (0.03 + m / 2), s + e * (w / 2 - m / 2), 0.15, m, m, ph, col);
      });
    }
  }
  if (look.cornice) {
    band(0.07, h - 0.09, 0.09, look.ceiling, true);
    band(0.035, h - 0.15, 0.06, look.ceiling, true);
  }
  if (look.beams) {
    for (let z = FRONT + 0.7; z < d - 0.3; z += 1.1) k.solid.box(cx, z, h - 0.2, x1 - x0, 0.16, 0.2, look.beams);
  }

  // Same window bays as the building shader draws.
  const b = door.building;
  const seed = rand(b, 5);
  const style = facadeStyle(seed);
  const { count, width } = bays(door.length, style.bayTarget);
  const shop = !!b.sh && (b.sf ?? []).includes(door.edge);
  const shopDoor = doorBay(seed, count);
  const holes: { x0: number; x1: number; y0: number; y1: number }[] = [{ x0: -0.6, x1: 0.6, y0: 0, y1: 2.42 }];
  for (let i = 0; i < count; i++) {
    const c = (i + 0.5) * width - door.along;
    const [half, y0, y1] = shop
      ? i === shopDoor ? [0.55, 0, Math.min(2.5, door.groundH - 1.1)] : [width * 0.44, 0.5, door.groundH - 1.1]
      : [(style.winW * width) / 2, 0.9, Math.min(h - 0.5, 0.9 + style.winH * style.floorH)];
    const lo = Math.max(c - half, x0 + 0.2), hi = Math.min(c + half, x1 - 0.2);
    if (hi - lo > 0.4 && y1 - y0 > 0.5) holes.push({ x0: lo, x1: hi, y0, y1: Math.min(y1, h - 0.3) });
  }
  const xs = [...new Set([x0, x1, ...holes.flatMap((o) => [o.x0, o.x1])])].filter((x) => x >= x0 && x <= x1).sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], c = xs[i + 1], mid = (a + c) / 2;
    const spans = holes.filter((o) => o.x0 <= mid && mid <= o.x1).map((o) => [o.y0, o.y1]).sort((p, q) => p[0] - q[0]);
    let y = 0;
    const wall = (ya: number, yb: number) => {
      if (yb - ya > 0.005) k.wall.quad([mid, (ya + yb) / 2, FRONT], [(c - a) / 2, 0, 0], [0, (yb - ya) / 2, 0], [0, 0, 1], look.wall, rep);
    };
    for (const [ya, yb] of spans) {
      wall(y, ya);
      y = Math.max(y, yb);
    }
    wall(y, h);
  }
  for (const o of holes) {
    const overlaps = holes.some((q) => q !== o && q.x0 < o.x1 && o.x0 < q.x1);
    const w = o.x1 - o.x0, ym = (o.y0 + o.y1) / 2, hh = (o.y1 - o.y0) / 2;
    if (!overlaps) {
      k.solid.quad([o.x0, ym, FRONT / 2 - 0.03], [0, hh, 0], [0, 0, FRONT / 2 + 0.03], [1, 0, 0], look.wall);
      k.solid.quad([o.x1, ym, FRONT / 2 - 0.03], [0, hh, 0], [0, 0, FRONT / 2 + 0.03], [-1, 0, 0], look.wall);
      k.solid.quad([(o.x0 + o.x1) / 2, o.y1, FRONT / 2 - 0.03], [w / 2, 0, 0], [0, 0, FRONT / 2 + 0.03], [0, -1, 0], look.wall);
    }
    for (const x of [o.x0, o.x1]) k.solid.box(x, FRONT + 0.02, o.y0, 0.07, 0.04, o.y1 - o.y0, 0x232426);
    k.solid.box((o.x0 + o.x1) / 2, FRONT + 0.02, o.y1 - 0.035, w + 0.07, 0.04, 0.07, 0x232426);
    if (o.y0 > 0 && (o.x0 > 0.6 || o.x1 < -0.6)) {
      k.solid.box((o.x0 + o.x1) / 2, FRONT / 2 + 0.06, o.y0 - 0.05, w + 0.12, FRONT + 0.22, 0.05, 0xb9b2a5);
      k.glass.quad([(o.x0 + o.x1) / 2, ym, 0.0], [w / 2, 0, 0], [0, hh, 0], [0, 0, 1], 0xffffff);
      const rh = Math.min(o.y0 - 0.2, 0.6), rw = Math.min(w * 0.8, 1.6);
      if (rh > 0.25 && w > 0.7) {
        const rx = (o.x0 + o.x1) / 2;
        for (let s = -rw / 2 + 0.025; s < rw / 2; s += 0.055) k.solid.box(rx + s, FRONT + 0.07, 0.12, 0.035, 0.07, rh, 0xe6e4df);
        k.shiny.geometry(CYL, at(rx + rw / 2 + 0.05, 0.17, FRONT + 0.07, 0.018, 0.1, 0.018), 0xb8b8b8);
      }
    }
    lamp(k, (o.x0 + o.x1) / 2, ym + 0.3, -0.9, (o.x1 - o.x0) * (o.y1 - o.y0) * 2.4, DAY, 9);
  }
  k.shiny.box(0, -0.04, 1.03, 0.75, 0.04, 0.04, 0x9a9da0);
  k.solid.box(0, FRONT + 0.45, 0, 1.3, 0.7, 0.022, 0x2a2624);
  return look;
}
