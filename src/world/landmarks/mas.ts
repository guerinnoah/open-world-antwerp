import type * as THREE from 'three';
import type { Landmark } from '../cityData';
import { Kit } from './kit';

const SANDSTONE = 0x8e3d2c;
const SANDSTONE_DARK = 0x6e2f23;
const GLASS = 0x9fb3bd;
const SILVER = 0xc9ccd0;
const RAIL = 0x2b2f33;
const H = 62.7, FLOORS = 10, SIDE = 39, GALLERY = 8.5;

export function mas(_lm: Landmark): THREE.BufferGeometry {
  const kit = new Kit();
  const fh = H / FLOORS, half = SIDE / 2, box = SIDE - GALLERY;
  for (let i = 0; i < FLOORS; i++) {
    kit.group(0, i * fh, 0, i * (Math.PI / 2), () => {
      const zBox = -half + box / 2;
      kit.box(SIDE, fh - 0.35, box, 0, 0, zBox, SANDSTONE).box(SIDE + 0.1, 0.35, box + 0.1, 0, fh - 0.7, zBox, SANDSTONE_DARK);
      kit.extrude(galleryOutline(half - 0.6, half - box, half - 0.5), 0, fh - 0.35, GLASS);
      kit.box(SIDE, 0.35, GALLERY, 0, fh - 0.7, half - GALLERY / 2, SANDSTONE_DARK); // gallery ceiling
      for (let x = -17; x <= 17; x += 3.4) kit.panel(0.35, 0.45, x + (i % 2) * 1.7, fh * 0.45, -half - 0.03, SILVER, 0, 0.06);
      for (let z = -half + 2; z < half - GALLERY; z += 3.4) {
        for (const x of [half + 0.03, -half - 0.03]) kit.panel(0.35, 0.45, x, fh * 0.45, z + (i % 2) * 1.7, SILVER, Math.PI / 2, 0.06);
      }
    });
  }
  const roof = H - 0.35;
  kit.box(14, 3, 9, 0, roof, 0, GLASS);
  for (const z of [half - 0.2, -half + 0.2]) {
    kit.box(SIDE, 0.08, 0.08, 0, roof + 1.1, z, RAIL).box(0.08, 0.08, SIDE, z, roof + 1.1, 0, RAIL);
    for (let u = -half + 0.2; u <= half; u += 3.2) kit.box(0.06, 1.1, 0.06, u, roof, z, RAIL).box(0.06, 1.1, 0.06, z, roof, u, RAIL);
  }
  kit.box(2.8, 2.6, 0.2, -12, 0, 19.45, 0x2a2e33).box(2.4, 2.3, 0.22, -12, 0, 19.45, 0x7f97a6);
  return kit.build();
}

function galleryOutline(halfX: number, z0: number, z1: number): number[] {
  const ring = [-halfX, z0, halfX, z0];
  const steps = 32;
  for (let k = 0; k <= steps; k++) {
    const x = halfX - (k / steps) * 2 * halfX;
    ring.push(x, z1 + Math.sin(k * (Math.PI / 2)) * 0.45);
  }
  return ring;
}
