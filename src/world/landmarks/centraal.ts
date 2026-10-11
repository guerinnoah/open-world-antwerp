import * as THREE from 'three';
import type { Landmark } from '../cityData';
import { GOLD, Kit, roundArch } from './kit';

const STONE = 0xd8cfbf;
const STONE_BAND = 0xb7ab96;
const ROOF = 0x55585f;
const DOME = 0x56625c;
const GLASS = 0x6f8394;
const HALL_GLASS = 0xa9bac6;
const IRON = 0x4a5058;

export function centraal(_lm: Landmark): THREE.BufferGeometry {
  const kit = new Kit();
  stationBuilding(kit);
  domedHall(kit, 95, 1.5);
  for (const z of [-16.5, 16.5]) cornerTower(kit, 120, z);
  for (const z of [-35, 35]) wingTurret(kit, 63, z);
  trainHall(kit);
  return kit.build();
}

function stationBuilding(kit: Kit) {
  kit.box(57.3, 26, 60, 88.65, 0, 0, STONE).box(57.7, 1.2, 60.4, 88.65, 10, 0, STONE_BAND).hip(57.3, 60, 8, 88.65, 26, 0, ROOF);
  for (const z of [-34.5, 34.5]) kit.box(22, 20, 9, 71, 0, z, STONE).hip(22, 9, 4, 71, 20, z, ROOF);

  // Entrance front on the footprint's facade line (x = 122.4), where halls/centraal.ts puts the doors.
  kit.box(16, 34, 26, 114.2, 0, 0, STONE).box(16.4, 1.2, 26.4, 114.2, 10, 0, STONE_BAND).gable(16, 26, 7, 114.2, 34, 0, ROOF, 'x');
  kit.group(122.4, 0, 0, Math.PI / 2, () => {
    kit.facade(roundArch(13, 9, 24, 12), GLASS, 0.3);
    kit.box(14, 1, 0.6, 0, 8, 0, STONE_BAND);
    for (const u of [-3.25, 0, 3.25]) kit.box(0.4, 15, 0.5, u, 9, 0, STONE_BAND);
    kit.cylinder(2.2, 2.2, 0.4, 0, 27, 0.2, GOLD, 16).cylinder(1.7, 1.7, 0.5, 0, 27, 0.25, STONE, 16);
    for (const u of [-5.5, -1.8, 1.8, 5.5]) kit.box(2.2, 6, 0.2, u, 0, 0.15, 0x6b5f52);
  });
  kit.cone(1, 3, 122.2, 41, 0, GOLD, 8);

  for (const z of [-30.1, 30.1]) {
    for (let x = 64; x <= 114; x += 6) {
      kit.panel(2.4, 6, x, 3, z, GLASS).panel(2.4, 6.5, x, 13, z, GLASS).panel(2.4, 4, x, 21, z, GLASS);
    }
  }
  for (const z of [-26, 26]) kit.panel(2.4, 6.5, 117.4, 13, z, GLASS, Math.PI / 2).panel(2.4, 6, 117.4, 3, z, GLASS, Math.PI / 2);
}

function domedHall(kit: Kit, x: number, z: number) {
  kit.box(26, 40, 29, x, 0, z, STONE).box(26.4, 1.5, 29.4, x, 30, z, STONE_BAND);
  for (const dx of [-11.5, 11.5]) for (const dz of [-13, 13]) kit.cylinder(1.3, 1.3, 6, x + dx, 40, z + dz, STONE, 8).cone(1.4, 4, x + dx, 46, z + dz, ROOF, 8);
  kit.cylinder(12, 12, 7, x, 40, z, STONE, 16);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    kit.panel(3.2, 5, x + Math.cos(a) * 12.05, 40.8, z + Math.sin(a) * 12.05, GLASS, Math.PI / 2 - a);
  }
  const rings: [number, number, number][] = [[12.6, 11.6, 4], [11.6, 9.4, 4], [9.4, 6.2, 4], [6.2, 3, 3.5]];
  let y = 47;
  for (const [r0, r1, h] of rings) {
    kit.cylinder(r0, r1, h, x, y, z, DOME, 8, Math.PI / 8);
    y += h;
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ribs(kit, x, z, a, rings, 47);
  }
  kit.cylinder(3, 3, 5.5, x, 62.5, z, STONE, 8).cylinder(3.4, 3.4, 0.6, x, 68, z, STONE_BAND, 8);
  kit.cone(3.2, 6, x, 68.6, z, DOME, 8).cylinder(0.25, 0.25, 0.8, x, 74.2, z, GOLD, 6).cone(0.6, 1.2, x, 74.8, z, GOLD, 6);
}

