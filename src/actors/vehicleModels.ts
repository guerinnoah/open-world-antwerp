import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uploadFirst } from '../core/instancing';
import { coloured, wrapAngle } from '../core/util';
import { WHEEL_RADIUS, type Vehicle } from './vehicle';

const GLASS = 0x0e1216, BLACK = 0x18191b, CHROME = 0xc7cbcf, HEADLIGHT = 0xdfe6ea, TAIL = 0x7a0b10, AMBER = 0xc77a12;
const PLATE = 0xf2f2f0, PLATE_TEXT = 0x8c1c24; // Belgian plates: red letters on white
const TYRE = 0x1b1b1c, RIM = 0xb9bdc2;
const BLUE = 0x1b3f93, FLUO = 0xcde41c, ALU = 0xb4b9be, WHITE = 0xf2f2f0; // Belgian emergency livery: blue and fluo-yellow blocks
const LAMPS = 600, GLOWS = 160;
const FLASH_HZ = 1.4;
const BEACON_ON = new THREE.Color(0.18, 0.38, 1), BEACON_OFF = new THREE.Color(0x14214a), SIGN = new THREE.Color(0xf1e6bb);

type Pt = [number, number];
type Word = 'POLITIE' | 'TAXI' | 'AMBULANCE' | '112' | 'BRANDWEER';
const WORDS: [Word, string][] = [['POLITIE', '#1b3f93'], ['TAXI', '#141414'], ['AMBULANCE', '#1b3f93'], ['112', '#c3161c'], ['BRANDWEER', '#f4f4f2']];

/** A light box in model space; side ±1 flash in turn when the siren is on, 0 is always lit. */
interface Lamp {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  side: -1 | 0 | 1;
}

interface Kit {
  trim: THREE.BufferGeometry[];
  decals: THREE.BufferGeometry[];
  lamps: Lamp[];
}

interface Profile {
  length: number;
  width: number;
  axles: [number, number];
  wheelRadius: number;
  sill: number;
  belt: number;
  roof: number;
  top: Pt[];
  windows: Pt[];
  pillars: number[];
  windscreen: [Pt, Pt];
  rearWindow: [Pt, Pt];
  doors: number[];
  roofRails?: boolean;
  tumble?: number; // how far the sides lean in above the belt; default 0.16
  lightsY?: [number, number]; // front and rear light height, where the outline's ends are too tall (box bodies)
  extras?: (k: Kit, p: Profile) => void;
}

