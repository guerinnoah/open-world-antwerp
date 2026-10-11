import * as THREE from 'three';
import { BALL, CYL, DAY, WARM, at, fitFont } from '../interiors';
import type { HallPlan } from '.';
import { hole, profileAt, vaultProfile, type HallKit, type Hole } from './kit';

// Landmark frame: x runs from the train hall's far end (-125) to the entrance front on Astridplein (+122), z across.
const UP = 6; // m: platforms and everything past the grand staircase, on the old viaduct
const BED = 4.9, RAIL = 5.17; // track bed and rail top (m)
const ZC = 1.5; // centre line of the dome and train hall
const D = { x0: 82.5, x1: 108, z0: -12.5, z1: 15.5, top: 28 }; // dome hall, walls up to the cornice
const DOME = { x: 95.25, z: ZC, r: 12 };
const STAIR = { x0: 86, x1: 100, z0: -5, z1: 8 };
const V = { x0: 108, x1: 122.1, z0: -9, z1: 9, top: 18 }; // entrance hall
const PASS = { x0: 60.2, x1: D.x0, z0: -8, z1: 11, spring: UP + 7 };
const TH = { x0: -125.5, x1: PASS.x0, z0: -35, z1: 38, spring: 12, rise: 31 }; // train hall
const VOID = { x0: -95, x1: 25, z0: -6.5, z1: 9.5, bottom: -12 };
const PLAT_END = -118, BUFFER = 36.5, CONCOURSE = 38;

const PLATFORMS: [number, number, string][] = [[-35, -32.5, '1'], [-28, -20.5, '1  2'], [-11.5, -6.5, '3'], [9.5, 14.5, '4'], [23.5, 31, '5  6'], [35.5, 38, '6']];
const TRACKS = [-30.25, -18.25, -13.75, 16.75, 21.25, 33.25];

const CREAM = 0xe9dcc3, BEIGE = 0xd9c9ad, RED_MARBLE = 0x8e3e33, GREEN_MARBLE = 0x2f5a4c, BLACK_MARBLE = 0x2a2a2c;
const GOLD = 0xd2a640, IRON = 0x353a40, GLASS_SKY = 0xe6eef4, DAY_HEX = 0xf4f7fb, BLUE = '#1b4f9c';

export const centraal: HallPlan = {
  name: 'Antwerpen-Centraal',
  door: { x: 122.35, z: 0, nx: 1, nz: 0, w: 13 },
  ambient: [0xffe0b8, 0.85],
  sun: 0.15,
  // The marble halls are lamplit; the train hall is daylight under glass. Blend through the passage.
  tone(x) {
    const t = THREE.MathUtils.smoothstep(x, PASS.x0 - 4, PASS.x1 - 6);
    return { ambient: [new THREE.Color(0xe4ecf4).lerp(new THREE.Color(0xffe0b8), t).getHex(), 1.35 - 0.5 * t], sun: 0.55 - 0.4 * t };
  },
  build(k) {
    vestibule(k);
    domeHall(k);
    stair(k);
    passage(k);
    trainHall(k);
  },
};

function vestibule(k: HallKit) {
  const { x0, x1, z0, z1, top } = V;
  k.floor(x0, x1 + 0.25, z0, z1, 0, top);
  k.flat('marble', x0, x1, z0, z1, 0.01, 0xf0e8dc, 2.5);
  for (let x = x0 + 1; x < x1; x += 2) k.flat('solid', x, x + 0.08, z0, z1, 0.015, 0x6b5a4a);
  const doors = [-5.5, -1.8, 1.8, 5.5].map((z) => hole(z - 1.1, z + 1.1, 0, 5.2, 'flat'));
  const window = hole(-6.5, 6.5, 7, 10.5);
  k.wallX('ashlar', x1, z0, z1, 0, top, -1, [...doors, window], BEIGE, 2.4);
  for (const d of doors) {
    k.reveal('ashlar', d, false, x1, 0.3, BEIGE, 2.4);
    k.quad('glass', [x1 + 0.2, 2.6, (d.a + d.b) / 2], [0, 0, 1.1], [0, 2.6, 0], [-1, 0, 0], 0xffffff);
    k.box('shiny', x1 + 0.2, (d.a + d.b) / 2, 0, 0.08, 0.08, 5.2, 0x8a6a2a);
    k.box('glow', x1 + 0.25, (d.a + d.b) / 2, 5.25, 0.05, 2.2, 0.7, DAY_HEX);
    k.lamp(x1 + 2, 2.5, (d.a + d.b) / 2, 10, DAY, 9);
  }
  k.reveal('ashlar', window, false, x1, 0.25, BEIGE, 2.4);
  k.quad('glow', [x1 + 0.24, 8.75, 0], [0, 0, 6.5], [0, 1.75, 0], [-1, 0, 0], DAY_HEX);
  k.geom('glow', new THREE.CircleGeometry(6.5, 24, 0, Math.PI), at(x1 + 0.24, 10.5, 0, 1, 1, 1, -Math.PI / 2), DAY_HEX);
  for (let z = -6.5; z <= 6.6; z += 1.625) k.box('solid', x1 + 0.2, z, 7, 0.12, 0.12, 3.5 + Math.sqrt(Math.max(0, 6.5 ** 2 - z * z)), IRON);
  for (const y of [7, 9.5, 12, 14.5]) {
    const half = y <= 10.5 ? 6.5 : Math.sqrt(6.5 ** 2 - (y - 10.5) ** 2);
    k.box('solid', x1 + 0.2, 0, y, 0.12, half * 2, 0.12, IRON);
  }
  k.lamp(x1 + 3, 11, 0, 40, DAY, 18);
  k.wallZ('ashlar', z0, x0, x1, 0, top, 1, [], BEIGE, 2.4);
  k.wallZ('ashlar', z1, x0, x1, 0, top, -1, [], BEIGE, 2.4);
  const arch = hole(-6, 7.5, 0, 10);
  k.wallX('marble', x0, z0, z1, 0, top, 1, [arch], CREAM, 3);
  k.flat('marble', x0, x1, z0, z1, top, 0xefe6d6, 3, true);
  for (let x = x0 + 2; x < x1; x += 2.8) k.box('shiny', x, 0, top - 0.25, 0.18, z1 - z0, 0.25, GOLD);
  for (let z = z0 + 2.25; z < z1; z += 4.5) k.box('shiny', (x0 + x1) / 2, z, top - 0.25, x1 - x0, 0.18, 0.25, GOLD);
  for (const z of [z0, z1]) {
    const nz = z === z0 ? 1 : -1;
    for (const x of [111, 115, 119]) {
      k.box('solid', x, z + nz * 0.05, 0, 2.6, 0.1, 1.1, BLACK_MARBLE);
      k.box('marble', x, z + nz * 0.04, 1.4, 2.2, 0.08, 7, nz > 0 ? RED_MARBLE : GREEN_MARBLE);
    }
  }
  ticketMachines(k, 112, z1 - 0.5, -1);
  ticketMachines(k, 112, z0 + 0.5, 1);
  for (const [x, z, fx, fz] of [[116, 4, -1, 0.2], [113, -3, 1, 0], [119.5, -6, -1, 0.5], [111, 7.5, 0, 1], [111.8, 7.6, 0, 1], [110, -7.3, 0, -1]] as const) k.person(x, z, fx, fz);
  k.walker([[121, -3.5], [104, -3.5], [104, -2.5], [121, -2.5]], 0, 1.4);
  k.walker([[120, 4], [101, 6], [101, 7], [120, 5]], 0, 1.3);
}

