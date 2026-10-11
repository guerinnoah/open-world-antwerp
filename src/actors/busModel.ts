import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured } from '../core/util';
import {
  BELLOWS, CLUSTER, DARK_GREY, FRAME, GLASS, LAMP, ROOF, SKIRT, TAIL_LIGHT, WHITE, YELLOW, box, quad, sideLivery, type SectionModel, type Sides,
} from './tramModel';

export type BusKind = 'solo' | 'lead' | 'trailer';

export const KINDS: BusKind[] = ['solo', 'lead', 'trailer'];
export const LAYOUTS: BusKind[][] = [['solo'], ['lead', 'trailer']];
export const SECTION_LENGTH: Record<BusKind, number> = { solo: 12, lead: 11, trailer: 6.6 };
/** Each section's axles, in from its front and rear ends (m). A trailer's front "axle" is the hitch. */
export const AXLES: Record<BusKind, [number, number]> = { solo: [2.7, 3.4], lead: [2.7, 1.8], trailer: [0, 2.6] };
export const BUS_WIDTH = 2.55;

const TYRE = 0x161718, HUB = 0x9a9ea2;

const HW = BUS_WIDTH / 2;
const FLOOR = 0.32;
const BELT = 1.0;
const HEAD = 2.45;
const EAVES = 2.82;
const ROOF_TOP = 3.02;
const WHEEL = 0.5;
const NOSE = 0.45;
const TAIL = 0.42;
const BEVEL = 0.1;
const SIDES: Sides = { hw: HW, floor: FLOOR, skirt: 0.62, belt: BELT, head: HEAD, pitch: 1.5, pillar: 0.06 };

function shell(x0: number, x1: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-HW + 0.03, FLOOR);
  s.lineTo(HW - 0.03, FLOOR);
  s.lineTo(HW, FLOOR + 0.08);
  s.lineTo(HW, EAVES);
  s.quadraticCurveTo(HW, ROOF_TOP, HW - 0.3, ROOF_TOP);
  s.lineTo(-HW + 0.3, ROOF_TOP);
  s.quadraticCurveTo(-HW, ROOF_TOP, -HW, EAVES);
  s.lineTo(-HW, FLOOR + 0.08);
  const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false, curveSegments: 4 });
  g.rotateY(Math.PI / 2).translate(x0, 0, 0);
  return coloured(g, WHITE);
}

function cap(x0: number, profile: number[][], front: boolean): THREE.BufferGeometry {
  const s = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(front ? x : -x, y)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth: BUS_WIDTH - BEVEL * 2, bevelEnabled: true, bevelSize: BEVEL, bevelOffset: -BEVEL, bevelThickness: BEVEL,
    bevelSegments: 2, curveSegments: 3,
  });
  g.translate(x0, 0, -(BUS_WIDTH - BEVEL * 2) / 2);
  return coloured(g, WHITE);
}

function door(x: number, parts: THREE.BufferGeometry[]) {
  const z0 = HW, z1 = HW + 0.03;
  parts.push(box(x - 0.66, x + 0.66, FLOOR + 0.02, HEAD + 0.08, z0, z1, FRAME));
  parts.push(box(x - 0.58, x - 0.03, 0.42, HEAD - 0.04, z1, z1 + 0.005, GLASS), box(x + 0.03, x + 0.58, 0.42, HEAD - 0.04, z1, z1 + 0.005, GLASS));
  for (const e of [-0.66, 0.6]) parts.push(box(x + e, x + e + 0.06, FLOOR + 0.02, HEAD + 0.08, z1, z1 + 0.008, YELLOW));
}

function axle(x: number, parts: THREE.BufferGeometry[]) {
  for (const side of [-1, 1]) {
    const tyre = new THREE.CylinderGeometry(WHEEL, WHEEL, 0.34, 16).rotateX(Math.PI / 2).translate(x, WHEEL, side * (HW - 0.22));
    parts.push(coloured(tyre, TYRE));
    const disc = (g: THREE.BufferGeometry, y: number, out: number, hex: number) => {
      if (side < 0) g.rotateY(Math.PI);
      parts.push(coloured(g.translate(x, y, side * (HW + out)), hex));
    };
    disc(new THREE.CircleGeometry(WHEEL + 0.1, 16, 0, Math.PI), WHEEL, 0.016, FRAME);
    parts.push(box(x - WHEEL - 0.1, x + WHEEL + 0.1, FLOOR, WHEEL, side * (HW + 0.014), side * (HW + 0.018), FRAME));
    disc(new THREE.CircleGeometry(WHEEL - 0.02, 16), WHEEL, 0.022, TYRE);
    disc(new THREE.CircleGeometry(0.27, 12), WHEEL, 0.026, HUB);
  }
}