// City (Clio/Polo), hatch (Golf), estate, sedan (A4/3-series), SUV (Tiguan), van (Transit).
const CITY: Profile = {
  length: 3.95, width: 1.75, axles: [-1.25, 1.22], wheelRadius: 0.31, sill: 0.28, belt: 0.98, roof: 1.44,
  top: [[-1.975, 0.4], [-1.985, 0.88], [-1.9, 1.0], [-1.82, 1.36], [-1.6, 1.44], [0.05, 1.44], [0.3, 1.4], [0.9, 0.97], [1.55, 0.86], [1.9, 0.76], [1.975, 0.4]],
  windows: [[-1.62, 1.03], [-1.48, 1.34], [0.22, 1.36], [0.82, 1.02]],
  pillars: [-1.2, -0.38],
  windscreen: [[0.9, 0.97], [0.3, 1.4]], rearWindow: [[-1.9, 1.0], [-1.82, 1.36]],
  doors: [-0.42, 0.62],
};
const HATCH: Profile = {
  length: 4.25, width: 1.79, axles: [-1.33, 1.3], wheelRadius: 0.33, sill: 0.3, belt: 1.0, roof: 1.47,
  top: [[-2.125, 0.42], [-2.135, 0.92], [-2.05, 1.04], [-1.95, 1.39], [-1.72, 1.47], [0.05, 1.47], [0.32, 1.43], [0.98, 1.0], [1.7, 0.88], [2.06, 0.76], [2.125, 0.42]],
  windows: [[-1.78, 1.05], [-1.62, 1.37], [0.24, 1.39], [0.9, 1.04]],
  pillars: [-1.3, -0.42],
  windscreen: [[0.98, 1.0], [0.32, 1.43]], rearWindow: [[-2.05, 1.04], [-1.95, 1.39]],
  doors: [-0.46, 0.66],
};
const ESTATE: Profile = {
  length: 4.75, width: 1.83, axles: [-1.45, 1.38], wheelRadius: 0.34, sill: 0.3, belt: 1.0, roof: 1.48,
  top: [[-2.375, 0.42], [-2.385, 0.94], [-2.32, 1.06], [-2.24, 1.4], [-2.05, 1.48], [0.1, 1.48], [0.38, 1.44], [1.08, 1.0], [1.88, 0.88], [2.3, 0.76], [2.375, 0.42]],
  windows: [[-2.12, 1.05], [-2.0, 1.38], [0.3, 1.4], [1.0, 1.04]],
  pillars: [-1.5, -0.42],
  windscreen: [[1.08, 1.0], [0.38, 1.44]], rearWindow: [[-2.32, 1.06], [-2.24, 1.4]],
  doors: [-0.46, 0.72], roofRails: true,
};
const SEDAN: Profile = {
  length: 4.75, width: 1.83, axles: [-1.42, 1.4], wheelRadius: 0.34, sill: 0.3, belt: 0.98, roof: 1.44,
  top: [[-2.375, 0.42], [-2.385, 0.86], [-2.3, 0.96], [-1.85, 1.0], [-1.25, 1.4], [-0.55, 1.44], [0.15, 1.44], [0.42, 1.4], [1.1, 0.98], [1.9, 0.86], [2.3, 0.74], [2.375, 0.42]],
  windows: [[-1.62, 1.03], [-1.18, 1.37], [0.36, 1.37], [1.02, 1.02]],
  pillars: [-0.48],
  windscreen: [[1.1, 0.98], [0.42, 1.4]], rearWindow: [[-1.85, 1.0], [-1.25, 1.4]],
  doors: [-1.2, -0.5, 0.72],
};
const SUV: Profile = {
  length: 4.5, width: 1.86, axles: [-1.36, 1.32], wheelRadius: 0.37, sill: 0.42, belt: 1.16, roof: 1.66,
  top: [[-2.25, 0.5], [-2.26, 1.06], [-2.18, 1.2], [-2.08, 1.56], [-1.86, 1.66], [0.05, 1.66], [0.36, 1.62], [1.02, 1.16], [1.8, 1.05], [2.18, 0.92], [2.25, 0.5]],
  windows: [[-1.92, 1.21], [-1.78, 1.56], [0.28, 1.58], [0.94, 1.2]],
  pillars: [-1.36, -0.44],
  windscreen: [[1.02, 1.16], [0.36, 1.62]], rearWindow: [[-2.18, 1.2], [-2.08, 1.56]],
  doors: [-0.48, 0.7], roofRails: true,
};
const VAN: Profile = {
  length: 5.3, width: 2.05, axles: [-1.6, 1.75], wheelRadius: 0.36, sill: 0.4, belt: 1.25, roof: 2.25,
  top: [[-2.65, 0.48], [-2.66, 2.12], [-2.58, 2.25], [1.35, 2.25], [1.55, 2.12], [1.95, 1.3], [2.5, 1.12], [2.62, 0.95], [2.65, 0.48]],
  windows: [[0.98, 1.3], [0.98, 1.95], [1.5, 1.98], [1.88, 1.3]],
  pillars: [],
  windscreen: [[1.95, 1.3], [1.55, 2.12]], rearWindow: [[-2.66, 1.4], [-2.66, 1.4]],
  doors: [0.9],
};
const AMBULANCE: Profile = {
  length: 6.2, width: 2.15, axles: [-1.85, 1.95], wheelRadius: 0.37, sill: 0.42, belt: 1.32, roof: 2.75, tumble: 0.03, lightsY: [1.12, 1.3],
  top: [[-3.1, 0.5], [-3.1, 2.68], [-3.04, 2.75], [1.0, 2.75], [1.06, 2.68], [1.06, 2.3], [1.4, 2.26], [2.15, 1.38], [2.75, 1.16], [3.06, 0.98], [3.1, 0.5]],
  windows: [[1.14, 1.4], [1.14, 2.14], [1.44, 2.18], [2.06, 1.4]],
  pillars: [],
  windscreen: [[2.15, 1.38], [1.4, 2.26]], rearWindow: [[-3.1, 1.6], [-3.1, 1.6]],
  doors: [1.08, -0.25],
};
const TRUCK: Profile = {
  length: 7.6, width: 2.45, axles: [-2.2, 2.5], wheelRadius: 0.48, sill: 0.5, belt: 1.75, roof: 3.5, tumble: 0.02, lightsY: [1.2, 1.25],
  top: [[-3.8, 0.75], [-3.8, 3.44], [-3.74, 3.5], [1.86, 3.5], [1.92, 3.44], [1.92, 2.9], [2.1, 2.95], [3.4, 2.95], [3.62, 2.8], [3.78, 1.8], [3.8, 1.1], [3.8, 0.75]],
  windows: [[2.3, 1.85], [2.3, 2.7], [3.5, 2.7], [3.66, 1.85]],
  pillars: [],
  windscreen: [[3.78, 1.8], [3.62, 2.8]], rearWindow: [[-3.8, 1.6], [-3.8, 1.6]],
  doors: [],
  extras: (k, p) => {
    const hw = p.width / 2, [rear] = p.axles, arch = p.wheelRadius + 0.08;
    sides(k, p, (s) => box(1.93, 2.02, p.sill + 0.1, 2.88, s * (hw - 0.004), s * (hw + 0.006), BLACK));
    sides(k, p, (s) => box(2.2, 2.22, p.sill + 0.7, p.belt + 0.9, s * (hw - 0.004), s * (hw + 0.006), BLACK));
    sides(k, p, (s) => box(2.26, 2.42, p.belt - 0.14, p.belt - 0.1, s * (hw + 0.002), s * (hw + 0.02), CHROME));
    for (const [x0, x1] of [[-3.6, rear - arch - 0.05], [rear + arch + 0.05, 1.86]]) {
      sides(k, p, (s) => box(x0, x1, p.sill, p.sill + 0.32, s * (hw - 0.004), s * (hw + 0.006), BLACK));
    }
  },
};
const FIRE: Profile = {
  length: 8.2, width: 2.5, axles: [-2.35, 2.7], wheelRadius: 0.5, sill: 0.5, belt: 1.9, roof: 3.12, tumble: 0.02, lightsY: [1.25, 1.3],
  top: [[-4.1, 0.75], [-4.1, 3.05], [-4.04, 3.12], [0.96, 3.12], [1.02, 3.05], [1.02, 2.98], [3.7, 2.98], [3.93, 2.85], [4.08, 1.85], [4.1, 1.1], [4.1, 0.75]],
  windows: [[1.25, 1.95], [1.25, 2.75], [3.75, 2.78], [3.92, 1.95]],
  pillars: [2.5],
  windscreen: [[4.08, 1.85], [3.93, 2.85]], rearWindow: [[-4.1, 1.6], [-4.1, 1.6]],
  doors: [1.15, 2.42],
  extras: (k, p) => {
    for (const [x0, x1, y0] of [[-3.95, -3.0, 0.72], [-2.9, -1.8, 1.16], [-1.7, 0.82, 0.72]]) {
      sides(k, p, (s) => plate(p, x0, x1, y0, 2.95, s, ALU));
      for (let y = y0 + 0.22; y < 2.9; y += 0.22) sides(k, p, (s) => plate(p, x0, x1, y, y + 0.015, s, 0x7d8287, 0.008));
    }
    band(k, p, 1.1, 4.0, 1.24, 0.1, WHITE);
    decal(k, p, 'BRANDWEER', 2.55, 1.55, 0.22);
    for (const z of [-0.34, 0.34]) k.trim.push(box(-3.75, 3.3, 3.2, 3.27, z - 0.035, z + 0.035, ALU));
    for (let x = -3.6; x < 3.25; x += 0.3) k.trim.push(box(x - 0.02, x + 0.02, 3.21, 3.25, -0.34, 0.34, ALU));
    for (const x of [-3.5, 0.6]) k.trim.push(box(x - 0.08, x + 0.08, p.roof, 3.2, -0.4, 0.4, BLACK));
    lightbar(k, 3.5, 2.98, 0.75);
    for (const s of [-1, 1] as const) k.lamps.push({ x: -3.98, y: p.roof + 0.07, z: s * (p.width / 2 - 0.22), sx: 0.18, sy: 0.12, sz: 0.24, side: s });
    grille(k, p);
  },
};