function ticketMachines(k: HallKit, x: number, z: number, face: number) {
  for (let i = 0; i < 3; i++) {
    const mx = x + i * 1.3;
    k.box('solid', mx, z, 0, 1, 0.5, 1.8, 0x1d4f9a);
    k.block(mx, z, 1, 0.5);
    k.box('glow', mx, z + face * 0.255, 1.05, 0.5, 0.01, 0.38, 0x9fc4ee);
    k.box('solid', mx, z + face * 0.26, 1.62, 0.9, 0.01, 0.14, 0xf2c230);
  }
}

function domeHall(k: HallKit) {
  const { x0, x1, z0, z1, top } = D;
  k.floor(STAIR.x1, x1, z0, z1, 0, top - 1);
  for (const [a, b] of [[z0, STAIR.z0], [STAIR.z1, z1]]) {
    k.floor(STAIR.x0, STAIR.x1, a, b, 0, top - 1);
    k.floor(x0, STAIR.x0, a, b, 0, UP - 0.6);
  }
  k.flat('marble', x0, x1, z0, z1, 0.01, 0xf2ebe0, 3);
  floorStar(k, 104, ZC);

  const bay = (x1 - x0) / 4;
  const bays = [0, 1, 2, 3].map((i) => x0 + bay * (i + 0.5));
  for (const [z, nz] of [[z0, 1], [z1, -1]] as const) {
    const arches = bays.slice(1).map((c) => hole(c - 2.2, c + 2.2, 0, 5.4));
    const door = hole(bays[0] - 1.1, bays[0] + 1.1, 0, 3.4, 'flat');
    const windows = bays.map((c) => hole(c - 1.8, c + 1.8, 13, 21));
    k.wallZ('marble', z, x0, x1, 0, top, nz, [...arches, door, ...windows], CREAM, 3);
    for (const a of arches) {
      k.reveal('marble', a, true, nz > 0 ? z - 2.6 : z, 2.6, CREAM, 3);
      shop(k, (a.a + a.b) / 2, z, nz);
    }
    k.reveal('marble', door, true, nz > 0 ? z - 0.4 : z, 0.4, CREAM, 3);
    k.quad('solid', [bays[0], 1.7, z - nz * 0.38], [1.1, 0, 0], [0, 1.7, 0], [0, 0, nz], 0x4a3020);
    for (const w of windows) {
      k.reveal('marble', w, true, nz > 0 ? z - 0.8 : z, 0.8, CREAM, 3);
      tallWindow(k, (w.a + w.b) / 2, z - nz * 0.75, nz);
    }
    for (let i = 0; i <= 4; i++) {
      const x = x0 + bay * i, w = i === 0 || i === 4 ? 1.2 : 1.6;
      pilaster(k, x, z + nz * 0.2, w, 0.4, i % 2 ? RED_MARBLE : GREEN_MARBLE);
    }
    k.box('shiny', (x0 + x1) / 2, z + nz * 0.25, 11, x1 - x0, 0.5, 0.45, GOLD);
    k.box('marble', (x0 + x1) / 2, z + nz * 0.08, 0, x1 - x0, 0.16, 1.1, BLACK_MARBLE);
  }
  const east = hole(-6, 7.5, 0, 10);
  k.wallX('marble', x1, z0, z1, 0, top, -1, [east], CREAM, 3);
  k.solidWall('shiny', x1 - 0.15, 0, 0, -1, 0, archRing(east, 0.6, 1), [], 0.3, GOLD);
  const west = hole(PASS.z0, PASS.z1, UP, PASS.spring);
  k.wallX('marble', x0, z0, z1, 0, top, 1, [west], CREAM, 3);
  k.solidWall('shiny', x0 + 0.15, 0, 0, 1, 0, archRing(west, 0.7, -1), [], 0.3, GOLD);
  for (const [x, arch] of [[x0, west], [x1, east]] as const) {
    const nx = x === x0 ? 1 : -1;
    for (const z of [z0 + 1.6, z1 - 1.6]) pilasterX(k, x + nx * 0.2, z, 1.6, 0.4, RED_MARBLE);
    for (const [a, b] of [[z0, arch.a - 0.8], [arch.b + 0.8, z1]]) k.box('shiny', x + nx * 0.25, (a + b) / 2, 11, 0.5, b - a, 0.45, GOLD);
  }
  clock(k, x0 + 0.3, 25, ZC, 1.9);

  k.box('marble', (x0 + STAIR.x0) / 2, ZC, UP - 0.45, STAIR.x0 - x0, z1 - z0, 0.45, 0xefe6d6);
  k.level = 1;
  k.floor(x0, STAIR.x0, z0, z1, UP, top - UP - 1);
  k.flat('marble', x0, STAIR.x0, z0, z1, UP + 0.01, 0xf2ebe0, 3);
  for (const [a, b] of [[z0, STAIR.z0], [STAIR.z1, z1]]) parapetZ(k, STAIR.x0 - 0.2, a, b, UP);
  k.level = 0;
  for (const z of [z0 + 3.5, z1 - 3.5]) {
    k.cyl('marble', STAIR.x0 - 0.5, 0, z, 0.35, UP - 0.45, RED_MARBLE);
    k.block(STAIR.x0 - 0.5, z, 0.7, 0.7, true);
  }

  k.box('shiny', (x0 + x1) / 2, z0 + 0.3, top - 0.6, x1 - x0, 0.6, 0.6, GOLD);
  k.box('shiny', (x0 + x1) / 2, z1 - 0.3, top - 0.6, x1 - x0, 0.6, 0.6, GOLD);
  k.box('shiny', x0 + 0.3, ZC, top - 0.6, 0.6, z1 - z0, 0.6, GOLD);
  k.box('shiny', x1 - 0.3, ZC, top - 0.6, 0.6, z1 - z0, 0.6, GOLD);
  const ring: [number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ring.push([DOME.x + Math.cos(a) * DOME.r, DOME.z + Math.sin(a) * DOME.r]);
  }
  k.shape('marble', [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [ring], new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)).setPosition(0, top, 0), 0xe8dcc6, 3);
  const drumTop = top + 6, dome = drumTop + 0.6;
  k.lathe('marble', DOME.x, DOME.z, [[DOME.r, top], [DOME.r, drumTop], [DOME.r - 0.5, dome]], 0xe4d6bc);
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    k.geom('glow', new THREE.PlaneGeometry(3, 4.2), at(DOME.x + c * (DOME.r - 0.06), top + 3, DOME.z + s * (DOME.r - 0.06), 1, 1, 1, -a - Math.PI / 2), DAY_HEX);
    k.bar('shiny', [DOME.x + c * (DOME.r - 0.1), top + 1.2, DOME.z + s * (DOME.r - 0.1)], [DOME.x + c * (DOME.r - 0.1), top + 4.8, DOME.z + s * (DOME.r - 0.1)], 0.12, 0.12, IRON);
    k.lamp(DOME.x + c * 9, top + 3, DOME.z + s * 9, 22, DAY, 22);
  }
  const R = DOME.r - 0.5, profile: [number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * (Math.PI / 2 - 0.2);
    profile.push([R * Math.cos(a), dome + R * Math.sin(a)]);
  }
  k.lathe('plaster', DOME.x, DOME.z, profile, 0xe8dfcc);
  const apex = profile[profile.length - 1];
  k.lathe('glow', DOME.x, DOME.z, [[apex[0], apex[1]], [0, apex[1] + 0.6]], 0xfff6e2);
  for (let m = 0; m < 16; m++) {
    const a = (m / 16) * Math.PI * 2;
    for (let i = 0; i + 1 < profile.length; i++) {
      const [ra, ya] = profile[i], [rb, yb] = profile[i + 1];
      k.bar('shiny', [DOME.x + Math.cos(a) * (ra - 0.12), ya, DOME.z + Math.sin(a) * (ra - 0.12)], [DOME.x + Math.cos(a) * (rb - 0.12), yb, DOME.z + Math.sin(a) * (rb - 0.12)], m % 2 ? 0.14 : 0.3, 0.2, GOLD);
    }
  }
  for (const i of [4, 8, 11]) {
    const [r, y] = profile[i];
    for (let s = 0; s < 32; s++) {
      const a0 = (s / 32) * Math.PI * 2, a1 = ((s + 1) / 32) * Math.PI * 2;
      k.bar('shiny', [DOME.x + Math.cos(a0) * (r - 0.15), y, DOME.z + Math.sin(a0) * (r - 0.15)], [DOME.x + Math.cos(a1) * (r - 0.15), y, DOME.z + Math.sin(a1) * (r - 0.15)], 0.16, 0.16, GOLD);
    }
  }
  k.lamp(DOME.x, apex[1] - 2, DOME.z, 30, 0xfff2dc, 30);

  for (const z of [STAIR.z0 - 0.6, STAIR.z1 + 0.6]) lampStandard(k, STAIR.x1 + 0.6, z);
  for (const x of bays) for (const [z, nz] of [[z0, 1], [z1, -1]] as const) sconce(k, x + 2.7, z + nz * 0.45, nz);

  for (const [x, z, fx, fz] of [[103, -9, 0, -1], [104, -10.5, -0.5, -1], [105.5, 12, 0, 1], [91, 12.3, 0, 1], [92.5, -9.8, 0, -1], [97.5, 12.4, 0, 1],
    [102, 3, -1, 0], [101.6, 4, -1, 0.3], [106, -4, -1, 0], [88, -10, 1, 0], [84, 13.5, 1, -0.3], [84.6, -11, 1, 0.4], [99, -6.5, 0.6, -1]] as const) k.person(x, z, fx, fz);
  k.walker([[107, -11], [101, -11], [101, 14], [107, 14]], 0, 1.2);
  for (const [x, z, fx, fz] of [[84, -2, 1, 0], [84.5, 9, 0, 1], [83.5, -10, 1, 0.5], [85, 13.5, 1, 0]] as const) {
    k.level = 1;
    k.person(x, z, fx, fz, UP);
    k.level = 0;
  }
}

