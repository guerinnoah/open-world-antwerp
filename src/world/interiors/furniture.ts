import * as THREE from 'three';
import { canvasTexture, drawLabel, fitFont, sans } from '../../core/canvasText';
import { pick } from '../../core/util';
import type { Door } from '../signs';
import { CHAIR } from './chairGeometry';
import { COOL, WARM, lamp, lit } from './lighting';
import { BALL, CUBE, CYL, FRONT, Mesher, SHADE, at } from './mesher';
import { inEntry, type Board, type Fit, type Kit, type Wall } from './room';

export function nameBoard(door: Door, fit: Fit): Board {
  const w = Math.min(fit.x1 - fit.x0 - 1, 3.6), h = (w * 160) / 1024;
  return {
    x: (fit.x0 + fit.x1) / 2, y: fit.height - 0.45 - h / 2, z: fit.depth - 0.03, w, h, wall: 'back', glow: true,
    draw: (g) => drawLabel(g, door.name, door.look.bg, door.look.fg, door.look.font, 0.6),
  };
}

export function board(b: Board, world: THREE.Matrix4, light: Record<string, THREE.IUniform>) {
  const map = canvasTexture(1024, Math.round((1024 * b.h) / b.w), b.draw);
  const material = b.glow ? new THREE.MeshBasicMaterial({ map }) : lit(new THREE.MeshStandardMaterial({ map, roughness: 0.9 }), light);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), material);
  mesh.matrix.copy(world).multiply(at(b.x, b.y, b.z, 1, 1, 1, wallYaw(b.wall)));
  return mesh;
}

export function label(k: Kit, x: number, y: number, z: number, w: number, h: number, text: string, bg: string, fg: string) {
  k.boards.push({
    x, y, z, w, h, wall: 'back', glow: false,
    draw: (g) => drawLabel(g, text, bg, fg, sans(700), 0.55, 0.9, 0.53),
  });
}

export const AISLES = ['Groenten & fruit', 'Brood', 'Zuivel', 'Dranken', 'Snoep & koek', 'Diepvries', 'Pasta & rijst', 'Huishouden'];

/** A chalkboard, or lit in the shop's `glow` colours. */
export function menu(k: Kit, x: number, y: number, z: number, w: number, h: number, wall: Wall, title: string, items: [string, string][], glow?: Door['look']) {
  if (!glow) {
    const fx = wall === 'back' ? 0 : wall === 'left' ? 1 : -1;
    k.solid.box(x - fx * 0.012, z, y - h / 2 - 0.04, wall === 'back' ? w + 0.08 : 0.025, wall === 'back' ? 0.025 : w + 0.08, h + 0.08, 0x4a3020);
    x += fx * 0.004;
  }
  k.boards.push({
    x, y, z: wall === 'back' ? z - 0.016 : z, w, h, wall, glow: !!glow,
    draw: (g) => {
      const { width: W, height: H } = g.canvas;
      g.fillStyle = glow ? '#141414' : '#1f2622';
      g.fillRect(0, 0, W, H);
      const font = glow ? sans(700) : "600 {s}px 'Chalkboard SE', 'Comic Sans MS', 'Segoe Print', cursive";
      if (!glow) {
        g.globalAlpha = 0.06;
        g.fillStyle = '#fff';
        for (let i = 0; i < 60; i++) g.fillRect(k.r() * W, k.r() * H, 40 + k.r() * 160, 6 + k.r() * 20);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = glow.bg;
        g.fillRect(0, 0, W, H * 0.2);
      }
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = glow ? glow.fg : '#f4f1e6';
      fitFont(g, font, title, W * 0.8, Math.round(H * 0.13));
      g.fillText(title, W / 2, H * 0.1);
      const cols = W / H > 2.5 ? 2 : 1, rows = Math.ceil(items.length / cols), cw = W / cols;
      const row = (H * 0.76) / rows, size = Math.round(Math.min(row * 0.62, cw * 0.075));
      items.forEach(([name, price], i) => {
        const x = cw * Math.floor(i / rows), y = H * 0.24 + row * ((i % rows) + 0.5);
        g.font = font.replace('{s}', String(size));
        g.textAlign = 'left';
        g.fillStyle = glow ? '#ffffff' : '#ece8dc';
        g.fillText(name, x + cw * 0.07, y);
        g.textAlign = 'right';
        g.fillStyle = glow ? glow.bg : '#f2d27a';
        g.fillText(price, x + cw * 0.93, y);
      });
    },
  });
}