// Indexed by VehicleSpec.model.
const PROFILES: Profile[] = [
  CITY, HATCH, ESTATE, SEDAN, SUV, VAN,
  {
    ...ESTATE,
    roofRails: false,
    extras: (k, p) => {
      chequer(k, p, -2.2, 2.2, 0.74, 0.12);
      decal(k, p, 'POLITIE', -0.06, 0.57, 0.17);
      lightbar(k, -0.2, p.roof, 0.62);
      grille(k, p);
    },
  },
  {
    ...VAN,
    extras: (k, p) => {
      chequer(k, p, -2.6, 2.4, 0.9, 0.12);
      decal(k, p, 'POLITIE', -0.85, 1.7, 0.34);
      lightbar(k, 0.95, p.roof, 0.72);
      grille(k, p);
    },
  },
  {
    ...SEDAN,
    extras: (k, p) => {
      k.trim.push(box(-0.32, -0.08, p.roof, p.roof + 0.025, -0.28, 0.28, BLACK));
      k.lamps.push({ x: -0.2, y: p.roof + 0.105, z: 0, sx: 0.16, sy: 0.16, sz: 0.62, side: 0 });
      decal(k, p, 'TAXI', -0.2, p.roof + 0.105, 0.11, 0.085);
    },
  },
  {
    ...AMBULANCE,
    extras: (k, p) => {
      chequer(k, p, -3.0, 3.0, 0.94, 0.12);
      decal(k, p, 'AMBULANCE', -1.05, 2.25, 0.3);
      decal(k, p, '112', -1.05, 1.68, 0.42);
      for (const x of [0.86, -2.94]) {
        for (const s of [-1, 1] as const) k.lamps.push({ x, y: p.roof + 0.07, z: s * (p.width / 2 - 0.2), sx: 0.2, sy: 0.12, sz: 0.24, side: x > 0 ? s : (-s as -1 | 1) });
      }
      grille(k, p);
    },
  },
  TRUCK,
  FIRE,
];

