import * as THREE from 'three';
import { parkMiller } from '../../core/util';
import { BALL, CYL, DAY, WARM, at } from '../interiors';
import type { HallPlan } from '.';
import { archOutline, hole, vaultProfile, type HallKit, type Hole } from './kit';

// Landmark frame: +x is west (the portal under the towers), -x east to the choir; +z north. Nave centre line z = -1.
const ZN = -1;
const NAVE = { z0: -7.5, z1: 5.5 };
const HIGH = 17, AISLE = 11, AMB = 8; // where the vaults spring: nave/transept/choir, aisles, ambulatory (m)
const WEST = 58.2, TOWERS = 45.5, CROSS = { x0: -17.5, x1: -4 }, CHOIR_END = -42, AMB_END = -50;
const NORTH: [number, number][] = [[5.5, 12.5], [12.5, 19.5], [19.5, 25.5]];
const SOUTH: [number, number][] = [[-14.5, -7.5], [-21.5, -14.5], [-29.5, -21.5]];
const TRANSEPT = { z0: -32.5, z1: 29.5 };
const AMBULATORY = { z0: -17.5, z1: 15.5 };
const LANTERN = { x: (CROSS.x0 + CROSS.x1) / 2, z: ZN, r: 4.6 };
const BAYS = [TOWERS, 38.5, 31.5, 24.5, 17.5, 10.5, 3.5, CROSS.x1]; // pier lines across the nave and aisles
const CHOIR_BAYS = [CROSS.x0, -23.6, -29.75, -35.9, CHOIR_END];

const WHITE = 0xf1ece2, STONE = 0xd9d1c2, RIB = 0xc7bda9, OAK = 0x3e2a1c, FLAGS = 0xb4b2ab;

export const cathedral: HallPlan = {
  name: 'Onze-Lieve-Vrouwekathedraal',
  door: { x: WEST + 0.4, z: ZN, nx: 1, nz: 0, w: 4.2 },
  ambient: [0xf6f1e8, 1.0],
  sun: 0.3,
  build(k) {
    floors(k);
    vaults(k);
    walls(k);
    lantern(k);
    altars(k);
    furniture(k);
    people(k);
  },
};

function floors(k: HallKit) {
  k.floor(CROSS.x1, TOWERS, SOUTH[2][0], NORTH[2][1], 0, 15);
  k.floor(CROSS.x1, WEST, NAVE.z0, NAVE.z1, 0, 26);
  k.floor(TOWERS, WEST, SOUTH[0][0], NORTH[0][1], 0, 10);
  k.floor(WEST - 0.1, WEST + 0.45, ZN - 2, ZN + 2, 0, 5);
  k.floor(CROSS.x0, CROSS.x1, TRANSEPT.z0, TRANSEPT.z1, 0, 26);
  k.floor(AMB_END, CROSS.x0, AMBULATORY.z0, AMBULATORY.z1, 0, 13);
  k.floor(CHOIR_END, CROSS.x0, NAVE.z0, NAVE.z1, 0, 26);
  k.flat('flags', CROSS.x1, WEST + 0.45, SOUTH[2][0], NORTH[2][1], 0.01, FLAGS, 2.4);
  k.flat('flags', CROSS.x0, CROSS.x1, TRANSEPT.z0, TRANSEPT.z1, 0.01, FLAGS, 2.4);
  k.flat('flags', AMB_END, CROSS.x0, AMBULATORY.z0, AMBULATORY.z1, 0.01, FLAGS, 2.4);
  for (let x = 2; x < 44; x += 7) k.box('solid', x, ZN, 0.012, 1.1, 2.2, 0.004, 0x2a2a2c);
  for (let x = CHOIR_END + 1; x < CROSS.x0; x += 1.2) {
    for (let z = NAVE.z0 + 0.6; z < NAVE.z1; z += 1.2) if ((Math.round(x / 1.2) + Math.round(z / 1.2)) % 2) k.box('solid', x, z, 0.012, 1.2, 1.2, 0.004, 0x2a2a2c);
  }
}

/** Equilateral pointed vault along x (or z) with transverse ribs at `ribs` and a ridge rib; `cut` leaves the crown open. */
function strip(k: HallKit, a0: number, a1: number, c0: number, c1: number, spring: number, alongZ: boolean, ribs: number[], cut = 0) {
  const profile = vaultProfile(c0, c1, spring, 'pointed', 18), mid = (c0 + c1) / 2;
  if (cut) {
    k.vault('plaster', a0, a1, profile.filter(([c]) => c <= mid - cut), WHITE, alongZ);
    k.vault('plaster', a0, a1, profile.filter(([c]) => c >= mid + cut), WHITE, alongZ);
  } else k.vault('plaster', a0, a1, profile, WHITE, alongZ);
  const p = (a: number, c: number, y: number): [number, number, number] => (alongZ ? [c, y, a] : [a, y, c]);
  for (const a of ribs) {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [ca, ya] = profile[i], [cb, yb] = profile[i + 1];
      if (cut && Math.abs((ca + cb) / 2 - mid) < cut) continue;
      k.bar('solid', p(a, ca + Math.sign(mid - ca) * 0.08, ya - 0.1), p(a, cb + Math.sign(mid - cb) * 0.08, yb - 0.1), 0.3, 0.22, RIB);
    }
  }
  if (!cut) {
    const top = profile[Math.floor(profile.length / 2)][1];
    k.bar('solid', p(a0, mid, top - 0.12), p(a1, mid, top - 0.12), 0.22, 0.22, RIB);
  }
}