const PAINT = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xe67e22, 0x8e44ad, 0xecf0f1, 0x34495e, 0xd35400, 0x16a085, 0xf5b7b1, 0x5d6d7e];
export const CLOTHES = [0x1f2633, 0x2c2c2c, 0x8a7f6e, 0xd8d2c4, 0x5b6b7a, 0x7a2e2e, 0x34513c, 0xb08d57, 0xe9e4da, 0x3c3f58];
export const BOOKS = [0x7a2e2e, 0x2e4a7a, 0x2f5d3a, 0x8a6d3b, 0x3b3b3b, 0xb59a6a, 0x5a3a5e, 0x9c4f2e];

export function fits(k: Kit, x: number, z: number, sx: number, sz: number, margin: number): boolean {
  const { x0, x1, depth } = k.fit;
  if (x - sx / 2 < x0 + margin || x + sx / 2 > x1 - margin || z - sz / 2 < FRONT + margin || z + sz / 2 > depth - margin) return false;
  if (inEntry(k, x, z, sx, sz)) return false;
  return !k.blocks.some(([bx, bz, bsx, bsz]) => Math.abs(bx - x) < (bsx + sx) / 2 + 0.3 && Math.abs(bz - z) < (bsz + sz) / 2 + 0.3);
}

export type Goods = 'grocery' | 'general' | 'pharmacy' | 'books';

