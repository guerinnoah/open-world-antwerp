import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured } from '../core/util';
import type { TramRun } from '../world/cityData';

// Albatros (Flexity 2) sections. Frame: +x forward, y up, +z the right-hand side (doors on the right only).
export type SectionKind = 'cab' | 'mid' | 'rear';

export const LAYOUTS: SectionKind[][] = [
  ['cab', 'mid', 'mid', 'mid', 'rear'],
  ['cab', 'mid', 'mid', 'mid', 'mid', 'mid', 'rear'],
];
export const SECTION_LENGTH: Record<SectionKind, number> = { cab: 7.2, mid: 5.8, rear: 7.2 };
export const TRAM_WIDTH = 2.3;

export const WHITE = 0xeeeeea, SKIRT = 0x8f9396, ROOF = 0xa9adb1, GLASS = 0x15181c, FRAME = 0x1d2023, YELLOW = 0xf5c400;
export const BELLOWS = 0x2e3134, LAMP = 0xf4f1e6, DARK_GREY = 0x4a4d50, CLUSTER = 0xd4d6d8, TAIL_LIGHT = 0xa3161c;

const HW = TRAM_WIDTH / 2;
const FLOOR = 0.28;
const BELT = 1.02;
const HEAD = 2.42;
const EAVES = 2.78;
const ROOF_TOP = 3.12;
const SIDES: Sides = { hw: HW, floor: FLOOR, skirt: 0.86, belt: BELT, head: HEAD, pitch: 1.45, pillar: 0.07 };

export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: number) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  return coloured(g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), hex);
}

function bodyShell(x0: number, x1: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-HW + 0.04, FLOOR);
  s.lineTo(HW - 0.04, FLOOR);
  s.lineTo(HW, FLOOR + 0.1);
  s.lineTo(HW, EAVES);
  s.quadraticCurveTo(HW, ROOF_TOP, HW - 0.4, ROOF_TOP);
  s.lineTo(-HW + 0.4, ROOF_TOP);
  s.quadraticCurveTo(-HW, ROOF_TOP, -HW, EAVES);
  s.lineTo(-HW, FLOOR + 0.1);
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false, curveSegments: 5 });
  g.rotateY(Math.PI / 2).translate(x0, 0, 0);
  return coloured(g, WHITE);
}

export interface Sides {
  hw: number;
  floor: number;
  skirt: number;
  belt: number;
  head: number;
  pitch: number;
  pillar: number;
}

export function sideLivery(x0: number, x1: number, d: Sides, parts: THREE.BufferGeometry[]) {
  for (const side of [-1, 1]) {
    const zo = side * (d.hw + 0.012), zi = side * (d.hw - 0.01);
    const [za, zb] = side > 0 ? [zi, zo] : [zo, zi];
    parts.push(box(x0, x1, d.floor, d.skirt, za, zb, SKIRT));
    parts.push(box(x0, x1, d.belt, d.head, za, zb, GLASS));
    const n = Math.max(1, Math.round((x1 - x0) / d.pitch));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      parts.push(box(x - d.pillar, x + d.pillar, d.belt, d.head, za - side * 0.004, zb + side * 0.004, WHITE));
    }
  }
}

function door(x: number, parts: THREE.BufferGeometry[]) {
  const z0 = HW, z1 = HW + 0.03;
  parts.push(box(x - 0.68, x + 0.68, FLOOR + 0.04, HEAD + 0.06, z0, z1, FRAME));
  parts.push(box(x - 0.6, x - 0.04, 0.5, HEAD - 0.05, z1, z1 + 0.005, GLASS), box(x + 0.04, x + 0.6, 0.5, HEAD - 0.05, z1, z1 + 0.005, GLASS));
  for (const e of [-0.68, 0.62]) parts.push(box(x + e, x + e + 0.06, FLOOR + 0.04, HEAD + 0.06, z1, z1 + 0.008, YELLOW));
}

function roofKit(x0: number, x1: number, parts: THREE.BufferGeometry[]) {
  parts.push(box(x0 + 0.4, x1 - 0.4, ROOF_TOP - 0.02, ROOF_TOP + 0.28, -0.85, 0.85, ROOF));
}