/** The ring of a round arch, w wide, in a wall's u (= sign × the coordinate along it). */
function archRing(h: Hole, w: number, sign: number): [number, number][] {
  const outer: [number, number][] = [], inner: [number, number][] = [];
  const steps = 16, c = (h.a + h.b) / 2, r = (h.b - h.a) / 2;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI;
    outer.push([sign * (c + Math.cos(t) * (r + w)), h.spring + Math.sin(t) * (r + w)]);
    inner.push([sign * (c + Math.cos(t) * r), h.spring + Math.sin(t) * r]);
  }
  return [...outer, ...inner.reverse()];
}

function floorStar(k: HallKit, x: number, z: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = i % 2 ? 1.1 : 2.6;
    pts.push([x + Math.cos(a) * r, -(z + Math.sin(a) * r)]);
  }
  k.shape('solid', pts, [], new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)).setPosition(0, 0.02, 0), 0x6e2e26);
  k.geom('solid', CYL, at(x, 0.021, z, 1.0, 0.004, 1.0), 0xd8c7a0);
}

function pilaster(k: HallKit, x: number, z: number, w: number, d: number, colour: number) {
  k.box('marble', x, z, 1.1, w, d, 9.4, colour);
  k.box('shiny', x, z, 10.5, w + 0.2, d + 0.1, 0.5, GOLD);
  k.box('marble', x, z, 11.45, w * 0.8, d * 0.9, 14.6, colour);
  k.box('shiny', x, z, 26, w, d + 0.1, 0.8, GOLD);
}

function pilasterX(k: HallKit, x: number, z: number, w: number, d: number, colour: number) {
  k.box('marble', x, z, 1.1, d, w, 9.4, colour);
  k.box('shiny', x, z, 10.5, d + 0.1, w + 0.2, 0.5, GOLD);
  k.box('marble', x, z, 11.45, d * 0.9, w * 0.8, 14.6, colour);
  k.box('shiny', x, z, 26, d + 0.1, w, 0.8, GOLD);
}