function warp(p: Profile, x: number, y: number): number {
  const half = p.length / 2;
  const plan = 1 - 0.09 * Math.pow(Math.min(Math.abs(x) / half, 1), 6);
  const t = Math.max(0, (y - p.belt) / (p.roof - p.belt));
  const tumble = 1 - (p.tumble ?? 0.16) * Math.pow(Math.min(t, 1.2), 1.4);
  return plan * tumble;
}

function warpGeometry(g: THREE.BufferGeometry, p: Profile) {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * warp(p, pos.getX(i), pos.getY(i)));
  g.computeVertexNormals();
  return g;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: number) {
  return coloured(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, 2, 1, 2).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), hex);
}

function panel(pts: number[][], hex: number): THREE.BufferGeometry {
  const [a, b, c, d] = pts;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d, ...a, ...c, ...b, ...a, ...d, ...c], 3));
  return coloured(g, hex);
}

function topAt(p: Profile, x: number): number {
  for (let i = 0; i < p.top.length - 1; i++) {
    const [x0, y0] = p.top[i], [x1, y1] = p.top[i + 1];
    if ((x >= x0 && x <= x1) || (x >= x1 && x <= x0)) return x1 === x0 ? Math.max(y0, y1) : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return p.sill;
}

function sides(k: Kit, p: Profile, fn: (s: number) => THREE.BufferGeometry) {
  for (const s of [-1, 1]) k.trim.push(warpGeometry(fn(s), p));
}

/** A flat panel just proud of a side, split along its length so it follows the body's taper. */
function plate(p: Profile, x0: number, x1: number, y0: number, y1: number, s: number, hex: number, lift = 0.006) {
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0, Math.max(1, Math.ceil((x1 - x0) / 0.3)), 1);
  if (s < 0) g.rotateY(Math.PI);
  return coloured(g.translate((x0 + x1) / 2, (y0 + y1) / 2, s * (p.width / 2 + lift)), hex);
}

/** Only where the side is flat: the extrusion's bevel rounds the outline's last 0.12 m. */
const fits = (p: Profile, x0: number, x1: number, y1: number) =>
  x0 > -p.length / 2 + 0.15 && x1 < p.length / 2 - 0.15 && Math.min(topAt(p, x0), topAt(p, x1)) - 0.1 >= y1;