function endCap(x0: number, front: boolean): THREE.BufferGeometry {
  const p = front
    ? [[0, FLOOR], [1.05, FLOOR + 0.02], [1.18, 0.6], [1.2, 1.05], [1.08, 1.22], [0.62, 2.72], [0.42, ROOF_TOP], [0, ROOF_TOP]]
    : [[0, FLOOR], [0.8, FLOOR + 0.02], [0.92, 0.6], [0.95, 1.1], [0.86, 1.3], [0.6, 2.75], [0.4, ROOF_TOP], [0, ROOF_TOP]];
  const s = new THREE.Shape(p.map(([x, y]) => new THREE.Vector2(x, y)));
  const bevel = 0.32;
  const g = new THREE.ExtrudeGeometry(s, {
    depth: TRAM_WIDTH - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelOffset: -bevel, bevelThickness: bevel,
    bevelSegments: 3, curveSegments: 4,
  });
  g.translate(0, 0, -(TRAM_WIDTH - bevel * 2) / 2);
  if (!front) g.scale(-1, 1, 1);
  g.translate(x0, 0, 0);
  return coloured(g, WHITE);
}

export function quad(a: number[], b: number[], c: number[], d: number[], hex: number, uv?: number[][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute([...uv[0], ...uv[1], ...uv[2], ...uv[0], ...uv[2], ...uv[3]], 2));
  g.computeVertexNormals();
  return uv ? g : coloured(g, hex);
}

function cabFront(xf: number, parts: THREE.BufferGeometry[]) {
  const at = (y: number): [number, number] => {
    const t = (y - 1.22) / (2.72 - 1.22);
    return [xf + 1.08 + (0.62 - 1.08) * t + 0.035, y];
  };
  const w = HW - 0.24;
  const [xa, ya] = at(1.26), [xb, yb] = at(2.42);
  parts.push(quad([xa, ya, w], [xa, ya, -w], [xb, yb, -w], [xb, yb, w], GLASS));
  const [xc, yc] = at(2.44), [xd, yd] = at(2.7);
  parts.push(quad([xc, yc, w], [xc, yc, -w], [xd, yd, -w], [xd, yd, w], FRAME));
  const xn = xf + 1.215;
  parts.push(box(xf + 0.9, xf + 1.19, FLOOR + 0.02, 0.52, -(HW - 0.34), HW - 0.34, SKIRT));
  parts.push(box(xn - 0.02, xn + 0.012, 0.66, 1.0, -0.62, -0.26, YELLOW));
  parts.push(box(xn + 0.01, xn + 0.016, 0.8, 0.86, -0.6, -0.4, DARK_GREY));
  for (const side of [-1, 1]) {
    parts.push(box(xn - 0.03, xn + 0.008, 0.86, 1.0, side * 0.62, side * 0.98, CLUSTER));
    for (const z of [0.7, 0.88]) {
      const c = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10).rotateZ(Math.PI / 2).translate(xn + 0.012, 0.93, side * z);
      parts.push(coloured(c, LAMP));
    }
    parts.push(box(xf + 0.5, xf + 0.62, 2.3, 2.38, side * HW, side * (HW + 0.22), FRAME));
    parts.push(box(xf + 0.45, xf + 0.68, 2.05, 2.42, side * (HW + 0.17), side * (HW + 0.3), FRAME));
  }
}

function rearFace(xr: number, parts: THREE.BufferGeometry[]) {
  const xn = xr - 0.945;
  const w = HW - 0.3;
  parts.push(quad([xr - 0.88, 1.36, -w], [xr - 0.88, 1.36, w], [xr - 0.655, 2.62, w], [xr - 0.655, 2.62, -w], GLASS));
  for (const side of [-1, 1]) parts.push(box(xn - 0.012, xn + 0.03, 0.88, 1.0, side * 0.62, side * 0.92, TAIL_LIGHT));
}