function tallWindow(k: HallKit, x: number, z: number, nz: number) {
  k.quad('glow', [x, 17, z], [1.8, 0, 0], [0, 4, 0], [0, 0, nz], DAY_HEX);
  k.geom('glow', new THREE.CircleGeometry(1.8, 16, 0, Math.PI), at(x, 21, z, 1, 1, 1, nz > 0 ? 0 : Math.PI), DAY_HEX);
  for (const dx of [-0.6, 0.6]) k.box('solid', x + dx, z + nz * 0.03, 13, 0.08, 0.06, 8 + Math.sqrt(1.8 ** 2 - dx * dx), IRON);
  for (const y of [15.5, 18, 20.5]) k.box('solid', x, z + nz * 0.03, y, 3.6, 0.06, 0.08, IRON);
  k.lamp(x, 17, z + nz * 3, 12, DAY, 14);
}

const SHOPS: [string, string, string, number][] = [
  ['Bakkerij', '#7a1e1e', '#f6e3c0', 0xffe0b0], ['Dagbladhandel', '#1b4f9c', '#ffffff', 0xf2f6ff], ['Koffie', '#2b2118', '#e8c890', 0xffd9a0],
  ['Bloemen', '#2f5d3a', '#f4ecd8', 0xf6fff0], ['Chocolatier', '#3b2416', '#e8c070', 0xffe2b8], ['Wafels', '#c8102e', '#ffffff', 0xfff0d8],
];
let shopIndex = 0;

function shop(k: HallKit, x: number, z: number, nz: number) {
  const [name, bg, fg, light] = SHOPS[shopIndex++ % SHOPS.length];
  const back = z - nz * 2.55;
  k.flat('marble', x - 2.2, x + 2.2, Math.min(z, back), Math.max(z, back), 0.01, 0xe8dccb, 3);
  k.quad('glow', [x, 2.2, back], [2.1, 0, 0], [0, 2.2, 0], [0, 0, nz], light);
  k.box('solid', x, back + nz * 0.5, 0, 3.6, 0.6, 1.0, 0x3a2a1e);
  for (let i = 0; i < 6; i++) k.box('solid', x - 1.5 + i * 0.6, back + nz * 0.35, 1.0, 0.3, 0.25, 0.18 + k.r() * 0.12, [0xc0392b, 0xf1c40f, 0xe8d8b0, 0x6d4c41][i % 4]);
  k.person(x + (k.r() - 0.5), back + nz * 1.3, 0, nz);
  k.sheet(x, 4.7, z - nz * 0.03, 3.6, 0.55, nz > 0 ? 0 : Math.PI, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitFont(g, "italic 700 {s}px Georgia, 'Times New Roman', serif", name, w * 0.85, Math.round(h * 0.62));
    g.fillText(name, w / 2, h * 0.54);
  }, true, `centraal-shop-${name}`);
  k.lamp(x, 3, back + nz * 1.4, 4, WARM, 6);
}

function lampStandard(k: HallKit, x: number, z: number) {
  k.cyl('shiny', x, 0, z, 0.45, 0.6, 0x5a4a2a);
  k.cyl('shiny', x, 0.6, z, 0.16, 3.6, 0x6a5630);
  k.block(x, z, 0.9, 0.9, true);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2, r = i === 4 ? 0 : 0.45, y = i === 4 ? 4.75 : 4.3;
    if (i < 4) k.bar('shiny', [x, 4.0, z], [x + Math.cos(a) * r, y, z + Math.sin(a) * r], 0.05, 0.05, 0x6a5630);
    k.geom('glow', BALL, at(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0.2, 0.2, 0.2), 0xfff0d0);
  }
  k.lamp(x, 4.4, z, 18, WARM, 14);
}

function sconce(k: HallKit, x: number, z: number, nz: number, y = 0) {
  k.box('shiny', x, z, y + 4.2, 0.12, 0.3, 0.12, GOLD);
  k.geom('glow', BALL, at(x, y + 4.45, z + nz * 0.15, 0.14, 0.18, 0.14), 0xffe6b8);
}

function clock(k: HallKit, x: number, y: number, z: number, r: number) {
  k.geom('shiny', CYL, at(x + 0.1, y, z, r + 0.25, 0.2, r + 0.25, 0, 0, Math.PI / 2), GOLD);
  k.sheet(x + 0.22, y, z, r * 2, r * 2, Math.PI / 2, (g, w, h) => {
    g.fillStyle = '#f6f1e4';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1e1e1e';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(h * 0.11)}px Georgia, serif`;
    const romans = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    romans.forEach((t, i) => {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      g.fillText(t, w / 2 + Math.cos(a) * w * 0.38, h / 2 + Math.sin(a) * h * 0.38);
    });
    g.strokeStyle = '#1e1e1e';
    g.lineCap = 'round';
    for (const [len, a, lw] of [[0.24, -Math.PI / 2 + 0.6, 0.03], [0.36, -Math.PI / 2 + 4.1, 0.018]]) {
      g.lineWidth = w * lw;
      g.beginPath();
      g.moveTo(w / 2, h / 2);
      g.lineTo(w / 2 + Math.cos(a) * w * len, h / 2 + Math.sin(a) * h * len);
      g.stroke();
    }
  }, true, 'centraal-clock');
  k.lamp(x + 3, y, z, 6, WARM, 8);
}

function parapetZ(k: HallKit, x: number, z0: number, z1: number, y: number) {
  k.box('marble', x, (z0 + z1) / 2, y, 0.35, z1 - z0, 1.0, 0xe6dccb);
  k.box('shiny', x, (z0 + z1) / 2, y + 1.0, 0.45, z1 - z0, 0.08, GOLD);
}

function stair(k: HallKit) {
  const { x0, x1, z0, z1 } = STAIR, n = 40, run = (x1 - x0) / n, rise = UP / n;
  k.floor(x0, x1, z0, z1, 0, 20, { to: [x0, ZC], rise: UP, link: [0, 1] });
  for (let i = 0; i < n; i++) {
    const x = x1 - (i + 0.5) * run;
    k.box('marble', x, (z0 + z1) / 2, i * rise - 0.4, run, z1 - z0, rise + 0.4, i % 10 === 9 ? 0xe2d6c2 : 0xefe7da);
    k.box('solid', x - run / 2 + 0.03, (z0 + z1) / 2, (i + 1) * rise - 0.004, 0.06, z1 - z0 - 0.6, 0.006, 0x8a2e2a);
  }
  for (let i = 0; i < n; i++) {
    const x = x1 - (i + 0.5) * run;
    k.box('solid', x, (z0 + z1) / 2, (i + 1) * rise, run, 4, 0.008, 0x8e2a26);
  }
  for (const [z, nz] of [[z0, -1], [z1, 1]] as const) {
    const outline: [number, number][] = [[x1, 0], [x0, 0], [x0, UP + 1.1], [x1, 1.1]];
    k.solidWall('marble', 0, 0, z + nz * 0.2, 0, nz, outline.map(([x, y]) => [nz * x, y]), [], 0.4, 0xe6dccb);
    k.bar('shiny', [x1, 1.15, z], [x0, UP + 1.15, z], 0.12, 0.5, GOLD);
  }
}

