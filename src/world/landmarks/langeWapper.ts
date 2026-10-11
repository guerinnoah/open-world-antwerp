import type * as THREE from 'three';
import type { Landmark } from '../cityData';
import { Kit } from './kit';

const BRONZE = 0x625c4c;
const STONE = 0xa29b8e;
const FACING = Math.atan2(47.8, 7.6);

export function langeWapper(_lm: Landmark): THREE.BufferGeometry {
  const kit = new Kit();
  kit.group(0, 0, 0, -FACING, () => {
    kit.box(3.4, 1.4, 3, 0, 0, 0, STONE).box(3.6, 0.2, 3.2, 0, 1.4, 0, STONE);
    kit.group(-0.4, 1.6, 0, 0, () => {
      kit.box(0.45, 2.2, 0.45, 0, 0, 0.35, BRONZE).box(0.45, 2.2, 0.45, 0, 0, -0.35, BRONZE);
      kit.cylinder(0.9, 0.6, 2.4, 0, 1.6, 0, BRONZE, 6);
      kit.box(0.28, 1.9, 0.28, 0, 2.1, 0.75, BRONZE).box(0.28, 1.9, 0.28, 0, 2.1, -0.75, BRONZE);
      kit.box(0.5, 0.55, 0.45, 0.05, 4.0, 0, BRONZE).cylinder(0.6, 0.6, 0.1, 0.05, 4.55, 0, BRONZE, 10).cylinder(0.32, 0.28, 0.45, 0.05, 4.65, 0, BRONZE, 8);
    });
    for (const z of [-0.8, 0.85]) {
      kit.group(0.9, 1.6, z, 0, () => {
        kit.box(0.3, 0.7, 0.4, 0, 0, 0, BRONZE).box(0.32, 0.6, 0.45, 0, 0.7, 0, BRONZE).box(0.25, 0.25, 0.25, -0.03, 1.3, 0, BRONZE);
      });
    }
  });
  return kit.build();
}