function vaults(k: HallKit) {
  strip(k, CROSS.x1, WEST, NAVE.z0, NAVE.z1, HIGH, false, [...BAYS, 51.85]);
  strip(k, CROSS.x0, CROSS.x1, NAVE.z0, NAVE.z1, HIGH, false, [], 3.2);
  strip(k, CHOIR_END, CROSS.x0, NAVE.z0, NAVE.z1, HIGH, false, CHOIR_BAYS);
  strip(k, NAVE.z1, TRANSEPT.z1, CROSS.x0, CROSS.x1, HIGH, true, [12.5, 19.5, 25.5]);
  strip(k, NAVE.z0, NAVE.z1, CROSS.x0, CROSS.x1, HIGH, true, [], 3.2);
  strip(k, TRANSEPT.z0, NAVE.z0, CROSS.x0, CROSS.x1, HIGH, true, [-14.5, -21.5, -29.5]);
  for (const [z0, z1] of [NORTH[0], SOUTH[0]]) strip(k, CROSS.x1, WEST, z0, z1, AISLE, false, [...BAYS, 51.85]);
  for (const [z0, z1] of [NORTH[1], NORTH[2], SOUTH[1], SOUTH[2]]) strip(k, CROSS.x1, TOWERS, Math.min(z0, z1), Math.max(z0, z1), AISLE, false, BAYS);
  strip(k, AMB_END, CROSS.x0, NAVE.z1, AMBULATORY.z1, AMB, false, CHOIR_BAYS);
  strip(k, AMB_END, CROSS.x0, AMBULATORY.z0, NAVE.z0, AMB, false, CHOIR_BAYS);
  strip(k, AMBULATORY.z0, AMBULATORY.z1, AMB_END, CHOIR_END, AMB, true, [-12.5, ZN, 10.5]);
}

/** The end of a pointed vault: its cross-section as a wall in the plane x = c (or z = c), facing n. */
function section(k: HallKit, alongZ: boolean, c: number, n: number, a: number, b: number, spring: number, holes: Hole[] = []) {
  const profile = vaultProfile(a, b, spring, 'pointed', 18);
  const u = (v: number) => (alongZ ? n * v : -n * v);
  const outline: [number, number][] = [[u(a), 0], [u(b), 0], ...profile.slice().reverse().map(([v, y]) => [u(v), y] as [number, number])];
  const hs = holes.map((h) => archOutline(Math.min(u(h.a), u(h.b)), Math.max(u(h.a), u(h.b)), h.y0, h.spring, 'pointed'));
  k.wall('plaster', alongZ ? 0 : c, 0, alongZ ? c : 0, alongZ ? 0 : n, alongZ ? n : 0, outline, hs, WHITE, 2.4);
}

const arches = (cols: number[], half: number, spring: number): Hole[] =>
  cols.slice(0, -1).map((a, i) => hole(Math.min(a, cols[i + 1]) + half, Math.max(a, cols[i + 1]) - half, 0, spring, 'pointed'));