function passage(k: HallKit) {
  const { x0, x1, z0, z1, spring } = PASS;
  k.level = 1;
  k.floor(x0, x1, z0, z1, UP, 16);
  k.flat('marble', x0, x1, z0, z1, UP + 0.01, 0xf2ebe0, 3);
  for (let x = x0 + 1.5; x < x1; x += 3) k.flat('solid', x, x + 0.1, z0, z1, UP + 0.015, 0x6b5a4a);
  k.wallZ('ashlar', z0, x0, x1, UP, spring, 1, [], BEIGE, 2.4);
  k.wallZ('ashlar', z1, x0, x1, UP, spring, -1, [], BEIGE, 2.4);
  const profile = vaultProfile(z0, z1, spring, 'round', 20);
  k.vault('plaster', x0, x1, profile, 0xece2d0);
  for (let x = x0 + 1.5; x < x1; x += 3) {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [za, ya] = profile[i], [zb, yb] = profile[i + 1];
      k.bar('shiny', [x, ya - 0.1, za + (za < ZC ? 0.1 : -0.1)], [x, yb - 0.1, zb + (zb < ZC ? 0.1 : -0.1)], 0.25, 0.2, GOLD);
    }
  }
  for (let x = x0 + 3; x < x1 - 1; x += 6) {
    for (const [z, nz] of [[z0, 1], [z1, -1]] as const) {
      sconce(k, x, z + nz * 0.15, nz, UP);
      k.lamp(x, 4.5 + UP, z + nz * 2, 8, WARM, 10);
      k.box('marble', x - 1.5, z + nz * 0.06, UP, 1.0, 0.12, 7, RED_MARBLE);
    }
  }
  for (const [x, z, fx, fz] of [[75, -6.5, 0, 1], [70, 9.5, 0, -1], [66, -3, -1, 0], [78, 4, 1, 0.2]] as const) k.person(x, z, fx, fz, UP);
  k.walker([[82, -4], [45, -4], [45, -3], [82, -3]], UP, 1.4);
  k.walker([[45, 6], [83, 5], [83, 6], [45, 7]], UP, 1.3);
  k.level = 0;
}

