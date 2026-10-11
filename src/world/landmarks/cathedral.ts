import * as THREE from 'three';
import type { Landmark } from '../cityData';
import { GOLD, Kit } from './kit';

const STONE = 0xd6cfc0;
const STONE_SHADE = 0xbdb3a1;
const ROOF = 0x51545c;
const GLASS = 0x5d6c7b;
const DOOR = 0x6e5d4c;

const NAVE = { x0: -4, x1: 58, z: -2, w: 14, eaves: 29, ridge: 43 };

export function cathedral(lm: Landmark): THREE.BufferGeometry {
  const kit = new Kit();
  kit.extrude(lm.ring, 0, 6, STONE_SHADE);
  const chapels = lm.parts.find((p) => p.h === 13 && p.ring.length > 100);
  if (chapels) kit.extrude(chapels.ring, 0, 11, STONE).extrude(chapels.ring, 11, 12.5, ROOF);

  nave(kit);
  aisles(kit);
  transept(kit);
  choir(kit);
  crossingTower(kit, -11, -2);
  westFront(kit);
  northTower(kit, 53, 10.5);
  southTower(kit, 53.5, -15.5);
  return kit.build();
}

function nave(kit: Kit) {
  const { x0, x1, z, w, eaves, ridge } = NAVE;
  const len = x1 - x0, cx = (x0 + x1) / 2;
  kit.box(len, eaves, w, cx, 0, z, STONE).gable(len, w, ridge - eaves, cx, eaves, z, ROOF, 'x');
  for (let x = x0 + 4; x < x1 - 8; x += 6.5) {
    for (const s of [-1, 1]) kit.panel(2.4, 7, x, 20, z + s * (w / 2 + 0.05), GLASS).cone(0.7, 3, x + 3.2, eaves, z + s * (w / 2), STONE_SHADE, 4);
  }
}

function aisles(kit: Kit) {
  const x0 = -4, x1 = 46, len = x1 - x0, cx = (x0 + x1) / 2;
  for (const [zIn, zOut] of [[5, 26], [-9, -31]]) {
    const w = Math.abs(zOut - zIn), cz = (zIn + zOut) / 2, s = Math.sign(zOut);
    kit.box(len, 14, w, cx, 0, cz, STONE);
    for (let i = 0; i < 3; i++) kit.gable(len, w / 3, 5, cx, 14, zIn + s * (w / 6 + (i * w) / 3), ROOF, 'x');
    for (let x = x0 + 2; x <= x1 - 1; x += 7) {
      kit.box(1.6, 15, 2.4, x, 0, zOut + s * 0.9, STONE_SHADE).cone(1, 4.5, x, 15, zOut + s * 0.9, STONE_SHADE, 4);
      if (x + 3.5 < x1) kit.group(x + 3.5, 0, zOut + s * 0.05, 0, () => kit.facade(lancet(3.2, 5, 12.5), GLASS, 0.3));
    }
    for (let x = x0 + 2; x <= x1 - 1; x += 7) {
      const a = new THREE.Vector3(x, 19, zOut + s * 0.9), b = new THREE.Vector3(x, 27, NAVE.z + s * (NAVE.w / 2));
      strut(kit, a, b, 0.7, STONE_SHADE);
    }
  }
}

function transept(kit: Kit) {
  const cx = -11, w = 14;
  for (const [zIn, zOut] of [[5, 30], [-9, -33]]) {
    const len = Math.abs(zOut - zIn), cz = (zIn + zOut) / 2, s = Math.sign(zOut);
    kit.box(w, NAVE.eaves, len, cx, 0, cz, STONE).gable(w, len, NAVE.ridge - NAVE.eaves, cx, NAVE.eaves, cz, ROOF, 'z');
    kit.group(cx, 0, zOut, 0, () => {
      kit.facade([[-w / 2, NAVE.eaves], [w / 2, NAVE.eaves], [0, NAVE.ridge]], STONE, 0.6);
      kit.group(0, 0, s * 0.35, 0, () => kit.facade(lancet(6.5, 9, 25), GLASS, 0.3));
      kit.facade(lancet(4, 0, 8), DOOR, 0.8);
    });
    for (const dx of [-w / 2, w / 2]) kit.box(2, NAVE.eaves + 2, 2, cx + dx, 0, zOut, STONE_SHADE).cone(1.3, 6, cx + dx, NAVE.eaves + 2, zOut, STONE_SHADE, 8);
  }
}