export const PACKS: Record<Exclude<Goods, 'books'>, number[]> = {
  grocery: [0xf2efe6, 0xe8dcc0, 0xc0392b, 0x1f5fa8, 0xf1c40f, 0x2e7d32, 0x6d4c41, 0x212121, 0xe67e22, 0x8e244d, 0x9e9e9e, 0xffffff, 0x0d47a1],
  general: [0xece6da, 0x8a7f6e, 0x34495e, 0xb08d57, 0x7a2e2e, 0x5b6b7a, 0xd8d2c4, 0x2f5d3a, 0x1f1f1f],
  pharmacy: [0xf6f6f4, 0xf6f6f4, 0xe8f0ea, 0x2e8b57, 0x3b6fb5, 0xd9e4f2, 0xc0392b],
};
export function shelving(k: Kit, x: number, z: number, length: number, alongZ: boolean, faces: number, levels: number[], goods: Goods, density: number, frame = 0xd9d9d6) {
  const depth = faces === 0 ? 0.9 : 0.45;
  const [sx, sz] = alongZ ? [depth, length] : [length, depth];
  const top = levels[levels.length - 1] + 0.42;
  block(k, x, z, 0, sx, sz, 0.1, 0x3a3a3a);
  k.solid.box(x + (alongZ && faces ? -faces * (depth / 2 - 0.02) : 0), z + (!alongZ && faces ? -faces * (depth / 2 - 0.02) : 0), 0.1,
    alongZ ? 0.04 : length, alongZ ? length : 0.04, top - 0.1, frame);
  for (const e of [-1, 1]) {
    k.solid.box(x + (alongZ ? 0 : (e * (length - 0.04)) / 2), z + (alongZ ? (e * (length - 0.04)) / 2 : 0), 0, alongZ ? depth : 0.04, alongZ ? 0.04 : depth, top, frame);
  }
  const half = faces === 0 ? depth / 2 : depth;
  for (const side of faces === 0 ? [-1, 1] : [faces]) {
    const off = faces === 0 ? side * depth * 0.25 : 0;
    const put = (along: number, y: number, w: number, d: number, h: number, colour: number, round: boolean) => {
      const o = off + side * (half / 2 - d / 2 - 0.03);
      const [px, pz] = alongZ ? [x + o, z + along] : [x + along, z + o];
      if (round) k.items.round(px, pz, y, w / 2, h, colour);
      else k.items.box(px, pz, y, alongZ ? d : w, alongZ ? w : d, h, colour);
    };
    for (const y of levels) {
      k.solid.box(x + (alongZ ? off : 0), z + (alongZ ? 0 : off), y - 0.025, alongZ ? half : length - 0.06, alongZ ? length - 0.06 : half, 0.025, frame);
      if (goods !== 'books') {
        const edge = off + side * (half / 2 + 0.006);
        k.solid.box(x + (alongZ ? edge : 0), z + (alongZ ? 0 : edge), y - 0.05, alongZ ? 0.012 : length - 0.06, alongZ ? length - 0.06 : 0.012, 0.045, goods === 'pharmacy' ? 0xe4ece6 : 0xf4f1e2);
        for (let s = -length / 2 + 0.2; s < length / 2 - 0.2; s += 0.35) {
          if (k.r() > 0.12) continue;
          k.solid.box(x + (alongZ ? edge + side * 0.006 : s), z + (alongZ ? s : edge + side * 0.006), y - 0.06, alongZ ? 0.006 : 0.09, alongZ ? 0.09 : 0.006, 0.065, pick([0xf1c40f, 0xe67e22, 0xc0392b], k.r));
        }
      }
      const room = Math.min(0.36, (levels[1] ?? y + 0.45) - levels[0] - 0.06);
      for (let s = -length / 2 + 0.06; s < length / 2 - 0.1;) {
        if (goods === 'books') {
          const w = 0.025 + k.r() * 0.04, h = room * (0.62 + k.r() * 0.35);
          if (k.r() < density) put(s + w / 2, y, w, 0.2 + k.r() * 0.05, h, pick(BOOKS, k.r), false);
          s += w + 0.004;
          continue;
        }
        const shape = goods === 'pharmacy' ? 0 : k.r();
        const round = shape > 0.55;
        const w = round ? 0.06 + k.r() * 0.03 : 0.05 + k.r() * 0.1;
        const h = Math.min(room, round ? (shape > 0.8 ? 0.11 : 0.2 + k.r() * 0.1) : 0.08 + k.r() * 0.2);
        const d = round ? w : Math.min(half - 0.08, 0.06 + k.r() * 0.14);
        const colour = pick(PACKS[goods], k.r);
        const n = 2 + Math.floor(k.r() * 5);
        const gap = k.r() > density;
        for (let i = 0; i < n && s < length / 2 - 0.1; i++) {
          if (!gap) put(s + w / 2, y, w, d, h, colour, round);
          s += w + 0.008;
        }
        s += 0.02;
      }
    }
  }
}

export function person(k: Kit, x: number, z: number, fx: number, fz: number) {
  const { x0, x1, depth } = k.fit;
  if (x < x0 + 0.35 || x > x1 - 0.35 || z < FRONT + 0.35 || z > depth - 0.3 || inEntry(k, x, z, 0.5, 0.5)) return;
  if (k.blocks.some(([bx, bz, sx, sz]) => Math.abs(bx - x) < sx / 2 + 0.22 && Math.abs(bz - z) < sz / 2 + 0.22)) return;
  if (k.people.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.6)) return;
  k.people.push([x, z, fx, fz, false]);
}

export function sit(k: Kit, x: number, z: number, fx: number, fz: number, odds: number) {
  if (k.r() < odds) k.people.push([x, z, fx, fz, true]);
}

export function block(k: Kit, x: number, z: number, y0: number, sx: number, sz: number, h: number, colour: number) {
  k.solid.box(x, z, y0, sx, sz, h, colour);
  k.blocks.push([x, z, sx, sz]);
}