function band(k: Kit, p: Profile, x0: number, x1: number, y: number, h: number, hex: number) {
  for (let x = x0; x < x1 - 0.01; x += 0.25) {
    const b = Math.min(x + 0.25, x1);
    if (fits(p, x, b, y + h)) sides(k, p, (s) => plate(p, x, b, y, y + h, s, hex));
  }
}

function chequer(k: Kit, p: Profile, x0: number, x1: number, y: number, size: number) {
  for (let row = 0; row < 2; row++) {
    for (let i = 0; x0 + i * size < x1 - 0.01; i++) {
      const a = x0 + i * size, b = Math.min(a + size, x1), y0 = y + row * size;
      if (fits(p, a, b, y0 + size)) sides(k, p, (s) => plate(p, a, b, y0, y0 + size, s, (i + row) % 2 ? FLUO : BLUE));
    }
  }
}

/** On both sides; with `ends` (half-length, m), on a roof sign's front and back faces instead. */
function decal(k: Kit, p: Profile, word: Word, x: number, y: number, h: number, ends?: number) {
  const { u0, u1, v0, v1, aspect } = atlas().words[word];
  const len = h * aspect;
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(len, h, ends === undefined ? Math.max(1, Math.ceil(len / 0.3)) : 1, 1);
    const uv = g.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    if (ends === undefined) {
      if (s < 0) g.rotateY(Math.PI);
      k.decals.push(warpGeometry(g.translate(x, y, s * (p.width / 2 + 0.012)), p));
    } else {
      g.rotateY((s * Math.PI) / 2);
      k.decals.push(g.translate(x + s * (ends + 0.004), y, 0));
    }
  }
}

function lightbar(k: Kit, x: number, y: number, halfZ: number) {
  k.trim.push(box(x - 0.15, x + 0.15, y, y + 0.05, -halfZ, halfZ, BLACK));
  const z0 = 0.05, z1 = halfZ - 0.03;
  for (const s of [-1, 1] as const) k.lamps.push({ x, y: y + 0.1, z: (s * (z0 + z1)) / 2, sx: 0.26, sy: 0.1, sz: z1 - z0, side: s });
}

/** Out of step with the roof lights. */
function grille(k: Kit, p: Profile) {
  const y = (p.lightsY?.[0] ?? topAt(p, p.length / 2 - 0.15)) - 0.24;
  for (const s of [-1, 1] as const) k.lamps.push({ x: p.length / 2 + 0.01, y, z: s * 0.36, sx: 0.03, sy: 0.05, sz: 0.14, side: (-s as -1 | 1) });
}

let words: ReturnType<typeof drawAtlas> | null = null;
const atlas = () => (words ??= drawAtlas());