function choir(kit: Kit) {
  const x0 = -43, x1 = -18, len = x1 - x0, cx = (x0 + x1) / 2, { z, w, eaves, ridge } = NAVE;
  kit.box(len, eaves, w, cx, 0, z, STONE).gable(len, w, ridge - eaves, cx, eaves, z, ROOF, 'x');
  kit.cylinder(7.5, 7.5, eaves, x0, 0, z, STONE, 8, Math.PI / 8).cone(8, ridge - eaves, x0, eaves, z, ROOF, 8, Math.PI / 8);
  for (let x = x0 + 4; x < x1; x += 6) for (const s of [-1, 1]) kit.panel(2.4, 8, x, 17, z + s * (w / 2 + 0.05), GLASS);
  for (let i = 0; i < 5; i++) {
    const a = Math.PI / 2 + (i + 0.5) * (Math.PI / 5);
    kit.panel(2.4, 8, x0 + Math.cos(a) * 7.05, 17, z + Math.sin(a) * 7.05, GLASS, Math.PI / 2 - a);
  }
}

function crossingTower(kit: Kit, x: number, z: number) {
  kit.cylinder(6.2, 6.2, 8, x, NAVE.ridge - 2, z, STONE, 8, Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    kit.panel(1.6, 4.5, x + Math.cos(a) * 6.1, NAVE.ridge, z + Math.sin(a) * 6.1, GLASS, Math.PI / 2 - a);
  }
  let y = NAVE.ridge + 6;
  for (const [r0, r1, h] of [[6.6, 6.2, 2], [6.2, 4.6, 3], [4.6, 2, 2.5], [2, 1.2, 1]]) {
    kit.cylinder(r0, r1, h, x, y, z, ROOF, 8, Math.PI / 8);
    y += h;
  }
  kit.cylinder(1.2, 1.2, 2.5, x, y, z, STONE, 8).cone(1.5, 2.5, x, y + 2.5, z, ROOF, 8).cone(0.3, 1, x, y + 5, z, GOLD, 6);
}

function westFront(kit: Kit) {
  const x = 60.5, z = -3, w = 12;
  kit.box(5, NAVE.eaves, w, x - 2.5, 0, z, STONE);
  kit.group(x, 0, z, Math.PI / 2, () => {
    kit.facade([[-w / 2, NAVE.eaves], [w / 2, NAVE.eaves], [0, NAVE.ridge + 1]], STONE, 1);
    kit.group(0, 0, 0.4, 0, () => kit.facade(lancet(8, 16, 33), GLASS, 0.3));
    kit.group(0, 0, 0.4, 0, () => kit.facade(lancet(5.5, 0, 11), DOOR, 0.3));
    kit.box(10, 1, 0.8, 0, 13.5, 0.2, STONE_SHADE);
  });
}