function walls(k: HallKit) {
  const naveCols = [WEST, 51.85, ...BAYS];
  for (const z of [NAVE.z0, NAVE.z1]) {
    k.thickZ('plaster', z, CROSS.x1, WEST, 0, HIGH, 0.6, arches(naveCols, 0.95, 5.6), WHITE, 2.4);
    for (const x of naveCols.slice(1)) pier(k, x, z, x === TOWERS ? 1.25 : 0.95, HIGH);
    clerestory(k, z, z === NAVE.z1 ? -1 : 1);
  }
  for (const z of [NORTH[0][1], NORTH[1][1], SOUTH[0][0], SOUTH[1][0]]) {
    k.thickZ('plaster', z, CROSS.x1, TOWERS, 0, AISLE, 0.5, arches(BAYS, 0.75, 5.6), WHITE, 2.4);
    for (const x of BAYS.slice(1, -1)) pier(k, x, z, 0.75, AISLE);
  }
  for (const z of [NORTH[0][1], SOUTH[0][0]]) k.thickZ('plaster', z, TOWERS, WEST, 0, AISLE, 0.8, [], WHITE, 2.4);
  for (const z of [NAVE.z0, NAVE.z1]) {
    k.thickZ('plaster', z, CHOIR_END, CROSS.x0, 0, HIGH, 0.6, arches(CHOIR_BAYS, 0.8, 4.0), WHITE, 2.4);
    for (const x of CHOIR_BAYS.slice(1, -1)) pier(k, x, z, 0.8, HIGH);
    for (let x = CHOIR_END + 3; x < CROSS.x0 - 1; x += 6.1) glassWindow(k, x, z + (z > ZN ? -0.32 : 0.32), z > ZN ? -1 : 1, 2, 11.5, 14.5, 2);
  }
  for (const [x, z] of [[CROSS.x1, NAVE.z1], [CROSS.x1, NAVE.z0], [CROSS.x0, NAVE.z1], [CROSS.x0, NAVE.z0]]) pier(k, x, z, 1.35, HIGH);

  for (const [z, n] of [[NORTH[2][1], -1], [SOUTH[2][0], 1]] as const) {
    const windows = BAYS.slice(0, -1).map((a, i) => (a + BAYS[i + 1]) / 2).map((x) => hole(x - 1.6, x + 1.6, 2.4, 8.2, 'pointed'));
    k.wallZ('plaster', z, CROSS.x1, TOWERS, 0, AISLE, n, windows, WHITE, 2.4);
    for (const w of windows) {
      k.reveal('plaster', w, true, n < 0 ? z : z - 0.5, 0.5, STONE, 2.4);
      glassWindow(k, (w.a + w.b) / 2, z - n * 0.45, n, 3.2, 2.4, 8.2, (Math.round(w.a) >> 1) % 4);
    }
    confessional(k, BAYS[2] + 0.1, z + n * 0.8, n);
    confessional(k, BAYS[5] + 0.1, z + n * 0.8, n);
  }
  for (const [a, b] of [NORTH[1], NORTH[2], SOUTH[1], SOUTH[2]]) section(k, false, TOWERS, -1, Math.min(a, b), Math.max(a, b), AISLE);
  for (const [a, b] of [NORTH[0], SOUTH[0]]) section(k, false, WEST, -1, a, b, AISLE);
  const portal = hole(ZN - 2.1, ZN + 2.1, 0, 4.4, 'pointed'), west = hole(ZN - 4, ZN + 4, 13, 19.5, 'pointed');
  section(k, false, WEST, -1, NAVE.z0, NAVE.z1, HIGH, [portal, west]);
  k.reveal('ashlar', portal, false, WEST, 0.45, STONE, 2.4);
  k.reveal('plaster', west, false, WEST, 0.45, STONE, 2.4);
  k.quad('glow', [WEST + 0.44, 2.6, ZN], [0, 0, 2.1], [0, 2.6, 0], [-1, 0, 0], 0xe9eef4);
  k.lamp(WEST - 3, 3, ZN, 14, DAY, 12);
  glassSheet(k, WEST + 0.4, 19.75, ZN, 8, 13.6, -Math.PI / 2, 'cathedral-west');
  k.lamp(WEST - 6, 19, ZN, 40, DAY, 24);
  organ(k);

  for (const [z, n] of [[TRANSEPT.z1, -1], [TRANSEPT.z0, 1]] as const) {
    const window = hole(-14.8, -6.7, 9.5, 16.5, 'pointed');
    section(k, true, z, n, CROSS.x0, CROSS.x1, HIGH, [window]);
    k.reveal('plaster', window, true, n < 0 ? z : z - 0.45, 0.45, STONE, 2.4);
    glassSheet(k, -10.75, 16.5, z - n * 0.4, 8.2, 14.5, n > 0 ? 0 : Math.PI, 'cathedral-transept');
    k.lamp(-10.75, 15, z + n * 5, 40, DAY, 24);
  }
  for (const [z0, z1] of [[NORTH[2][1], TRANSEPT.z1], [TRANSEPT.z0, SOUTH[2][0]]]) k.wallX('plaster', CROSS.x1, z0, z1, 0, HIGH, -1, [], WHITE, 2.4);
  for (const [z0, z1] of [[AMBULATORY.z1, TRANSEPT.z1], [TRANSEPT.z0, AMBULATORY.z0]]) k.wallX('plaster', CROSS.x0, z0, z1, 0, HIGH, 1, [], WHITE, 2.4);
  const aisleArches = (list: [number, number][]) => list.map(([a, b]) => hole(Math.min(a, b) + 0.6, Math.max(a, b) - 0.6, 0, AISLE, 'pointed'));
  k.thickX('plaster', CROSS.x1, NAVE.z1, NORTH[2][1], 0, HIGH, 1.2, aisleArches(NORTH), WHITE, 2.4);
  k.thickX('plaster', CROSS.x1, SOUTH[2][0], NAVE.z0, 0, HIGH, 1.2, aisleArches(SOUTH), WHITE, 2.4);
  k.thickX('plaster', CROSS.x0, NAVE.z1, AMBULATORY.z1, 0, HIGH, 1.2, [hole(NAVE.z1 + 0.6, AMBULATORY.z1 - 0.6, 0, AMB, 'pointed')], WHITE, 2.4);
  k.thickX('plaster', CROSS.x0, AMBULATORY.z0, NAVE.z0, 0, HIGH, 1.2, [hole(AMBULATORY.z0 + 0.6, NAVE.z0 - 0.6, 0, AMB, 'pointed')], WHITE, 2.4);
  for (const [a, b] of [...NORTH.slice(0, 2), ...SOUTH.slice(0, 2)]) {
    const z = Math.abs(a) > Math.abs(b) ? a : b;
    k.block(CROSS.x1, z, 1.4, 1.4, true);
  }

  section(k, false, CHOIR_END, 1, NAVE.z0, NAVE.z1, HIGH);
  k.wallX('plaster', CHOIR_END - 0.6, NAVE.z0, NAVE.z1, 0, AMB, -1, [], WHITE, 2.4);
  k.box('plaster', CHOIR_END - 0.3, ZN, 0, 0.6, NAVE.z1 - NAVE.z0, AMB, WHITE);
  for (const [z, n] of [[AMBULATORY.z1, -1], [AMBULATORY.z0, 1]] as const) {
    const windows = [-46, -39, -32.8, -26.7, -20.6].map((x) => hole(x - 1.4, x + 1.4, 1.8, 5.2, 'pointed'));
    k.wallZ('plaster', z, AMB_END, CROSS.x0, 0, AMB, n, windows, WHITE, 2.4);
    windows.forEach((w, i) => {
      k.reveal('plaster', w, true, n < 0 ? z : z - 0.4, 0.4, STONE, 2.4);
      glassWindow(k, (w.a + w.b) / 2, z - n * 0.35, n, 2.8, 1.8, 5.2, i % 4);
    });
  }
  for (const [a, b] of [[NAVE.z1, AMBULATORY.z1], [AMBULATORY.z0, NAVE.z0]]) section(k, false, AMB_END, 1, a, b, AMB);
  k.wallX('plaster', AMB_END, NAVE.z0, NAVE.z1, 0, AMB, 1, [], WHITE, 2.4);
  for (const z of [-5, 3]) glassWindow(k, AMB_END + 0.05, z, 1, 2.6, 1.8, 5.2, 2, true);
}