function front(x0: number, parts: THREE.BufferGeometry[]) {
  const at = (y: number) => x0 + NOSE - (0.12 * (y - 1.02)) / 1.6 + 0.02;
  const w = HW - BEVEL - 0.04;
  parts.push(quad([at(1.06), 1.06, w], [at(1.06), 1.06, -w], [at(2.5), 2.5, -w], [at(2.5), 2.5, w], GLASS));
  const xs = x0 + NOSE - 0.12 + 0.015;
  parts.push(box(xs - 0.03, xs, 2.52, 2.94, -w, w, FRAME));
  const xn = x0 + NOSE;
  parts.push(box(xn - 0.08, xn + 0.012, FLOOR + 0.02, 0.48, -w, w, SKIRT));
  parts.push(box(xn - 0.02, xn + 0.012, 0.66, 0.9, -0.32, 0.32, YELLOW));
  parts.push(box(xn + 0.01, xn + 0.016, 0.74, 0.8, -0.27, 0.12, DARK_GREY));
  for (const side of [-1, 1]) {
    parts.push(box(xn - 0.03, xn + 0.008, 0.56, 0.74, side * 0.72, side * 1.08, CLUSTER));
    for (const z of [0.8, 0.98]) {
      const c = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 10).rotateZ(Math.PI / 2).translate(xn + 0.012, 0.65, side * z);
      parts.push(coloured(c, LAMP));
    }
    parts.push(box(x0 + 0.2, x0 + NOSE + 0.3, 2.78, 2.84, side * (HW - 0.08), side * (HW + 0.06), FRAME));
    parts.push(box(x0 + NOSE + 0.22, x0 + NOSE + 0.34, 2.05, 2.8, side * (HW - 0.02), side * (HW + 0.12), FRAME));
  }
}

function rear(x0: number, parts: THREE.BufferGeometry[]) {
  const xr = x0 - TAIL;
  const w = HW - BEVEL - 0.1;
  parts.push(box(xr - 0.012, xr + 0.02, 1.6, 2.4, -w, w, GLASS));
  parts.push(box(xr - 0.012, xr + 0.02, 0.56, 1.18, -0.72, 0.72, DARK_GREY));
  parts.push(box(xr - 0.012, xr + 0.02, FLOOR + 0.02, 0.48, -w, w, SKIRT));
  for (const side of [-1, 1]) parts.push(box(xr - 0.016, xr + 0.02, 0.56, 1.36, side * 0.86, side * 1.1, TAIL_LIGHT));
}

function roofPod(x0: number, x1: number, parts: THREE.BufferGeometry[]) {
  parts.push(box(x0, x1, ROOF_TOP - 0.02, ROOF_TOP + 0.26, -0.95, 0.95, ROOF));
}

export function buildBus(kind: BusKind): SectionModel {
  const L = SECTION_LENGTH[kind];
  const x0 = -L / 2, x1 = L / 2;
  const [frontAxle, rearAxle] = AXLES[kind];
  const parts: THREE.BufferGeometry[] = [];
  const displays: THREE.BufferGeometry[] = [];
  const bodyStart = kind === 'lead' ? x0 : x0 + TAIL;
  const bodyEnd = kind === 'trailer' ? x1 - 0.4 : x1 - NOSE;
  parts.push(shell(bodyStart - (kind === 'lead' ? 0 : BEVEL), bodyEnd + (kind === 'trailer' ? 0 : BEVEL)));
  sideLivery(bodyStart + 0.1, bodyEnd - 0.1, SIDES, parts);
  if (kind !== 'trailer') axle(x1 - frontAxle, parts);
  axle(x0 + rearAxle, parts);

  if (kind !== 'trailer') {
    parts.push(cap(bodyEnd, [[0, FLOOR], [NOSE - 0.07, FLOOR], [NOSE, 0.42], [NOSE, 1.02], [NOSE - 0.12, 2.62], [NOSE - 0.14, ROOF_TOP - 0.1], [NOSE - 0.26, ROOF_TOP], [0, ROOF_TOP]], true));
    front(bodyEnd, parts);
    door(x1 - 1.3, parts);
    door(kind === 'solo' ? 0.6 : 0.3, parts);
    roofPod(x1 - 4.6, x1 - 1.6, parts);
    const xd = bodyEnd + NOSE - 0.12 + 0.02;
    const w = 0.92;
    displays.push(quad([xd, 2.56, w], [xd, 2.56, -w], [xd, 2.9, -w], [xd, 2.9, w], 0, [[0, 0], [1, 0], [1, 1], [0, 1]]));
  }
  if (kind !== 'lead') {
    parts.push(cap(bodyStart, [[0, FLOOR], [TAIL - 0.04, FLOOR], [TAIL, 0.5], [TAIL, 2.7], [TAIL - 0.08, ROOF_TOP - 0.02], [0, ROOF_TOP]], false));
    rear(bodyStart, parts);
    door(kind === 'solo' ? -4.0 : x1 - 1.6, parts);
    roofPod(bodyStart + 0.6, bodyStart + 2.8, parts);
    const xr = bodyStart - TAIL - 0.014, w = 0.35;
    displays.push(quad([xr, 2.72, w], [xr, 2.72, -w], [xr, 2.5, -w], [xr, 2.5, w], 0, [[0.22, 1], [0, 1], [0, 0], [0.22, 0]]));
  } else {
    parts.push(box(x0 - 0.42, x0 + 0.05, FLOOR + 0.05, ROOF_TOP - 0.08, -HW + 0.08, HW - 0.08, BELLOWS));
  }
  return { body: mergeGeometries(parts), display: mergeGeometries(displays) };
}