function trainHall(k: HallKit) {
  const { x0, x1, z0, z1, spring, rise } = TH;
  k.level = 1;
  const head = 30;
  k.floor(CONCOURSE, x1, z0, z1, UP, head);
  for (const [a, b] of PLATFORMS) k.floor(PLAT_END, CONCOURSE, a, b, UP, head);
  k.floor(VOID.x1, CONCOURSE, VOID.z0, VOID.z1, UP, head);
  k.floor(PLAT_END, VOID.x0, VOID.z0, VOID.z1, UP, head);
  k.level = 0;

  const profile = vaultProfile(z0, z1, spring, 'round', 28, rise);
  for (let i = 0; i + 1 < profile.length; i++) k.vault('glow', x0, x1, [profile[i], profile[i + 1]], i % 2 ? GLASS_SKY : 0xd6e0e8);
  for (let x = x1 - 2; x > x0; x -= 11) {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [za, ya] = profile[i], [zb, yb] = profile[i + 1];
      const inA = za < ZC ? 0.35 : -0.35, inB = zb < ZC ? 0.35 : -0.35;
      k.bar('solid', [x, ya - 0.3, za + inA * 0.3], [x, yb - 0.3, zb + inB * 0.3], 0.35, 0.8, IRON);
    }
  }
  for (let i = 1; i + 1 < profile.length; i += 2) {
    const [z, y] = profile[i];
    k.bar('solid', [x0, y - 0.12, z + (z < ZC ? 0.12 : -0.12)], [x1, y - 0.12, z + (z < ZC ? 0.12 : -0.12)], 0.12, 0.16, IRON);
  }
  for (const [z, nz] of [[z0, 1], [z1, -1]] as const) {
    const windows: Hole[] = [];
    for (let x = x1 - 8; x > x0 + 4; x -= 11) windows.push(hole(x - 2, x + 2, 7, 9.6));
    k.wallZ('ashlar', z, x0, x1, BED, spring, nz, windows, 0xc9b49a, 2.4);
    for (const w of windows) {
      k.reveal('ashlar', w, true, nz > 0 ? z - 0.5 : z, 0.5, 0xc9b49a, 2.4);
      k.quad('glow', [(w.a + w.b) / 2, 8.3, z - nz * 0.48], [2, 0, 0], [0, 1.3, 0], [0, 0, nz], DAY_HEX);
      k.geom('glow', new THREE.CircleGeometry(2, 12, 0, Math.PI), at((w.a + w.b) / 2, 9.6, z - nz * 0.48, 1, 1, 1, nz > 0 ? 0 : Math.PI), DAY_HEX);
    }
    k.box('solid', (x0 + x1) / 2, z + nz * 0.2, spring - 0.6, x1 - x0, 0.4, 0.6, IRON);
  }
  const section: [number, number][] = [[z0, BED], [z1, BED], ...profile.slice().reverse().map(([z, y]) => [z, y] as [number, number])];
  k.wall('glow', x0, 0, 0, 1, 0, section.map(([z, y]) => [-z, y]), [], 0xdfe8f0);
  for (let z = z0 + 6; z < z1; z += 6) k.box('solid', x0 + 0.15, z, BED, 0.25, 0.25, profileAt(profile, z) - BED, IRON);
  for (const y of [12, 20, 28, 36]) {
    const half = halfWidthAt(profile, y);
    if (half > 0) k.box('solid', x0 + 0.15, ZC, y, 0.25, half * 2, 0.25, IRON);
  }
  k.lamp(x0 + 6, 20, ZC, 60, DAY, 40);
  const arch = hole(PASS.z0, PASS.z1, UP, PASS.spring);
  k.wall('ashlar', x1, 0, 0, -1, 0, section.map(([z, y]) => [z, Math.max(y, UP)] as [number, number]),
    [[[arch.a, arch.y0], [arch.b, arch.y0], ...archTop(arch)]], 0xd3c3a8, 2.4);
  k.solidWall('shiny', x1 - 0.15, 0, 0, -1, 0, archRing(arch, 0.7, 1), [], 0.3, GOLD);
  clockFace(k, x1 - 0.3, 26.5, ZC, 2.2);
  departures(k, x1 - 0.1, 15, -21, 'VERTREK  DÉPART', 0);
  departures(k, x1 - 0.1, 15, 24, 'VERTREK  DÉPART', 1);

  k.flat('tiles', CONCOURSE, x1, z0, z1, UP + 0.01, 0xbdb8ae, 1.2);
  k.flat('tiles', VOID.x1, CONCOURSE, VOID.z0, VOID.z1, UP + 0.01, 0xbdb8ae, 1.2);
  k.flat('tiles', PLAT_END, VOID.x0, VOID.z0, VOID.z1, UP + 0.01, 0xbdb8ae, 1.2);
  for (const z of TRACKS) {
    k.quad('solid', [CONCOURSE, (BED + UP) / 2, z], [0, 0, 2.25], [0, (UP - BED) / 2, 0], [-1, 0, 0], 0x8a857c);
    k.box('solid', BUFFER, z, BED, 0.8, 3, 1.3, 0x3a3d40);
    k.box('solid', BUFFER - 0.45, z, RAIL + 0.6, 0.12, 2.6, 0.35, 0xc8102e);
    for (const s of [-0.8, 0.8]) k.cyl('shiny', BUFFER - 0.55, RAIL + 0.55, z + s, 0.2, 0.3, 0x9a9da0);
  }
  for (const [a, b, label] of PLATFORMS) platform(k, a, b, label);
  for (const z of TRACKS) track(k, z, BED, x0 + 1, BUFFER - 0.3);
  for (let x = x1 - 20; x > x0 + 5; x -= 44) {
    k.box('solid', x, ZC, 13.5, 0.4, z1 - z0, 0.5, IRON);
    for (const z of TRACKS) k.box('solid', x - 22, z, RAIL + 5.4, 44, 0.03, 0.03, 0x222222);
  }
  train(k, BUFFER - 1.2, TRACKS[1], RAIL, 5);
  train(k, BUFFER - 1.2, TRACKS[3], RAIL, 4);
  train(k, BUFFER - 1.2, TRACKS[5], RAIL, 5);
  theVoid(k);

  for (let x = x1 - 10; x > x0; x -= 26) {
    for (const z of [-24, -9, 12, 27]) {
      k.box('solid', x, z, UP + 6.3, 0.03, 0.03, 4, 0x222222);
      k.box('solid', x, z, UP + 5.9, 1.4, 0.5, 0.4, 0x2a2e33);
      k.box('glow', x, z, UP + 5.88, 1.3, 0.4, 0.02, 0xfff6e8);
      k.lamp(x, UP + 5.5, z, 30, 0xfff4e4, 18, true);
    }
    k.lamp(x, 34, ZC, 50, DAY, 40);
  }

  k.level = 1;
  for (const [a, b] of PLATFORMS) {
    if (b - a < 3) continue;
    for (let i = 0; i < 9; i++) {
      const x = 30 - k.r() * 120, z = a + 0.9 + k.r() * (b - a - 1.8);
      if (x < VOID.x1 && x > VOID.x0 && (a === VOID.z1 || b === VOID.z0) && Math.abs(z - (a === VOID.z1 ? a : b)) < 1) continue;
      k.person(x, z, k.r() < 0.5 ? 0.2 : -0.2, z < ZC ? -1 : 1, UP);
    }
    if (b - a > 6) for (const x of [10, -30, -70]) bench(k, x, (a + b) / 2, UP);
  }
  for (let i = 0; i < 16; i++) k.person(CONCOURSE + 2 + k.r() * 18, z0 + 2 + k.r() * (z1 - z0 - 4), k.r() - 0.5, k.r() - 0.5, UP);
  k.level = 0;
  for (const [a, b] of PLATFORMS) {
    if (b - a < 4) continue;
    const z = (a + b) / 2;
    k.walker([[54, z - 1], [PLAT_END + 30, z - 1], [PLAT_END + 30, z + 0.2], [54, z + 0.2]], UP, 1.3);
  }
  k.walker([[58, -30], [40, 30], [41, 31], [59, -29]], UP, 1.25);
}

function archTop(h: Hole): [number, number][] {
  const out: [number, number][] = [], r = (h.b - h.a) / 2, c = (h.a + h.b) / 2;
  for (let i = 0; i <= 16; i++) {
    const t = (i / 16) * Math.PI;
    out.push([c + Math.cos(t) * r, h.spring + Math.sin(t) * r]);
  }
  return out;
}

function halfWidthAt(profile: [number, number][], y: number): number {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i + 1 < profile.length; i++) {
    const [za, ya] = profile[i], [zb, yb] = profile[i + 1];
    if ((y - ya) * (y - yb) <= 0 && ya !== yb) {
      const z = za + ((y - ya) / (yb - ya)) * (zb - za);
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
    }
  }
  return hi > lo ? (hi - lo) / 2 - 0.3 : 0;
}

function clockFace(k: HallKit, x: number, y: number, z: number, r: number) {
  k.geom('solid', CYL, at(x, y, z, r + 0.3, 0.3, r + 0.3, 0, 0, Math.PI / 2), IRON);
  k.sheet(x - 0.17, y, z, r * 2, r * 2, -Math.PI / 2, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, big = i % 5 === 0;
      g.save();
      g.translate(w / 2 + Math.cos(a) * w * 0.43, h / 2 + Math.sin(a) * h * 0.43);
      g.rotate(a);
      g.fillRect(-w * (big ? 0.04 : 0.015), -w * (big ? 0.012 : 0.005), w * (big ? 0.08 : 0.03), w * (big ? 0.024 : 0.01));
      g.restore();
    }
    g.strokeStyle = '#111';
    g.lineCap = 'butt';
    for (const [len, a, lw] of [[0.26, 1.2, 0.035], [0.4, -2.0, 0.025]]) {
      g.lineWidth = w * lw;
      g.beginPath();
      g.moveTo(w / 2, h / 2);
      g.lineTo(w / 2 + Math.cos(a) * w * len, h / 2 + Math.sin(a) * h * len);
      g.stroke();
    }
    g.strokeStyle = '#c8102e';
    g.lineWidth = w * 0.01;
    g.beginPath();
    g.moveTo(w / 2, h / 2);
    g.lineTo(w / 2 + Math.cos(0.3) * w * 0.4, h / 2 + Math.sin(0.3) * h * 0.4);
    g.stroke();
  }, true, 'centraal-hall-clock');
}