function pier(k: HallKit, x: number, z: number, r: number, spring: number) {
  k.cyl('plaster', x, 0, z, r, spring, STONE);
  k.cyl('solid', x, 0, z, r + 0.18, 0.55, 0xbfb6a6);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.cyl('plaster', x + Math.cos(a) * r * 0.85, 0.55, z + Math.sin(a) * r * 0.85, r * 0.32, spring - 0.55, 0xe2dacb);
  }
  k.cyl('solid', x, spring * 0.55, z, r + 0.12, 0.35, 0xcfc6b4);
  k.block(x, z, r * 2 + 0.2, r * 2 + 0.2, true);
}

function clerestory(k: HallKit, z: number, n: number) {
  const cols = [WEST, 51.85, ...BAYS];
  for (let i = 0; i + 1 < cols.length; i++) {
    const cx = (cols[i] + cols[i + 1]) / 2, w = Math.abs(cols[i] - cols[i + 1]) - 2.4;
    k.box('solid', cx, z + n * 0.31, 11.2, w, 0.04, 0.12, RIB);
    for (let s = -w / 2 + w / 8; s < w / 2; s += w / 4) k.box('solid', cx + s, z + n * 0.31, 11.2, 0.1, 0.04, 2.2, RIB);
    glassWindow(k, cx, z + n * 0.32, n, Math.min(w, 3.6), 11.8, 13.4, i % 4);
  }
}

const GLASS: string[][] = [
  ['#1f4fa8', '#c8102e', '#f2c230', '#2e8b57', '#6a3d9a'],
  ['#2b6cb0', '#e8b23a', '#b83228', '#3f8f6a', '#f3e9c9'],
  ['#3b4f9c', '#d94f2b', '#e9c46a', '#5b8f3a', '#8e3b8e'],
  ['#e9eef2', '#d9e2ea', '#c8d4de', '#f2efe6', '#e4dcc8'],
];

/** A stained glass lancet in a wall: drawn behind the opening, which crops its pointed top. */
function glassWindow(k: HallKit, x: number, z: number, n: number, w: number, y0: number, spring: number, design: number, alongX = false) {
  const h = spring + w * 0.87 - y0, d = ((design % 4) + 4) % 4;
  const yaw = alongX ? (n > 0 ? Math.PI / 2 : -Math.PI / 2) : n > 0 ? 0 : Math.PI;
  k.sheet(x, y0 + h / 2, z, w, h, yaw, (g, W, H) => leaded(g, W, H, GLASS[d], d), true, `cathedral-glass-${d}`);
  k.lamp(alongX ? x + n * 3 : x, y0 + h * 0.6, alongX ? z : z + n * 3, w * h * 0.5, DAY, 10);
}

function glassSheet(k: HallKit, x: number, y: number, z: number, w: number, h: number, yaw: number, key: string) {
  k.sheet(x, y, z, w, h, yaw, (g, W, H) => leaded(g, W, H, GLASS[key.includes('west') ? 0 : 2], 7), true, key);
}