export function pendant(k: Kit, x: number, z: number, power = 4) {
  const h = k.fit.height;
  k.solid.box(x, z, h - 0.75, 0.012, 0.012, 0.75, 0x1a1a1a);
  k.solid.geometry(SHADE, at(x, h - 0.82, z, 1, 1, 1), 0x1e2a24);
  k.glow.geometry(BALL, at(x, h - 0.88, z, 0.08, 0.08, 0.08), 0xffd9a0);
  lamp(k, x, h - 0.9, z, power, WARM, 6, true);
}

/** Lamps for flush ceiling fittings sit just above the ceiling, so they never light it. */
export function ceilingLight(k: Kit, x: number, z: number, sx: number, sz: number, colour = COOL) {
  k.glow.box(x, z, k.fit.height - 0.03, sx, sz, 0.03, 0xf4f2ec, true);
  lamp(k, x, k.fit.height + 0.05, z, 2 + 6 * Math.sqrt(sx * sz), colour, 8);
}

export function spot(k: Kit, x: number, z: number, r: number, colour: number, power = 2.2) {
  k.glow.geometry(CYL, at(x, k.fit.height - 0.02, z, r, 0.02, r), colour);
  lamp(k, x, k.fit.height + 0.05, z, power, colour, 5);
}

export function chair(k: Kit, x: number, z: number, faceX: number, faceZ: number, colour: number) {
  k.solid.box(x, z, CHAIR.seat - 0.04, 0.42, 0.42, 0.04, colour);
  k.solid.box(x - faceX * 0.19, z - faceZ * 0.19, CHAIR.seat, faceX ? 0.04 : 0.42, faceZ ? 0.04 : 0.42, 0.45, colour);
  for (const dx of [-0.17, 0.17]) for (const dz of [-0.17, 0.17]) k.solid.box(x + dx, z + dz, 0, 0.03, 0.03, 0.44, 0x2a2a2a);
}

export function table(k: Kit, x: number, z: number, round: boolean, top: number, chairs: number) {
  if (round) {
    k.solid.geometry(CYL, at(x, 0.75, z, 0.36, 0.035, 0.36), top);
    k.solid.geometry(CYL, at(x, 0.37, z, 0.035, 0.74, 0.035), 0x222222);
    k.solid.geometry(CYL, at(x, 0.015, z, 0.22, 0.03, 0.22), 0x222222);
  } else {
    k.solid.box(x, z, 0.72, 0.8, 0.8, 0.04, top);
    for (const dx of [-0.35, 0.35]) for (const dz of [-0.35, 0.35]) k.solid.box(x + dx, z + dz, 0, 0.04, 0.04, 0.72, 0x2a2a2a);
  }
  chair(k, x - 0.62, z, 1, 0, chairs);
  chair(k, x + 0.62, z, -1, 0, chairs);
  k.blocks.push([x, z, 1.7, 0.8]); // m: out to the chair backs
}

export function seatTable(k: Kit, x: number, z: number, odds: number) {
  sit(k, x - 0.62, z, 1, 0, odds);
  sit(k, x + 0.62, z, -1, 0, odds);
}

export function bottles(k: Kit, x0: number, x1: number, y: number, z: number) {
  for (let x = x0; x < x1; x += 0.09 + k.r() * 0.05) {
    const hgt = 0.22 + k.r() * 0.12;
    k.shiny.geometry(CYL, at(x, y + hgt / 2, z, 0.035, hgt, 0.035), pick([0x2f5d3a, 0x5a3a1e, 0xc9d6d0, 0x7a2e2e, 0x8a6d3b, 0x1f2e2a], k.r));
  }
}