function pantograph(x: number, parts: THREE.BufferGeometry[]) {
  const base = ROOF_TOP + 0.28;
  parts.push(box(x - 0.6, x + 0.6, base, base + 0.12, -0.45, 0.45, 0x55595d));
  const arm = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const g = new THREE.BoxGeometry(len, 0.05, 0.05).rotateZ(Math.atan2(y1 - y0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    for (const z of [-0.25, 0.25]) parts.push(coloured(g.clone().translate(0, 0, z), 0x3b3e41));
  };
  arm(x - 0.4, base + 0.12, x + 0.35, base + 0.75);
  arm(x + 0.35, base + 0.75, x - 0.15, base + 1.25);
  parts.push(box(x - 0.25, x - 0.05, base + 1.22, base + 1.28, -0.75, 0.75, 0x2b2d30));
}

export interface SectionModel {
  body: THREE.BufferGeometry;
  display: THREE.BufferGeometry | null;
}

export function buildSection(kind: SectionKind): SectionModel {
  const L = SECTION_LENGTH[kind];
  const x0 = -L / 2, x1 = L / 2;
  const parts: THREE.BufferGeometry[] = [];
  let display: THREE.BufferGeometry | null = null;
  const bodyStart = kind === 'rear' ? x0 + 0.95 : x0;
  const bodyEnd = kind === 'cab' ? x1 - 1.2 : x1;
  parts.push(bodyShell(bodyStart, bodyEnd));
  sideLivery(bodyStart + 0.15, bodyEnd - (kind === 'cab' ? 0.35 : 0.15), SIDES, parts);
  roofKit(bodyStart, bodyEnd, parts);
  if (kind === 'cab') {
    parts.push(endCap(bodyEnd, true));
    cabFront(bodyEnd, parts);
    door(bodyStart + 1.4, parts);
    const t0 = (2.47 - 1.22) / 1.5, t1 = (2.67 - 1.22) / 1.5;
    const xa = bodyEnd + 1.08 + (0.62 - 1.08) * t0 + 0.045, xb = bodyEnd + 1.08 + (0.62 - 1.08) * t1 + 0.045;
    const w = HW - 0.32;
    display = quad([xa, 2.47, w], [xa, 2.47, -w], [xb, 2.67, -w], [xb, 2.67, w], 0, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  } else if (kind === 'rear') {
    parts.push(endCap(bodyStart, false));
    rearFace(bodyStart, parts);
    door(bodyEnd - 1.6, parts);
    const w = 0.35;
    display = quad([bodyStart - 0.66, 2.66, w], [bodyStart - 0.66, 2.66, -w], [bodyStart - 0.66, 2.48, -w], [bodyStart - 0.66, 2.48, w], 0, [[0.22, 1], [0, 1], [0, 0], [0.22, 0]]);
  } else {
    door(0, parts);
  }
  if (kind !== 'rear') parts.push(box(x0 - 0.5, x0 + 0.05, FLOOR + 0.1, ROOF_TOP - 0.15, -HW + 0.12, HW - 0.12, BELLOWS));
  if (kind === 'mid') pantograph(0, parts);
  return { body: mergeGeometries(parts), display };
}

export function displayAtlas(runs: TramRun[]): { texture: THREE.CanvasTexture; rows: Map<string, number>; count: number } {
  const keys = [...new Set(runs.map((r) => `${r.line}|${r.to}|${r.colour}`))];
  const W = 512, H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H * keys.length;
  const c = canvas.getContext('2d')!;
  const rows = new Map<string, number>();
  keys.forEach((key, i) => {
    const [line, to, colour] = key.split('|');
    const y = i * H;
    c.fillStyle = '#050505';
    c.fillRect(0, y, W, H);
    const hex = `#${Number(colour).toString(16).padStart(6, '0')}`;
    c.fillStyle = hex;
    c.fillRect(8, y + 8, 100, H - 16);
    const rgb = new THREE.Color(hex);
    c.fillStyle = rgb.r * 0.3 + rgb.g * 0.59 + rgb.b * 0.11 > 0.55 ? '#111' : '#fff';
    c.font = 'bold 40px "Helvetica Neue", Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(line, 58, y + H / 2 + 2);
    const text = to.slice(0, 30);
    c.font = 'bold 34px "Courier New", monospace';
    const size = Math.floor(34 * Math.min(1, (W - 132) / c.measureText(text).width));
    c.fillStyle = '#ff9b21';
    c.font = `bold ${size}px "Courier New", monospace`;
    c.textAlign = 'left';
    c.fillText(text, 124, y + H / 2 + 2);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (let yy = y; yy < y + H; yy += 3) c.fillRect(0, yy, W, 1);
    rows.set(`${line}|${to}|${colour}`, i);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, rows, count: keys.length };
}

export function displayMaterial(texture: THREE.Texture, rowCount: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  material.onBeforeCompile = (shader) => {
    // Row 0 is the top of the canvas; the texture is flipped, so v counts up from the bottom row.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float iRow;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvMapUv.y = 1.0 - (iRow + 1.0 - vMapUv.y) / ${rowCount.toFixed(1)};`);
  };
  // The row count is baked into the shader, and trams and buses have different atlases.
  material.customProgramCacheKey = () => `display-${rowCount}`;
  return material;
}