function leaded(g: CanvasRenderingContext2D, w: number, h: number, colours: string[], seed: number) {
  const r = parkMiller(seed * 131 + 7);
  const cell = w / 6;
  for (let y = 0; y < h; y += cell * 1.4) {
    for (let x = 0; x < w; x += cell) {
      g.fillStyle = colours[Math.floor(r() * colours.length)];
      g.fillRect(x, y, cell, cell * 1.4);
      g.fillStyle = `rgba(255,255,255,${0.08 + r() * 0.15})`;
      g.fillRect(x + cell * 0.2, y + cell * 0.2, cell * 0.3, cell * 0.5);
    }
  }
  for (let y = h * 0.18; y < h * 0.9; y += h * 0.36) {
    g.fillStyle = '#f2d27a';
    g.beginPath();
    g.arc(w / 2, y, w * 0.16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f0d8b8';
    g.beginPath();
    g.arc(w / 2, y, w * 0.08, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = colours[Math.floor(r() * 3)];
    g.beginPath();
    g.moveTo(w / 2 - w * 0.07, y + w * 0.1);
    g.lineTo(w / 2 + w * 0.07, y + w * 0.1);
    g.lineTo(w / 2 + w * 0.2, y + h * 0.26);
    g.lineTo(w / 2 - w * 0.2, y + h * 0.26);
    g.fill();
  }
  g.strokeStyle = '#1a1a1a';
  g.lineWidth = Math.max(2, w * 0.012);
  for (let x = 0; x <= w; x += cell) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y <= h; y += cell * 1.4) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.lineWidth = Math.max(4, w * 0.04);
  g.strokeRect(0, 0, w, h);
  g.beginPath();
  g.moveTo(w / 2, 0);
  g.lineTo(w / 2, h);
  g.stroke();
}

function lantern(k: HallKit) {
  const { x, z, r } = LANTERN, base = 25.2, top = 32;
  k.lathe('plaster', x, z, [[r, base], [r, top]], WHITE, 16);
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    k.geom('glow', new THREE.PlaneGeometry(1.3, 3.4), at(x + Math.cos(a) * (r - 0.05), (base + top) / 2 + 0.4, z + Math.sin(a) * (r - 0.05), 1, 1, 1, -a - Math.PI / 2), 0xeef2f6);
    k.lamp(x + Math.cos(a) * 3, 28, z + Math.sin(a) * 3, 10, DAY, 16);
  }
  const dome: [number, number][] = [];
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * (Math.PI / 2);
    dome.push([r * Math.cos(t), top + 3.6 * Math.sin(t)]);
  }
  k.lathe('plaster', x, z, dome, 0xd8e4ee, 16);
  // Cornelis Schut's Assumption, painted in the cupola.
  k.sheet(x, top + 2.4, z, 6, 6, 0, cupola, true, 'cathedral-cupola', Math.PI / 2);
  k.lathe('solid', x, z, [[r + 0.05, base - 0.1], [r - 0.3, base + 0.2]], RIB, 16);
  k.lamp(x, 22, z, 30, DAY, 26);
}

