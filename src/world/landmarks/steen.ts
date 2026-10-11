import type * as THREE from 'three';
import type { Landmark } from '../cityData';
import { Kit, alongRing, roundArch } from './kit';

const STONE = 0x8f8b83;
const STONE_LIGHT = 0xa7a196;
const SLATE = 0x4e5158;
const OPENING = 0x4f4a44;
const GLASS = 0x55606a;

export function steen(lm: Landmark): THREE.BufferGeometry {
  const kit = new Kit();
  kit.extrude(lm.ring, 0, 8, STONE);
  alongRing(lm.ring, 2.2, (x, z, rotY) => kit.box(1.1, 1.1, 0.9, x, 8, z, STONE_LIGHT, rotY), 1.5);

  kit.box(26, 14, 13, 6, 0, 2, STONE).gable(26, 13, 8, 6, 14, 2, SLATE, 'x');
  kit.group(19.1, 0, 2, Math.PI / 2, () => kit.facade(steppedGable(13, 14, 8, 5), STONE_LIGHT, 0.6));
  for (let x = -4; x <= 16; x += 4) kit.panel(1.1, 1.8, x, 9, 8.55, GLASS).panel(1.1, 1.8, x, 9, -4.55, GLASS);

  kit.box(7, 19, 7, -6, 0, -4, STONE_LIGHT).cone(5.2, 7, -6, 19, -4, SLATE, 4);
  kit.panel(1, 1.6, -6, 14, -0.45, GLASS);

  kit.box(5, 11, 12, 25, 0, 5, STONE);
  kit.group(27.6, 0, 5, Math.PI / 2, () => kit.facade(roundArch(3.2, 3.2, 4.8), OPENING, 0.3));
  for (const z of [-1.5, 11.5]) kit.cylinder(3, 3, 15, 26, 0, z, STONE_LIGHT, 12).cone(3.5, 7, 26, 15, z, SLATE, 12);

  for (const [x, z] of [[-26, 13], [-12, -13]]) kit.cylinder(1.8, 1.8, 11, x, 0, z, STONE_LIGHT, 8).cone(2.1, 4, x, 11, z, SLATE, 8);
  return kit.build();
}

function steppedGable(w: number, y0: number, h: number, steps: number): [number, number][] {
  const out: [number, number][] = [[-w / 2, y0 - 0.01]];
  const sw = w / 2 / steps, sh = h / steps;
  for (let i = 0; i < steps; i++) out.push([-w / 2 + i * sw, y0 + (i + 1) * sh], [-w / 2 + (i + 1) * sw, y0 + (i + 1) * sh]);
  for (let i = steps - 1; i >= 0; i--) out.push([w / 2 - (i + 1) * sw, y0 + (i + 1) * sh], [w / 2 - i * sw, y0 + (i + 1) * sh]);
  out.push([w / 2, y0 - 0.01]);
  return out;
}