function drawAtlas() {
  const W = 1024, ROW = 128;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = ROW * WORDS.length;
  const g = canvas.getContext('2d')!;
  g.textBaseline = 'middle';
  const out = {} as Record<Word, { u0: number; u1: number; v0: number; v1: number; aspect: number }>;
  WORDS.forEach(([word, colour], r) => {
    g.font = 'bold 104px Arial, Helvetica, sans-serif';
    const w = Math.min(g.measureText(word).width, W - 16);
    g.fillStyle = colour;
    g.fillText(word, 8, r * ROW + ROW / 2 + 4, W - 16);
    out[word] = { u0: 0, u1: (w + 16) / W, v0: 1 - (r + 1) / WORDS.length, v1: 1 - r / WORDS.length, aspect: (w + 16) / ROW };
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, words: out };
}

function glowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function flashing(t: number, side: number) {
  const u = (((t + (side > 0 ? 0.5 : 0)) % 1) + 1) % 1;
  return u < 0.11 || (u > 0.19 && u < 0.3);
}

function buildModel(p: Profile) {
  const half = p.length / 2, hw = p.width / 2;
  const arch = p.wheelRadius + 0.08;

  const shape = new THREE.Shape();
  shape.moveTo(-half + 0.1, p.sill);
  for (const x of p.axles) {
    shape.lineTo(x - arch, p.sill);
    shape.absarc(x, p.sill, arch, Math.PI, 0, true);
  }
  shape.lineTo(half - 0.1, p.sill);
  for (const [x, y] of [...p.top].reverse()) shape.lineTo(x, y);
  const bevel = 0.12;
  const body = new THREE.ExtrudeGeometry(shape, {
    depth: p.width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelOffset: -bevel, bevelThickness: bevel,
    bevelSegments: 3, curveSegments: 10,
  });
  body.translate(0, 0, -(p.width - bevel * 2) / 2);
  const paint = [coloured(warpGeometry(body, p), 0xffffff)];
  const k: Kit = { trim: [], decals: [], lamps: [] };
  const trim = k.trim;
  const side = (fn: (s: number) => THREE.BufferGeometry) => sides(k, p, fn);

  const win = new THREE.Shape(p.windows.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const s of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(win, { depth: 0.01, bevelEnabled: false });
    g.translate(0, 0, s > 0 ? hw + 0.002 : -hw - 0.012);
    trim.push(warpGeometry(coloured(g, GLASS), p));
    for (const x of p.pillars) paint.push(warpGeometry(box(x - 0.07, x + 0.07, p.belt, topAt(p, x) - 0.06, s * (hw + 0.004), s * (hw + 0.016), 0xffffff), p));
  }
  for (const [[x0, y0], [x1, y1]] of [p.windscreen, p.rearWindow]) {
    if (x0 === x1 && y0 === y1) continue;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = (y1 - y0) / len * (x1 > x0 ? -1 : 1), ny = Math.abs(x1 - x0) / len;
    const o = 0.012, w = hw - 0.14, i0 = 0.06, i1 = 0.04;
    const a: Pt = [x0 + (x1 - x0) * (i0 / len) + nx * o, y0 + (y1 - y0) * (i0 / len) + ny * o];
    const b: Pt = [x1 - (x1 - x0) * (i1 / len) + nx * o, y1 - (y1 - y0) * (i1 / len) + ny * o];
    trim.push(warpGeometry(panel([[a[0], a[1], -w], [a[0], a[1], w], [b[0], b[1], w], [b[0], b[1], -w]], GLASS), p));
  }

  const [frontY, rearY] = p.lightsY ?? [topAt(p, half - 0.15), topAt(p, -half + 0.12)];
  side((s) => box(half - 0.2, half + 0.005, frontY - 0.17, frontY - 0.04, s * (hw - 0.52), s * (hw - 0.14), HEADLIGHT));
  side((s) => box(half - 0.13, half + 0.008, frontY - 0.15, frontY - 0.06, s * (hw - 0.36), s * (hw - 0.28), CHROME));
  side((s) => box(-half - 0.006, -half + 0.22, rearY - 0.2, rearY - 0.06, s * (hw - 0.42), s * (hw + 0.003), TAIL));
  side((s) => box(-half - 0.008, -half + 0.05, rearY - 0.2, rearY - 0.15, s * (hw - 0.4), s * (hw - 0.3), AMBER));
  trim.push(warpGeometry(box(half - 0.06, half + 0.006, frontY - 0.3, frontY - 0.05, -(hw - 0.56), hw - 0.56, BLACK), p));
  trim.push(warpGeometry(box(half - 0.3, half + 0.004, p.sill + 0.02, p.sill + 0.16, -(hw - 0.12), hw - 0.12, BLACK), p));
  trim.push(warpGeometry(box(-half - 0.004, -half + 0.3, p.sill + 0.02, p.sill + 0.18, -(hw - 0.12), hw - 0.12, BLACK), p));
  side((s) => box(p.axles[0] + arch, p.axles[1] - arch, p.sill, p.sill + 0.1, s * (hw - 0.02), s * (hw + 0.01), BLACK));
  for (const [x, y] of [[half + 0.01, p.sill + 0.22], [-half - 0.01, rearY - 0.38]] as Pt[]) {
    trim.push(box(x - 0.012, x + 0.012, y - 0.06, y + 0.06, -0.26, 0.26, PLATE));
    trim.push(box(x - 0.016, x + 0.016, y - 0.025, y + 0.025, -0.17, 0.15, PLATE_TEXT));
  }
  for (const x of p.doors) {
    side((s) => box(x - 0.008, x + 0.008, p.sill + 0.12, p.belt - 0.02, s * (hw - 0.004), s * (hw + 0.004), BLACK));
    side((s) => box(x - 0.2, x - 0.06, p.belt - 0.13, p.belt - 0.1, s * (hw + 0.002), s * (hw + 0.02), CHROME));
  }
  const mirrorX = p.windows[p.windows.length - 1][0] - 0.12;
  for (const s of [-1, 1]) {
    trim.push(box(mirrorX - 0.05, mirrorX + 0.05, p.belt, p.belt + 0.05, s * hw, s * (hw + 0.12), BLACK));
    paint.push(box(mirrorX - 0.1, mirrorX + 0.04, p.belt + 0.03, p.belt + 0.15, s * (hw + 0.06), s * (hw + 0.2), 0xffffff));
  }
  if (p.roofRails) side((s) => box(-half + 0.55, half - 1.75, p.roof, p.roof + 0.05, s * (hw - 0.22), s * (hw - 0.16), BLACK));

  for (const x of p.axles) trim.push(coloured(new THREE.CylinderGeometry(arch - 0.02, arch - 0.02, p.width - 0.3, 16).rotateX(Math.PI / 2).translate(x, p.sill, 0), BLACK));
  p.extras?.(k, p);

  return {
    paint: mergeGeometries(paint),
    trim: mergeGeometries(trim),
    decals: k.decals.length ? mergeGeometries(k.decals) : null,
    lamps: k.lamps,
    wheels: p.axles.flatMap((x) => [-1, 1].map((s) => new THREE.Vector3(x, p.wheelRadius, s * (hw - 0.16)))),
    wheelScale: p.wheelRadius / WHEEL_RADIUS,
  };
}

function wheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.23, 16, 1, true).rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.21, 0.21, 0.24, 12).rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6).rotateX(Math.PI / 2);
  const walls = [-1, 1].map((s) => new THREE.CylinderGeometry(WHEEL_RADIUS - 0.02, 0.21, 0.02, 16, 1, true).rotateX((s * Math.PI) / 2).translate(0, 0, s * 0.115));
  const spokes = [0, 1, 2, 3, 4].map((i) => new THREE.BoxGeometry(0.06, 0.38, 0.245).rotateZ((i / 5) * Math.PI));
  return mergeGeometries([
    coloured(tyre, TYRE), ...walls.map((g) => coloured(g, TYRE)), coloured(rim, 0x55595e),
    ...spokes.map((g) => coloured(g, RIM)), coloured(hub, CHROME),
  ]);
}