function ribs(kit: Kit, x: number, z: number, angle: number, rings: [number, number, number][], y0: number) {
  let y = y0;
  for (const [r0, r1, h] of rings) {
    const a = new THREE.Vector3(x + Math.cos(angle) * (r0 + 0.1), y, z + Math.sin(angle) * (r0 + 0.1));
    const b = new THREE.Vector3(x + Math.cos(angle) * (r1 + 0.1), y + h, z + Math.sin(angle) * (r1 + 0.1));
    const side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(0.25);
    kit.triangles(twoSided(a.clone().sub(side), a.clone().add(side), b.clone().add(side), b.clone().sub(side)), GOLD);
    y += h;
  }
}

const twoSided = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => [[a, b, c], [a, c, d], [a, c, b], [a, d, c]];

function cornerTower(kit: Kit, x: number, z: number) {
  kit.box(9, 35, 9, x, 0, z, STONE).box(9.4, 1, 9.4, x, 10, z, STONE_BAND).box(9.4, 1, 9.4, x, 34, z, STONE_BAND);
  for (const [dx, dz, r] of [[4.55, 0, Math.PI / 2], [-4.55, 0, Math.PI / 2], [0, 4.55, 0], [0, -4.55, 0]] as const) {
    kit.panel(2, 6, x + dx, 14, z + dz, GLASS, r).panel(2, 5, x + dx, 24, z + dz, GLASS, r);
  }
  kit.cylinder(4, 4, 8, x, 35, z, STONE, 8, Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    kit.panel(1.4, 4.5, x + Math.cos(a) * 3.75, 36.5, z + Math.sin(a) * 3.75, 0x4f5961, Math.PI / 2 - a);
  }
  kit.cone(4.4, 9, x, 43, z, ROOF, 8, Math.PI / 8).cone(0.5, 1.5, x, 52, z, GOLD, 6);
}

function wingTurret(kit: Kit, x: number, z: number) {
  kit.cylinder(3, 3, 26, x, 0, z, STONE, 8, Math.PI / 8).cone(3.4, 6, x, 26, z, ROOF, 8, Math.PI / 8).cone(0.3, 1, x, 32, z, GOLD, 6);
}

function trainHall(kit: Kit) {
  const x0 = -127, x1 = 60, zc = 1.5, half = 37.5, wall = 12, rise = 32;
  const steps = 14;
  const arc = (i: number) => {
    const t = (i / steps) * Math.PI;
    return [zc - Math.cos(t) * half, wall + Math.sin(t) * rise] as const;
  };
  for (const s of [-1, 1]) kit.box(x1 - x0, wall, 1.5, (x0 + x1) / 2, 0, zc + s * half, 0x9a8a78);
  const tris: THREE.Vector3[][] = [];
  for (let i = 0; i < steps; i++) {
    const [za, ya] = arc(i), [zb, yb] = arc(i + 1);
    const q = [new THREE.Vector3(x0, ya, za), new THREE.Vector3(x1, ya, za), new THREE.Vector3(x1, yb, zb), new THREE.Vector3(x0, yb, zb)];
    tris.push([q[0], q[2], q[1]], [q[0], q[3], q[2]], [q[0], q[1], q[2]], [q[0], q[2], q[3]]);
  }
  kit.triangles(tris, HALL_GLASS);
  for (let x = x0; x <= x1 + 0.1; x += 11) {
    const rib: THREE.Vector3[][] = [];
    for (let i = 0; i < steps; i++) {
      const [za, ya] = arc(i), [zb, yb] = arc(i + 1);
      for (const dx of [-0.35, 0.35]) {
        const n = new THREE.Vector3(0, zb - za, -(yb - ya)).normalize().multiplyScalar(0.6);
        const a = new THREE.Vector3(x + dx, ya, za).add(n), b = new THREE.Vector3(x + dx, yb, zb).add(n);
        const c = new THREE.Vector3(x + dx, yb, zb), d = new THREE.Vector3(x + dx, ya, za);
        rib.push(...twoSided(a, b, c, d));
      }
    }
    kit.triangles(rib, IRON);
  }
  kit.box(x1 - x0, 0.8, 1.2, (x0 + x1) / 2, wall + rise + 0.1, zc, IRON);
  kit.group(x0, 0, zc, Math.PI / 2, () => {
    const outline: [number, number][] = [[half, 0], [half, wall]];
    for (let i = 1; i < steps; i++) {
      const t = (i / steps) * Math.PI;
      outline.push([Math.cos(t) * half, wall + Math.sin(t) * rise]);
    }
    outline.push([-half, wall], [-half, 0]);
    kit.facade(outline, GLASS, 0.4);
    for (let u = -30; u <= 30; u += 7.5) {
      const h = wall + rise * Math.sqrt(Math.max(0, 1 - (u / half) ** 2));
      kit.box(0.5, h, 0.7, u, 0, 0, IRON);
    }
    kit.box(2 * half, 0.6, 0.7, 0, wall, 0, IRON);
  });
}
