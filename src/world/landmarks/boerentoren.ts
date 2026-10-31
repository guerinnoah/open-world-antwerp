import type * as THREE from 'three';
import type { Landmark } from '../cityData';
import { Kit, alongRing } from './kit';

const BRICK = 0xcdb98f;
const BRICK_DARK = 0xb19d74;
const WINDOW = 0x5a6470;
const MAST = 0xb8bcc0;

export function boerentoren(lm: Landmark): THREE.BufferGeometry {
  const kit = new Kit();
  // The map's 65 m parts are neighbours whose laser scan caught the tower: use only these stages.
  const ring = (h: number) => lm.parts.find((p) => p.h === h)?.ring;
  stage(kit, lm.ring, 0, 30);
  const stages: [number[] | undefined, number, number][] = [[ring(56), 30, 56], [ring(82), 56, 82], [ring(97), 82, 89]];
  for (const [r, y0, y1] of stages) if (r) stage(kit, r, y0, y1);
  const top = ring(97);
  if (top) {
    const [cx, cz] = centre(top);
    kit.box(6, 3, 6, cx, 89, cz, BRICK_DARK).cylinder(0.6, 0.35, 5, cx, 92, cz, MAST, 8).cylinder(0.15, 0.1, 2, cx, 97, cz, MAST, 6);
  }
  return kit.build();
}

function stage(kit: Kit, ring: number[], y0: number, y1: number) {
  kit.extrude(ring, y0, y1, BRICK).extrude(ring, y1 - 0.8, y1, BRICK_DARK);
  alongRing(ring, 2.4, (x, z, rotY, nx, nz) => {
    kit.panel(1.1, y1 - y0 - 3.5, x + nx * 0.05, y0 + 1.5, z + nz * 0.05, WINDOW, rotY, 0.1);
  }, 3);
}

function centre(ring: number[]): [number, number] {
  let x = 0, z = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i];
    z += ring[i + 1];
  }
  return [x / (ring.length / 2), z / (ring.length / 2)];
}