function cupola(g: CanvasRenderingContext2D, w: number, h: number) {
  const sky = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.5);
  sky.addColorStop(0, '#fff3c8');
  sky.addColorStop(0.25, '#f2d58c');
  sky.addColorStop(0.6, '#8fb2d6');
  sky.addColorStop(1, '#c4d4e2');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const r = parkMiller(3);
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2, d = w * (0.22 + r() * 0.24);
    g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.3})`;
    g.beginPath();
    g.ellipse(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, w * (0.04 + r() * 0.05), w * 0.03, a, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, d = w * 0.33;
    g.fillStyle = ['#e8b89a', '#c8102e', '#1f4fa8', '#f2c230'][i % 4];
    g.beginPath();
    g.ellipse(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, w * 0.03, w * 0.05, a, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#1f4fa8';
  g.beginPath();
  g.ellipse(w / 2, h / 2 + h * 0.03, w * 0.06, h * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#b8282e';
  g.beginPath();
  g.ellipse(w / 2, h / 2, w * 0.035, h * 0.07, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f0d8b8';
  g.beginPath();
  g.arc(w / 2, h / 2 - h * 0.08, w * 0.022, 0, Math.PI * 2);
  g.fill();
}

type Painting = 'raising' | 'descent' | 'assumption';

/** Rubens' altarpieces, as broad masses of light and colour: no attempt at the figures beyond their poses. */
function rubens(kind: Painting, panel: 'centre' | 'left' | 'right') {
  return (g: CanvasRenderingContext2D, w: number, h: number) => {
    const r = parkMiller(kind.length * 97 + panel.length);
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, kind === 'assumption' ? '#d9b46a' : '#4a3a28');
    bg.addColorStop(0.5, kind === 'assumption' ? '#7a5a34' : '#2a2018');
    bg.addColorStop(1, '#140f0a');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w * 0.55, h * 0.4, 0, w * 0.55, h * 0.4, w * 0.6);
    glow.addColorStop(0, kind === 'assumption' ? 'rgba(255,236,180,0.9)' : 'rgba(240,210,160,0.45)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    const figure = (x: number, y: number, sz: number, robe: string, tilt = 0) => {
      g.save();
      g.translate(x, y);
      g.rotate(tilt);
      g.fillStyle = robe;
      g.beginPath();
      g.ellipse(0, sz * 0.7, sz * 0.45, sz * 0.9, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#d9a982';
      g.beginPath();
      g.arc(0, -sz * 0.35, sz * 0.24, 0, Math.PI * 2);
      g.fill();
      g.restore();
    };
    if (panel !== 'centre') {
      for (let i = 0; i < 6; i++) figure(w * (0.25 + r() * 0.5), h * (0.25 + r() * 0.6), w * 0.13, ['#7a1e1e', '#2f4f6f', '#6b5a3a', '#c8b48a', '#3a2a1e'][i % 5], (r() - 0.5) * 0.6);
      return;
    }
    if (kind === 'raising') {
      g.strokeStyle = '#3a2614';
      g.lineWidth = w * 0.07;
      g.beginPath();
      g.moveTo(w * 0.2, h * 0.95);
      g.lineTo(w * 0.75, h * 0.08);
      g.stroke();
      g.fillStyle = '#efdcc0';
      g.save();
      g.translate(w * 0.5, h * 0.5);
      g.rotate(-1.0);
      g.beginPath();
      g.ellipse(0, 0, h * 0.26, w * 0.06, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      for (let i = 0; i < 7; i++) figure(w * (0.1 + i * 0.11), h * (0.62 + r() * 0.25), w * 0.09, ['#c58a5a', '#7a1e1e', '#a8743e', '#3a4f6f'][i % 4], (r() - 0.5) * 0.9);
    } else if (kind === 'descent') {
      g.fillStyle = '#2a1c10';
      g.fillRect(w * 0.47, 0, w * 0.06, h * 0.75);
      g.fillStyle = '#f4f0e6';
      g.beginPath();
      g.moveTo(w * 0.62, h * 0.1);
      g.lineTo(w * 0.72, h * 0.18);
      g.lineTo(w * 0.42, h * 0.92);
      g.lineTo(w * 0.28, h * 0.86);
      g.fill();
      g.fillStyle = '#e8d2b4';
      g.save();
      g.translate(w * 0.5, h * 0.48);
      g.rotate(0.45);
      g.beginPath();
      g.ellipse(0, 0, w * 0.06, h * 0.24, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
      figure(w * 0.28, h * 0.5, w * 0.11, '#b8182a', 0.3);
      for (let i = 0; i < 5; i++) figure(w * (0.6 + r() * 0.3), h * (0.3 + i * 0.13), w * 0.09, ['#2f4f6f', '#6b5a3a', '#3a2a1e', '#7a1e1e', '#4a5a3a'][i], -0.3);
    } else {
      figure(w * 0.5, h * 0.3, w * 0.16, '#1f4fa8');
      g.fillStyle = '#b8282e';
      g.beginPath();
      g.ellipse(w * 0.5, h * 0.36, w * 0.06, h * 0.08, 0, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 10; i++) {
        g.fillStyle = '#f0c8a8';
        g.beginPath();
        g.arc(w * (0.2 + r() * 0.6), h * (0.1 + r() * 0.35), w * 0.035, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#3a2a1e';
      g.fillRect(w * 0.3, h * 0.78, w * 0.4, h * 0.08);
      for (let i = 0; i < 9; i++) figure(w * (0.08 + i * 0.105), h * (0.7 + r() * 0.12), w * 0.08, ['#7a1e1e', '#2f4f6f', '#c8a050', '#3a5a3a', '#5a3a6a'][i % 5], (r() - 0.5) * 0.5);
    }
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let i = 0; i < 400; i++) g.fillRect(r() * w, r() * h, 2, 2);
  };
}

function triptych(k: HallKit, kind: 'raising' | 'descent', z: number, n: number, title: string) {
  const x = -10.75, yaw = n > 0 ? 0 : Math.PI, cw = 3.4, ch = 4.6, ww = 1.5, y = 1.6 + ch / 2;
  k.box('solid', x, z + n * 0.6, 0, 4.4, 1.0, 1.0, 0xe8e2d6);
  k.box('solid', x, z + n * 0.6, 1.0, 4.6, 1.1, 0.08, 0x2a2a2c);
  k.block(x, z + n * 0.6, 4.4, 1.0);
  for (const [dx, pw, key] of [[0, cw, 'centre'], [-(cw / 2 + ww / 2 + 0.25), ww, 'left'], [cw / 2 + ww / 2 + 0.25, ww, 'right']] as const) {
    k.box('shiny', x + dx * -n, z + n * 0.08, y - ch / 2 - 0.15, pw + 0.3, 0.12, ch + 0.3, 0x8a6a2a);
    k.sheet(x + dx * -n, y, z + n * 0.15, pw, ch, yaw, rubens(kind, key), false, `cathedral-${kind}-${key}`);
  }
  k.lamp(x, 6, z + n * 4, 10, 0xfff0d8, 9, true);
  placard(k, x + 3.0 * -n, z + n * 1.0, yaw, title);
}

function placard(k: HallKit, x: number, z: number, yaw: number, text: string) {
  k.box('solid', x, z, 0, 0.06, 0.06, 1.05, 0x2a2a2a);
  k.box('solid', x, z, 1.05, Math.abs(Math.cos(yaw)) * 0.9 + 0.06, Math.abs(Math.sin(yaw)) * 0.9 + 0.06, 0.4, 0x2a2a2a);
  k.block(x, z, 0.3, 0.3);
  const [fx, fz] = [Math.sin(yaw), Math.cos(yaw)];
  x += fx * 0.04;
  z += fz * 0.04;
  k.sheet(x, 1.25, z, 0.9, 0.35, yaw, (g, w, h) => {
    g.fillStyle = '#f4efe2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#2a2a2a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const [a, b] = text.split('|');
    g.font = `italic 700 ${Math.round(h * 0.26)}px Georgia, serif`;
    g.fillText(a, w / 2, h * 0.36);
    g.font = `${Math.round(h * 0.2)}px Georgia, serif`;
    g.fillText(b, w / 2, h * 0.7);
  }, false, `cathedral-placard-${text}`);
}

function altars(k: HallKit) {
  triptych(k, 'raising', TRANSEPT.z1, -1, 'De Kruisoprichting|Peter Paul Rubens, 1610–1611');
  triptych(k, 'descent', TRANSEPT.z0, 1, 'De Kruisafneming|Peter Paul Rubens, 1611–1614');

  // The high altar: Rubens' Assumption in a black and white marble portico.
  const x = CHOIR_END + 0.35, cz = ZN;
  k.box('solid', x + 1.6, cz, 0, 2.4, 6, 0.3, 0x2a2a2c);
  k.box('solid', x + 1.2, cz, 0.3, 1.6, 4.4, 0.9, 0xece6da);
  k.block(x + 1.4, cz, 2.6, 6);
  for (const dz of [-3.1, 3.1]) {
    k.cyl('shiny', x + 0.7, 1.3, cz + dz, 0.38, 8.5, 0x1d1d1f);
    k.cyl('solid', x + 0.7, 9.8, cz + dz, 0.5, 0.5, 0xd8c08a);
  }
  k.box('solid', x + 0.5, cz, 10.3, 1.0, 8, 0.9, 0xece6da);
  k.solidWall('solid', x + 1.0, 11.2, cz, 1, 0, [[-4, 0], [4, 0], [0, 2.2]], [], 0.9, 0xece6da);
  k.box('shiny', x + 0.12, cz, 3.4, 0.12, 3.6, 5.2, 0x8a6a2a);
  k.sheet(x + 0.2, 6, cz, 3.3, 4.9, Math.PI / 2, rubens('assumption', 'centre'), false, 'cathedral-assumption');
  k.lamp(x + 5, 7, cz, 16, 0xfff0d8, 12, true);
  placard(k, x + 2.9, cz - 3.4, Math.PI / 2, 'Tenhemelopneming van Maria|Peter Paul Rubens, 1625–1626');
  for (const dz of [-1.6, 1.6]) {
    k.cyl('shiny', x + 1.6, 1.2, cz + dz, 0.05, 0.5, 0xd2a640);
    k.geom('glow', BALL, at(x + 1.6, 1.78, cz + dz, 0.03, 0.06, 0.03), 0xffc060);
  }

  k.floor(LANTERN.x - 3, LANTERN.x + 3, LANTERN.z - 3, LANTERN.z + 3, 0.25, 25);
  k.box('solid', LANTERN.x, LANTERN.z, 0, 6, 6, 0.25, 0xd6cfc0);
  k.box('solid', LANTERN.x, LANTERN.z, 0.25, 2.2, 1.0, 0.75, 0xece6da);
  k.box('solid', LANTERN.x, LANTERN.z, 1.0, 2.4, 1.1, 0.06, 0xd8c08a);
  k.block(LANTERN.x, LANTERN.z, 2.4, 1.2);
  for (const [z, n] of [[NAVE.z1 - 1.0, -1], [NAVE.z0 + 1.0, 1]] as const) {
    for (let x0 = CHOIR_END + 3; x0 < CROSS.x0 - 2; x0 += 0.7) {
      k.box('solid', x0, z, 0, 0.62, 0.7, 0.45, OAK);
      k.box('solid', x0, z - n * 0.3, 0.45, 0.62, 0.1, 1.9, OAK);
    }
    k.box('solid', (CHOIR_END + CROSS.x0) / 2 - 0.5, z - n * 0.32, 2.35, CROSS.x0 - CHOIR_END - 4, 0.3, 0.25, 0x2c1e14);
    k.block((CHOIR_END + CROSS.x0) / 2 - 0.5, z, CROSS.x0 - CHOIR_END - 4.4, 0.8);
  }
}

function organ(k: HallKit) {
  const x = WEST - 1.6;
  k.box('solid', x, ZN, 8.5, 2.6, NAVE.z1 - NAVE.z0 - 0.4, 0.5, OAK);
  k.box('solid', x - 1.25, ZN, 9.0, 0.1, NAVE.z1 - NAVE.z0 - 0.4, 1.0, OAK);
  k.box('solid', x + 0.2, ZN, 9.0, 1.6, 7, 4.6, OAK);
  for (let i = 0; i < 15; i++) {
    const dz = -3.2 + i * (6.4 / 14), hgt = 2.2 + Math.cos(((i - 7) / 7) * 1.4) * 1.6;
    k.cyl('shiny', x - 0.7, 9.6, ZN + dz, 0.13, hgt, 0xc8ccd0);
  }
  k.box('shiny', x - 0.62, ZN, 13.7, 0.2, 7.2, 0.4, 0xd2a640);
}

function confessional(k: HallKit, x: number, z: number, n: number) {
  k.box('solid', x, z, 0, 2.8, 1.2, 2.8, OAK);
  k.box('solid', x, z, 2.8, 3.0, 1.3, 0.25, 0x2c1e14);
  for (const dx of [-0.95, 0, 0.95]) k.box('solid', x + dx, z - n * 0.61, 0.2, 0.7, 0.02, 2.2, dx ? 0x2c1e14 : 0x5a1e1e);
  k.block(x, z, 2.8, 1.2);
}

function furniture(k: HallKit) {
  for (let x = 6; x < 43; x += 1.05) {
    for (const [z0, z1] of [[NAVE.z0 + 0.9, ZN - 1.1], [ZN + 1.1, NAVE.z1 - (x > 19 && x < 24 ? 2.4 : 0.9)]]) {
      for (let z = z0 + 0.24; z < z1; z += 0.5) {
        k.box('solid', x, z, 0.43, 0.42, 0.42, 0.05, 0xb8955a);
        k.box('solid', x + 0.19, z, 0.48, 0.04, 0.4, 0.5, 0x7a5634);
        k.box('solid', x - 0.18, z, 0, 0.04, 0.38, 0.43, 0x6b4a2c);
        k.box('solid', x + 0.19, z, 0, 0.04, 0.38, 0.43, 0x6b4a2c);
        if (k.r() < 0.08) k.person(x - 0.05, z, -1, 0, 0, 'moped');
      }
      k.block(x, (z0 + z1) / 2, 0.5, z1 - z0);
    }
  }
  pulpit(k, 21.5, NAVE.z1 - 1.3);
  for (const x of [50, 36, 22, 8]) chandelier(k, x, ZN, 8);
  chandelier(k, -29.75, ZN, 9);
  for (const [x, z] of [[-6, 9], [-6, -13]]) {
    k.box('shiny', x, z, 0, 1.4, 0.5, 0.9, 0x3a3a3a);
    for (let i = 0; i < 14; i++) k.geom('glow', BALL, at(x - 0.6 + (i % 7) * 0.2, 0.98, z - 0.12 + Math.floor(i / 7) * 0.24, 0.02, 0.04, 0.02), 0xffc060);
    k.block(x, z, 1.4, 0.5);
    k.lamp(x, 1.4, z, 2.5, WARM, 4);
  }
}

function pulpit(k: HallKit, x: number, z: number) {
  k.cyl('solid', x, 0, z, 0.35, 2.2, OAK);
  k.geom('solid', new THREE.CylinderGeometry(0.95, 0.75, 1.2, 6), at(x, 2.8, z, 1, 1, 1), OAK);
  k.geom('solid', new THREE.CylinderGeometry(1.3, 1.3, 0.3, 6), at(x, 6.6, z, 1, 1, 1), OAK);
  k.geom('shiny', new THREE.ConeGeometry(0.7, 1.4, 6), at(x, 7.45, z, 1, 1, 1), 0xd2a640);
  k.box('solid', x, z + 0.95, 3.4, 0.25, 0.25, 3.2, OAK);
  k.bar('solid', [x + 3.2, 0.6, z + 0.7], [x + 0.9, 2.4, z + 0.7], 0.9, 0.3, OAK);
  k.block(x, z, 2, 2, true);
  k.block(x + 2.2, z + 0.7, 2.4, 0.9);
}

function chandelier(k: HallKit, x: number, z: number, y: number) {
  k.box('solid', x, z, y + 0.6, 0.03, 0.03, HIGH + 8 - y, 0x222222);
  k.geom('shiny', BALL, at(x, y + 0.5, z, 0.22, 0.22, 0.22), 0xc9a04a);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.bar('shiny', [x, y + 0.45, z], [x + Math.cos(a) * 0.9, y + 0.2, z + Math.sin(a) * 0.9], 0.03, 0.03, 0xc9a04a);
    k.geom('glow', CYL, at(x + Math.cos(a) * 0.9, y + 0.32, z + Math.sin(a) * 0.9, 0.025, 0.18, 0.025), 0xfff4e0);
    k.geom('glow', BALL, at(x + Math.cos(a) * 0.9, y + 0.45, z + Math.sin(a) * 0.9, 0.02, 0.04, 0.02), 0xffc060);
  }
  k.lamp(x, y + 0.3, z, 12, WARM, 12);
}

function people(k: HallKit) {
  const spots: [number, number, number, number][] = [
    [-9, 25.5, 0, 1], [-11.5, 25.8, 0.2, 1], [-13, 24.8, 0.4, 1], [-10, 24, 0, 1],
    [-9.5, -28.6, 0, -1], [-12, -28.2, -0.3, -1], [-11, -27, 0, -1],
    [-36, -2, -1, 0], [-36.5, 0.5, -1, 0.1], [-35.5, -4, -1, -0.2],
    [-6, -1, -1, 0], [-15, 2.5, 1, -0.5], [-8.5, 7, 0, 1], [-13, -9, 0.5, -1],
    [30, 22, 0, 1], [18, 23.5, 0, 1], [40, -26.5, 0, -1], [26, -26, 0, -1], [12, -17, -1, 0],
    [55, 2, -1, 0], [53, -4, -1, 0.3], [50, 9, -1, -0.2], [20, -10.5, 0, 1], [-25, 12, 0, 1], [-45, -12, 1, 0],
  ];
  for (const [x, z, fx, fz] of spots) k.person(x, z, fx, fz);
  k.walker([[54, -2.4], [-2, -2.4], [-2, -1.6], [54, -1.6]], 0, 1.0);
  k.walker([[44, 16], [-2, 16], [-2, 17], [44, 17]], 0, 0.9);
  k.walker([[44, -18], [-2, -18], [-2, -19], [44, -19]], 0, 0.95);
  k.walker([[-20, 10.5], [-48, 10.5], [-48, -13], [-20, -13]], 0, 0.9);
}