interface Model {
  paint: THREE.InstancedMesh;
  trim: THREE.InstancedMesh;
  decals: THREE.InstancedMesh | null;
  lamps: Lamp[];
  wheels: THREE.Vector3[];
  wheelScale: number;
}

export class VehicleRenderer {
  readonly group = new THREE.Group();
  private models: Model[] = [];
  private wheels: THREE.InstancedMesh;
  private lamps: THREE.InstancedMesh;
  private glow: THREE.Points;
  private glowAt = new Float32Array(GLOWS * 3);
  private matrix = new THREE.Matrix4();
  private wheelMatrix = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private spin = new THREE.Matrix4();
  private scaleMatrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3(1, 1, 1);
  private colour = new THREE.Color();

  constructor(capacity: number, private viewDistance = 350) {
    const paintMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.38, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.1,
    });
    const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.25 });
    const decalMat = new THREE.MeshStandardMaterial({
      map: atlas().texture, transparent: true, depthWrite: false, roughness: 0.3, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2,
    });
    for (const profile of PROFILES) {
      const m = buildModel(profile);
      const paint = new THREE.InstancedMesh(m.paint, paintMat, capacity);
      const trim = new THREE.InstancedMesh(m.trim, trimMat, capacity);
      const decals = m.decals && new THREE.InstancedMesh(m.decals, decalMat, capacity);
      paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      this.models.push({ paint, trim, decals, lamps: m.lamps, wheels: m.wheels, wheelScale: m.wheelScale });
      this.add(paint);
      this.add(trim);
      if (decals) this.add(decals, false);
    }
    this.wheels = new THREE.InstancedMesh(
      wheelGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }), capacity * 4,
    );
    this.add(this.wheels);
    this.lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), LAMPS);
    this.lamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LAMPS * 3), 3);
    this.add(this.lamps, false);

    const glow = new THREE.BufferGeometry();
    glow.setAttribute('position', new THREE.BufferAttribute(this.glowAt, 3).setUsage(THREE.DynamicDrawUsage));
    this.glow = new THREE.Points(glow, new THREE.PointsMaterial({
      size: 2.6, map: glowTexture(), color: BEACON_ON, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.glow.frustumCulled = false;
    this.group.add(this.glow);
  }

  private add(mesh: THREE.InstancedMesh, shadows = true) {
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances span the whole map: culled by distance instead
    mesh.count = 0;
    this.group.add(mesh);
  }

  update(vehicles: Vehicle[], camera: THREE.Vector3, alpha: number) {
    const counts = this.models.map(() => 0);
    let wheels = 0, lamps = 0, glows = 0;
    const max2 = this.viewDistance ** 2;
    const now = (performance.now() / 1000) * FLASH_HZ;
    for (const v of vehicles) {
      if (v.spec.model < 0) continue;
      const x = v.prev.x + (v.x - v.prev.x) * alpha;
      const z = v.prev.z + (v.z - v.prev.z) * alpha;
      const d2 = (x - camera.x) ** 2 + (z - camera.z) ** 2;
      if (d2 > max2) continue;
      const angle = v.prev.angle + wrapAngle(v.angle - v.prev.angle) * alpha;

      const model = this.models[v.spec.model];
      const i = counts[v.spec.model]++;
      this.euler.set(v.roll, -angle, v.pitch - Math.min(v.sink, 1) * 0.5);
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.pos.set(x, -v.sink, z), this.quat, this.scale);
      model.paint.setMatrixAt(i, this.matrix);
      model.trim.setMatrixAt(i, this.matrix);
      model.decals?.setMatrixAt(i, this.matrix);
      model.paint.setColorAt(i, this.colour.setHex(v.colour));

      const t = now + (v.body.handle % 8) * 0.29; // out of step with each other
      for (const l of model.lamps) {
        if (lamps === LAMPS) break;
        this.local.makeScale(l.sx, l.sy, l.sz).setPosition(l.x, l.y, l.z);
        this.lamps.setMatrixAt(lamps, this.wheelMatrix.multiplyMatrices(this.matrix, this.local));
        const on = l.side !== 0 && v.siren && flashing(t, l.side);
        this.lamps.setColorAt(lamps++, l.side === 0 ? SIGN : on ? BEACON_ON : BEACON_OFF);
        if (on && glows < GLOWS) this.pos.set(l.x, l.y, l.z).applyMatrix4(this.matrix).toArray(this.glowAt, glows++ * 3);
      }

      if (d2 > 120 * 120) continue;
      this.scaleMatrix.makeScale(model.wheelScale, model.wheelScale, 1);
      for (const w of model.wheels) {
        this.local.makeRotationY(w.x > 0 ? -v.steerSmoothed * 0.55 : 0).multiply(this.spin.makeRotationZ(-v.wheelSpin)).multiply(this.scaleMatrix);
        this.local.setPosition(w);
        this.wheelMatrix.multiplyMatrices(this.matrix, this.local);
        this.wheels.setMatrixAt(wheels++, this.wheelMatrix);
      }
    }
    this.models.forEach(({ paint, trim, decals }, m) => {
      // Empty instanced meshes still cost a draw call (and one per shadow cascade).
      paint.visible = trim.visible = counts[m] > 0;
      paint.count = trim.count = counts[m];
      uploadFirst(paint.instanceMatrix, counts[m]);
      uploadFirst(trim.instanceMatrix, counts[m]);
      uploadFirst(paint.instanceColor, counts[m]);
      if (!decals) return;
      decals.visible = counts[m] > 0;
      decals.count = counts[m];
      uploadFirst(decals.instanceMatrix, counts[m]);
    });
    this.wheels.count = wheels;
    uploadFirst(this.wheels.instanceMatrix, wheels);
    this.lamps.visible = lamps > 0;
    this.lamps.count = lamps;
    uploadFirst(this.lamps.instanceMatrix, lamps);
    uploadFirst(this.lamps.instanceColor, lamps);
    this.glow.visible = glows > 0;
    this.glow.geometry.setDrawRange(0, glows);
    const at = this.glow.geometry.getAttribute('position') as THREE.BufferAttribute;
    uploadFirst(at, glows);
  }
}