export function plant(k: Kit, x: number, z: number, big = true) {
  const s = big ? 1 : 0.6;
  k.solid.geometry(CYL, at(x, 0.25 * s, z, 0.22 * s, 0.5 * s, 0.22 * s), 0x8a8580);
  k.solid.geometry(BALL, at(x, 0.95 * s, z, 0.42 * s, 0.6 * s, 0.42 * s), 0x2f5a2c);
  k.blocks.push([x, z, 0.5 * s, 0.5 * s]);
}

export function counter(k: Kit, x: number, z: number, length: number, front: number, top: number, h: number, depth: number) {
  block(k, x, z, 0, length, depth, h - 0.04, front);
  k.shiny.box(x, z - 0.03, h - 0.04, length + 0.06, depth + 0.1, 0.04, top);
}

export function till(k: Kit, x: number, z: number, y: number) {
  k.solid.box(x, z, y, 0.32, 0.22, 0.08, 0x2a2a2a);
  k.solid.box(x, z + 0.05, y + 0.08, 0.04, 0.04, 0.18, 0x2a2a2a);
  k.glow.box(x, z + 0.04, y + 0.22, 0.3, 0.02, 0.2, 0x7fa7c9);
}

export const PICTURE_FROM = 3.5; // m from the front: nearer, a side-wall picture hangs beside the camera and fills the view

export function picture(k: Kit, x: number, z: number, y: number, w: number, h: number, wall: Wall, frame: number) {
  const along = wall === 'back';
  const nx = wall === 'left' ? 1 : wall === 'right' ? -1 : 0, nz = along ? -1 : 0;
  k.solid.box(x, z, y - h / 2, along ? w + 0.1 : 0.04, along ? 0.04 : w + 0.1, h + 0.1, frame);
  k.solid.quad([x + nx * 0.025, y, z + nz * 0.025], along ? [w / 2, 0, 0] : [0, 0, w / 2], [0, h / 2, 0], [nx, 0, nz], pick([0xe9e1d0, 0x2b2b2b, 0x9c3b2b, 0x2e4a7a, 0xd9b44a], k.r));
  for (let i = 0; i < 3; i++) {
    const hw = w * (0.08 + k.r() * 0.18), hh = h * (0.08 + k.r() * 0.18);
    const off = 0.004 * (i + 1);
    k.solid.quad([x + nx * (0.025 + off) + (along ? (k.r() - 0.5) * (w - 2 * hw) : 0), y + (k.r() - 0.5) * (h - 2 * hh), z + nz * (0.025 + off) + (along ? 0 : (k.r() - 0.5) * (w - 2 * hw))],
      along ? [hw, 0, 0] : [0, 0, hw], [0, hh, 0], [nx, 0, nz], pick(PAINT, k.r));
  }
}

/** Room coordinates of a point `out` m in front of a wall, `s` m along it. */
const onWall = (k: Kit, wall: Wall, s: number, out: number): [number, number] =>
  wall === 'back' ? [s, k.fit.depth - out] : wall === 'left' ? [k.fit.x0 + out, s] : [k.fit.x1 - out, s];

export function wallBox(k: Kit, m: Mesher, wall: Wall, s: number, out: number, y: number, w: number, t: number, h: number, colour: number) {
  const [x, z] = onWall(k, wall, s, out);
  m.box(x, z, y, wall === 'back' ? w : t, wall === 'back' ? t : w, h, colour);
}

const wallYaw = (wall: Wall) => (wall === 'back' ? Math.PI : wall === 'left' ? Math.PI / 2 : -Math.PI / 2);

