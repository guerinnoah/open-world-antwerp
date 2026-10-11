import type * as THREE from 'three';
import type { Landmark } from '../cityData';
import { Kit } from './kit';

const BRONZE = 0x6b6450;
const ROCK = 0x726a5b;
const BASIN = 0x9a9284;
const WATER = 0x5f7f8c;

export function brabo(_lm: Landmark): THREE.BufferGeometry {
  const kit = new Kit();
  kit.cylinder(3.9, 3.9, 0.55, 0, 0, 0, BASIN, 12).cylinder(3.55, 3.55, 0.5, 0, 0.1, 0, WATER, 12);
  kit.cylinder(2.5, 2.0, 1.9, 0, 0.5, 0, ROCK, 6, 0.3).cylinder(2.0, 1.4, 1.8, 0.2, 2.3, -0.1, ROCK, 5, 1.1);
  kit.cylinder(1.4, 0.8, 1.6, -0.1, 4.0, 0.1, ROCK, 6, 0.5);
  for (const [x, z, s, r] of [[1.9, 1.0, 1.1, 0.6], [-1.8, -1.2, 1.2, 1.2], [1.3, -1.9, 0.9, 2.1], [-1.4, 1.7, 1.0, 2.8]]) {
    kit.box(1.3 * s, 1.1 * s, 1.1 * s, x, 0.45, z, ROCK, r);
  }
  for (const [x, z, r] of [[2.4, 0.2, 0.4], [-2.3, 0.6, 2.2], [0.3, 2.5, 1.4], [0.1, -2.4, -1.3]]) {
    kit.box(1.4, 0.45, 0.5, x, 0.7, z, BRONZE, r).box(0.35, 0.35, 0.35, x + Math.cos(r) * 0.8, 0.95, z - Math.sin(r) * 0.8, BRONZE);
  }
  kit.group(0, 5.6, 0, 0, () => {
    kit.box(0.35, 1.25, 0.3, 0.25, 0, 0.18, BRONZE).box(0.32, 1.2, 0.3, -0.25, 0, -0.18, BRONZE);
    kit.box(0.5, 1.05, 0.7, 0, 1.2, 0, BRONZE).box(0.15, 1.4, 0.8, -0.32, 0.6, 0, BRONZE);
    kit.box(0.34, 0.36, 0.32, 0.03, 2.25, 0, BRONZE);
    kit.box(0.2, 0.8, 0.2, 0.25, 1.35, -0.42, BRONZE);
    kit.box(0.2, 1.1, 0.2, -0.05, 2.05, 0.42, BRONZE).box(0.35, 0.4, 0.3, -0.05, 3.15, 0.42, BRONZE);
  });
  return kit.build();
}