function northTower(kit: Kit, x: number, z: number) {
  kit.box(13, 70, 13, x, 0, z, STONE);
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    kit.box(3, 40, 3, x + dx * 6.8, 0, z + dz * 6.8, STONE_SHADE).box(2.4, 30, 2.4, x + dx * 6.6, 40, z + dz * 6.6, STONE_SHADE);
    kit.cone(1.4, 7, x + dx * 6.6, 70, z + dz * 6.6, STONE_SHADE, 4);
  }
  for (const [dx, dz, r] of [[6.55, 0, Math.PI / 2], [-6.55, 0, Math.PI / 2], [0, 6.55, 0], [0, -6.55, 0]] as const) {
    kit.group(x + dx, 0, z + dz, r, () => {
      kit.facade(lancet(4, 32, 45), GLASS, 0.3);
      kit.facade(lancet(4.5, 52, 66), GLASS, 0.3);
    });
  }
  kit.box(10.5, 20, 10.5, x, 70, z, STONE);
  for (const [dx, dz, r] of [[5.3, 0, Math.PI / 2], [-5.3, 0, Math.PI / 2], [0, 5.3, 0], [0, -5.3, 0]] as const) {
    kit.group(x + dx, 0, z + dz, r, () => kit.facade(lancet(3.6, 73, 87), GLASS, 0.3));
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    kit.cone(0.8, 5, x + Math.cos(a) * 6, 90, z + Math.sin(a) * 6, STONE_SHADE, 4);
  }
  kit.cylinder(5, 4.6, 14, x, 90, z, STONE, 8, Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    kit.group(x + Math.cos(a) * 4.75, 0, z + Math.sin(a) * 4.75, Math.PI / 2 - a, () => kit.facade(lancet(2, 92, 102), GLASS, 0.25));
    kit.cone(0.5, 4, x + Math.cos(a + Math.PI / 8) * 5.2, 104, z + Math.sin(a + Math.PI / 8) * 5.2, STONE_SHADE, 4);
  }
  kit.cylinder(3.2, 2.8, 6, x, 104, z, STONE, 8, Math.PI / 8).cylinder(2, 1.6, 6, x, 110, z, STONE, 8, Math.PI / 8);
  kit.cone(1.6, 6, x, 116, z, STONE_SHADE, 8, Math.PI / 8).cylinder(0.12, 0.12, 1, x, 121.6, z, GOLD, 4).cone(0.35, 0.8, x, 122.2, z, GOLD, 6);
}

function southTower(kit: Kit, x: number, z: number) {
  kit.box(13, 55, 12, x, 0, z, STONE);
  for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) kit.box(2.6, 50, 2.6, x + dx * 6.6, 0, z + dz * 6.1, STONE_SHADE);
  for (const [dx, dz, r] of [[6.55, 0, Math.PI / 2], [-6.55, 0, Math.PI / 2], [0, -6.05, 0]] as const) {
    kit.group(x + dx, 0, z + dz, r, () => kit.facade(lancet(4, 30, 45), GLASS, 0.3));
  }
  kit.box(9, 8, 8.5, x, 55, z, STONE).hip(9.4, 8.9, 2.5, x, 63, z, ROOF);
}

function strut(kit: Kit, a: THREE.Vector3, b: THREE.Vector3, size: number, colour: number) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const g = new THREE.BoxGeometry(size, len, size).applyQuaternion(q).translate(mid.x, mid.y, mid.z);
  const pos = g.toNonIndexed().getAttribute('position');
  const tris: THREE.Vector3[][] = [];
  for (let i = 0; i < pos.count; i += 3) {
    tris.push([0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, i + k)));
  }
  kit.triangles(tris, colour);
}

function lancet(w: number, y0: number, top: number, spring = y0 + (top - y0) * 0.6): [number, number][] {
  const out: [number, number][] = [[-w / 2, y0], [w / 2, y0], [w / 2, spring]];
  const steps = 5, rise = top - spring;
  for (let i = 1; i < steps; i++) {
    const phi = (i / steps) * (Math.PI / 3);
    out.push([-w / 2 + w * Math.cos(phi), spring + (rise * Math.sin(phi)) / Math.sin(Math.PI / 3)]);
  }
  out.push([0, top]);
  for (let i = steps - 1; i >= 1; i--) {
    const phi = (i / steps) * (Math.PI / 3);
    out.push([w / 2 - w * Math.cos(phi), spring + (rise * Math.sin(phi)) / Math.sin(Math.PI / 3)]);
  }
  out.push([-w / 2, spring]);
  return out;
}