export function clock(k: Kit, wall: Wall, s: number, y: number) {
  const ry = wallYaw(wall);
  const [x, z] = onWall(k, wall, s, 0.03), [fx, fz] = onWall(k, wall, s, 0.052);
  k.solid.geometry(CYL, at(x, y, z, 0.17, 0.04, 0.17, ry, Math.PI / 2), 0x1e1e1e);
  k.solid.geometry(CYL, at(fx, y, fz, 0.15, 0.004, 0.15, ry, Math.PI / 2), 0xf4f2ec);
  const t = k.r() * 12;
  for (const [len, a, w] of [[0.085, (t / 12) * Math.PI * 2, 0.014], [0.125, (t % 1) * Math.PI * 2, 0.008]]) {
    const [hx, hz] = onWall(k, wall, s, 0.058);
    k.solid.geometry(CUBE, at(hx, y, hz, 1, 1, 1, ry, 0, -a).multiply(at(0, len / 2 - 0.015, 0, w, len, 0.004)), 0x161616);
  }
}

export function staffDoor(k: Kit, wall: Wall, s: number, colour: number) {
  wallBox(k, k.solid, wall, s, 0.03, 0, 1.04, 0.06, 2.17, 0xe8e4dc);
  wallBox(k, k.solid, wall, s, 0.045, 0, 0.9, 0.04, 2.1, colour);
  wallBox(k, k.shiny, wall, s + (wall === 'right' ? -0.34 : 0.34), 0.08, 1.0, 0.13, 0.03, 0.025, 0xb8b8b8);
  wallBox(k, k.solid, wall, s, 0.068, 1.55, 0.24, 0.006, 0.08, 0xf4f4f2);
  wallBox(k, k.solid, wall, s, 0.072, 1.575, 0.16, 0.004, 0.03, 0x2a2a2a);
}

export function beer(k: Kit, x: number, z: number, y: number) {
  k.solid.box(x, z, y, 0.1, 0.1, 0.004, pick([0xf2efe6, 0xc0392b, 0x1f5fa8], k.r));
  if (k.r() < 0.6) {
    k.solid.geometry(CYL, at(x, y + 0.008, z, 0.028, 0.008, 0.028), 0xd8dde0);
    k.shiny.geometry(CYL, at(x, y + 0.04, z, 0.006, 0.06, 0.006), 0xd8dde0);
    k.solid.geometry(BALL, at(x, y + 0.11, z, 0.043, 0.045, 0.043), pick([0x9a4f1c, 0xb8761f, 0x5a2a12], k.r));
    k.solid.geometry(CYL, at(x, y + 0.156, z, 0.036, 0.014, 0.036), 0xf6f0e0);
  } else {
    k.solid.geometry(CYL, at(x, y + 0.075, z, 0.032, 0.15, 0.032), pick([0xd9a034, 0xe0b048, 0x3a1c0e], k.r));
    k.solid.geometry(CYL, at(x, y + 0.16, z, 0.034, 0.02, 0.034), 0xf6f0e0);
  }
}

export function taps(k: Kit, x: number, z: number, y: number, n: number) {
  const w = 0.16 * n + 0.1;
  k.shiny.box(x, z - 0.06, y, w + 0.06, 0.16, 0.015, 0x6a6d70);
  for (const e of [-1, 1]) k.shiny.box(x + (e * w) / 2, z + 0.04, y, 0.05, 0.05, 0.44, 0xc8ccd0);
  k.shiny.box(x, z + 0.04, y + 0.36, w + 0.05, 0.08, 0.08, 0xc8ccd0);
  for (let i = 0; i < n; i++) {
    const tx = x - w / 2 + 0.13 + i * 0.16;
    k.shiny.box(tx, z - 0.03, y + 0.3, 0.025, 0.08, 0.06, 0xc8ccd0);
    k.solid.box(tx, z + 0.04, y + 0.44, 0.032, 0.032, 0.17, pick([0x1a1a1a, 0xc0392b, 0x1f3f7a, 0xd9a034], k.r));
  }
}

function candle(k: Kit, x: number, z: number, y: number) {
  k.glass.geometry(CYL, at(x, y + 0.04, z, 0.04, 0.08, 0.04), 0xffffff);
  k.solid.geometry(CYL, at(x, y + 0.025, z, 0.03, 0.05, 0.03), 0xf2e8d0);
  k.glow.geometry(BALL, at(x, y + 0.065, z, 0.008, 0.016, 0.008), 0xffc060);
}