const DEPARTURES: [string, string, string, string][][] = [
  [['10:04', 'IC', 'Brussel-Zuid', '3'], ['10:07', 'IC', 'Gent-Sint-Pieters', '22'], ['10:12', 'L', 'Lier', '5'], ['10:16', 'EUR', 'Amsterdam Centraal', '23'],
    ['10:21', 'IC', 'Leuven', '1'], ['10:25', 'IC', 'Mechelen', '2'], ['10:33', 'S', 'Essen', '21']],
  [['10:35', 'IC', 'Hasselt', '6'], ['10:38', 'IC', 'Liège-Guillemins', '4'], ['10:41', 'IC', 'Roosendaal', '24'], ['10:46', 'IC', 'Brussels Airport', '22'],
    ['10:52', 'L', 'Turnhout', '5'], ['10:55', 'IC', 'Oostende', '3'], ['11:04', 'IC', 'Charleroi-Zuid', '1']],
];

function departures(k: HallKit, x: number, y: number, z: number, title: string, which: number) {
  k.box('solid', x + 0.15, z, y - 3.2, 0.3, 12.4, 6.4, 0x15181c);
  k.sheet(x - 0.02, y, z, 12, 6, -Math.PI / 2, (g, w, h) => {
    g.fillStyle = '#0d1c3a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = BLUE;
    g.fillRect(0, 0, w, h * 0.14);
    g.fillStyle = '#ffffff';
    g.font = `700 ${Math.round(h * 0.08)}px 'Helvetica Neue', Arial, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(title, w * 0.03, h * 0.075);
    g.textAlign = 'right';
    g.fillText('Spoor  Voie', w * 0.97, h * 0.075);
    DEPARTURES[which].forEach(([time, kind, to, track], i) => {
      const yy = h * (0.22 + i * 0.112);
      g.textAlign = 'left';
      g.fillStyle = '#ffd200';
      g.font = `700 ${Math.round(h * 0.07)}px 'Helvetica Neue', Arial, sans-serif`;
      g.fillText(time, w * 0.03, yy);
      g.fillStyle = '#9fc4ee';
      g.fillText(kind, w * 0.17, yy);
      g.fillStyle = '#ffffff';
      g.fillText(to, w * 0.27, yy);
      g.textAlign = 'right';
      g.fillStyle = '#ffd200';
      g.fillText(track, w * 0.95, yy);
    });
  }, true, `centraal-departures-${which}`);
}

function platform(k: HallKit, a: number, b: number, label: string) {
  const len = CONCOURSE - PLAT_END, cx = (PLAT_END + CONCOURSE) / 2, w = b - a;
  k.box('solid', cx, (a + b) / 2, BED, len, w, UP - BED - 0.01, 0x8a857c);
  k.flat('tiles', PLAT_END, CONCOURSE, a, b, UP + 0.01, 0xbdb8ae, 1.2);
  for (const [edge, s] of [[a, 1], [b, -1]] as const) {
    if (edge <= TH.z0 + 0.1 || edge >= TH.z1 - 0.1) continue;
    const onVoid = edge === VOID.z0 || edge === VOID.z1;
    k.box('solid', cx, edge + s * 0.25, UP + 0.012, len, 0.5, 0.004, 0xe8e4da);
    if (!onVoid) k.box('solid', cx, edge + s * 0.7, UP + 0.012, len, 0.08, 0.004, 0xf2c230);
  }
  if (w < 3) return;
  const mid = (a + b) / 2;
  for (const x of [CONCOURSE - 3, 0, -60]) {
    k.box('solid', x, mid, UP, 0.12, 0.12, 4.4, 0x2a2e33);
    k.block(x, mid, 0.3, 0.3);
    for (const yaw of [Math.PI / 2, -Math.PI / 2]) {
      k.sheet(x, UP + 4.6, mid, 1.6, 0.9, yaw, (g, W, H) => {
        g.fillStyle = BLUE;
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        fitFont(g, "700 {s}px 'Helvetica Neue', Arial, sans-serif", label, W * 0.86, Math.round(H * 0.72));
        g.fillText(label, W / 2, H * 0.54);
      }, true, `centraal-platform-${label}`);
    }
  }
}

function bench(k: HallKit, x: number, z: number, y: number) {
  k.box('solid', x, z, y + 0.42, 2.4, 0.5, 0.06, 0x5a6a78);
  k.box('solid', x, z + 0.22, y + 0.48, 2.4, 0.06, 0.4, 0x5a6a78);
  for (const e of [-1, 1]) k.box('solid', x + e * 1.05, z, y, 0.08, 0.45, 0.42, 0x2a2a2a);
  k.block(x, z, 2.4, 0.5);
  for (const dx of [-0.7, 0.4]) if (k.r() < 0.6) k.person(x + dx, z, 0, -1, y, 'moped');
}

function track(k: HallKit, z: number, bed: number, x0: number, x1: number) {
  const cx = (x0 + x1) / 2, len = x1 - x0;
  k.flat('concrete', x0, x1, z - 2.25, z + 2.25, bed, 0x7a7368, 2);
  for (let x = x0 + 0.3; x < x1; x += 0.65) k.box('solid', x, z, bed, 0.24, 2.5, 0.14, 0x8a857a);
  for (const s of [-0.72, 0.72]) k.box('shiny', cx, z + s, bed + 0.14, len, 0.07, 0.13, 0x8c8a86);
}

/** A double-deck push-pull set in NMBS/SNCB colours, cab end at `front`, running back along -x. */
function train(k: HallKit, front: number, z: number, rail: number, cars: number) {
  const len = 26.4, gap = 0.6, w = 2.84, white = 0xf1f2ef, blue = 0x1d3f86, yellow = 0xf2c230;
  for (let i = 0; i < cars; i++) {
    const x1 = front - i * (len + gap), x0 = x1 - len, cab = i === 0, bx0 = x0, bx1 = cab ? x1 - 2.2 : x1, cx = (bx0 + bx1) / 2;
    for (const bx of [x0 + 3.2, x1 - 3.2]) k.box('solid', bx, z, rail, 3.2, 2.5, 0.9, 0x232527);
    k.box('solid', cx, z, rail + 0.5, bx1 - bx0, w, 4.15, white);
    k.box('solid', cx, z, rail + 0.5, bx1 - bx0 + 0.01, w + 0.01, 0.55, blue);
    k.box('solid', cx, z, rail + 4.6, bx1 - bx0 - 0.4, w - 0.3, 0.12, 0xa8acb0);
    for (const s of [-1, 1]) {
      for (const y of [rail + 1.25, rail + 2.95]) k.box('shiny', cx, z + s * (w / 2 + 0.006), y, bx1 - bx0 - 1.6, 0.012, 0.95, 0x24303a);
      for (const dx of [x0 + 5.2, x1 - 5.2]) if (dx < bx1 - 0.8) k.box('solid', dx, z + s * (w / 2 + 0.012), rail + 0.55, 1.3, 0.012, 2.2, yellow);
    }
    if (cab) {
      k.box('solid', x1 - 1.1, z, rail + 0.5, 2.2, w, 2.7, yellow);
      k.solidWall('shiny', x1 - 2.2, rail + 3.2, z + w / 2, 0, 1, [[0, 0], [2.2, 0], [0, 1.45]], [], w, 0x1c252e);
      k.box('solid', x1 - 2.25, z, rail + 3.2, 0.05, w, 1.45, white);
      for (const s of [-0.9, 0.9]) k.geom('glow', BALL, at(x1 + 0.01, rail + 1.4, z + s, 0.12, 0.12, 0.05), 0xfff6e0);
    }
  }
}

function theVoid(k: HallKit) {
  const { x0, x1, z0, z1, bottom } = VOID, cx = (x0 + x1) / 2, len = x1 - x0;
  for (const [z, s] of [[z0, -1], [z1, 1]] as const) {
    k.box('glass', cx, z + s * 0.05, UP, len, 0.04, 1.1, 0xffffff);
    k.box('shiny', cx, z + s * 0.05, UP + 1.08, len, 0.08, 0.06, 0x9a9da0);
  }
  for (const x of [x0, x1]) {
    k.box('glass', x, (z0 + z1) / 2, UP, 0.04, z1 - z0, 1.1, 0xffffff);
    k.box('shiny', x, (z0 + z1) / 2, UP + 1.08, 0.08, z1 - z0, 0.06, 0x9a9da0);
  }
  for (const [z, nz] of [[z0, 1], [z1, -1]] as const) {
    k.panel('concrete', x0, z, x1, z, bottom, UP, [0, nz], 0x8d8a84, 3);
    for (let x = x0 + 6; x < x1 - 4; x += 12) shopfront(k, x, z + nz * 0.02, nz);
    k.box('solid', cx, z + nz * 0.6, -0.4, len, 1.2, 0.4, 0x9a958c);
    k.box('glass', cx, z + nz * 1.15, 0, len, 0.04, 1.1, 0xffffff);
  }
  for (const [x, nx] of [[x0, 1], [x1, -1]] as const) k.panel('concrete', x, z0, x, z1, bottom, UP, [nx, 0], 0x8d8a84, 3);
  // Level −2 at the bottom: an island platform between tracks 22 and 23, a Dutch-bound train on 23.
  const islandZ0 = -2, islandZ1 = 5;
  k.flat('concrete', x0, x1, z0, z1, bottom, 0x6b655c, 2);
  k.box('solid', cx, (islandZ0 + islandZ1) / 2, bottom, len, islandZ1 - islandZ0, 1.1, 0x8a857c);
  k.flat('tiles', x0, x1, islandZ0, islandZ1, bottom + 1.11, 0xb8b3a8, 1.2);
  for (const z of [islandZ0 + 0.3, islandZ1 - 0.3]) k.box('solid', cx, z, bottom + 1.115, len, 0.4, 0.004, 0xe8e4da);
  track(k, -4.25, bottom, x0, x1);
  track(k, 7.25, bottom, x0, x1);
  train(k, x1 - 8, 7.25, bottom + 0.27, 4);
  for (const x of [x0 + 20, cx, x1 - 20]) {
    k.box('solid', x, 1.5, bottom + 1.1, 0.12, 0.12, 3.4, 0x2a2e33);
    for (const [yaw, label] of [[Math.PI / 2, '22  23'], [-Math.PI / 2, '22  23']] as const) {
      k.sheet(x, bottom + 4.6, 1.5, 1.8, 0.9, yaw, (g, W, H) => {
        g.fillStyle = BLUE;
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#fff';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = `700 ${Math.round(H * 0.6)}px 'Helvetica Neue', Arial, sans-serif`;
        g.fillText(label, W / 2, H * 0.54);
      }, true, 'centraal-platform-22');
    }
  }
  for (let x = x0 + 8; x < x1; x += 16) {
    k.box('glow', x, 1.5, bottom + 4.2, 6, 0.3, 0.06, 0xf4f6fa);
    k.lamp(x, bottom + 4, 1.5, 12, 0xf4f6fa, 12);
  }
  for (let i = 0; i < 10; i++) k.person(x0 + 6 + k.r() * (len - 12), islandZ0 + 0.8 + k.r() * 5.4, 0, k.r() < 0.5 ? 1 : -1, bottom + 1.11);
}

const FRONTS: [string, string, string][] = [['DIAMONDS', '#0d0d0d', '#e8d8a8'], ['Bakkerij', '#7a1e1e', '#f6e3c0'], ['Boeken', '#1b3a5c', '#ffffff'], ['Apotheek', '#1f7a3a', '#ffffff'],
  ['Koffie', '#2b2118', '#e8c890'], ['DIAMANT', '#141414', '#d8e2ee'], ['Frituur', '#c8102e', '#ffffff'], ['Supermarkt', '#e2401a', '#ffffff'], ['Bloemen', '#2f5d3a', '#f4ecd8'], ['Juwelen', '#2a1f3a', '#e8d8a8']];
let frontIndex = 0;

function shopfront(k: HallKit, x: number, z: number, nz: number) {
  const [name, bg, fg] = FRONTS[frontIndex++ % FRONTS.length];
  k.quad('glow', [x, 1.8, z], [5, 0, 0], [0, 1.8, 0], [0, 0, nz], name.startsWith('DIAM') ? 0xf0f4ff : 0xfff0dc);
  for (const dx of [-5, -2.5, 0, 2.5, 5]) k.box('solid', x + dx, z + nz * 0.03, 0, 0.1, 0.06, 3.6, 0x2a2a2a);
  k.sheet(x, 4.1, z + nz * 0.04, 6, 0.6, nz > 0 ? 0 : Math.PI, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    fitFont(g, "700 {s}px 'Helvetica Neue', Arial, sans-serif", name, w * 0.8, Math.round(h * 0.6));
    g.fillText(name, w / 2, h * 0.54);
  }, true, `centraal-front-${name}`);
}