export function setting(k: Kit, x: number, z: number, y: number, kind: 'cafe' | 'restaurant' | 'fastfood') {
  if (kind === 'cafe') {
    if (k.r() < 0.6) beer(k, x + 0.14, z + 0.08, y);
    if (k.r() < 0.4) beer(k, x - 0.13, z - 0.1, y);
    if (k.r() < 0.5) candle(k, x, z, y);
  } else if (kind === 'restaurant') {
    k.solid.box(x, z, y - 0.215, 0.92, 0.92, 0.22, 0xf6f4ee);
    const c = y - 0.03; // settings rest on c + 0.035, the cloth top: under CHAIR.hands
    for (const s of [-1, 1]) {
      k.solid.geometry(CYL, at(x + s * 0.24, c + 0.041, z, 0.12, 0.012, 0.12), 0xffffff);
      k.shiny.box(x + s * 0.24, z + 0.16, c + 0.035, 0.18, 0.015, 0.004, 0xb8b8b8);
      k.solid.box(x + s * 0.24, z - 0.17, c + 0.035, 0.1, 0.1, 0.02, pick([0x7a2e2e, 0x2f3b4e, 0xe9e4da], k.r));
      k.glass.geometry(BALL, at(x + s * 0.12, c + 0.16, z + 0.2, 0.035, 0.045, 0.035), 0xffffff);
      k.shiny.geometry(CYL, at(x + s * 0.12, c + 0.07, z + 0.2, 0.004, 0.1, 0.004), 0xd8dde0);
    }
    candle(k, x, z, c + 0.035);
  } else {
    for (const s of k.r() < 0.5 ? [-1, 1] : [k.r() < 0.5 ? -1 : 1]) {
      k.solid.box(x + s * 0.2, z, y, 0.34, 0.26, 0.012, pick([0x8a2a22, 0x2a2a2a, 0x2e5d8a], k.r));
      k.solid.geometry(CYL, at(x + s * 0.27, y + 0.08, z + 0.05, 0.035, 0.15, 0.035), pick([0xc0392b, 0xf2efe6], k.r));
      k.solid.box(x + s * 0.15, z - 0.04, y + 0.012, 0.09, 0.05, 0.09, 0xc0392b);
      k.solid.box(x + s * 0.15, z - 0.04, y + 0.1, 0.07, 0.035, 0.04, 0xf1c40f);
    }
  }
}

export function stanchions(k: Kit, posts: [number, number][], belt: number) {
  for (const [x, z] of posts) {
    k.shiny.geometry(CYL, at(x, 0.015, z, 0.15, 0.03, 0.15), 0xc9a04a);
    k.shiny.geometry(CYL, at(x, 0.48, z, 0.022, 0.96, 0.022), 0xc9a04a);
  }
  for (let i = 0; i + 1 < posts.length; i++) {
    const [ax, az] = posts[i], [bx, bz] = posts[i + 1], len = Math.hypot(bx - ax, bz - az);
    k.solid.geometry(CUBE, at((ax + bx) / 2, 0.88, (az + bz) / 2, len, 0.05, 0.008, -Math.atan2(bz - az, bx - ax)), belt);
  }
}

export function deskLamp(k: Kit, x: number, z: number, y: number) {
  k.shiny.box(x, z, y, 0.18, 0.12, 0.02, 0xc9a04a);
  k.shiny.geometry(CYL, at(x, y + 0.17, z, 0.01, 0.32, 0.01), 0xc9a04a);
  k.solid.geometry(CYL, at(x, y + 0.34, z, 0.07, 0.24, 0.07, Math.PI / 2, Math.PI / 2), 0x1f5a3a);
  k.glow.box(x, z, y + 0.295, 0.2, 0.08, 0.008, 0xffe0a0);
  lamp(k, x, y + 0.28, z, 1.2, WARM, 3.5, true);
}
