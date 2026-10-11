import type * as THREE from 'three';
import type { Landmark } from '../cityData';
import { GOLD, Kit, roundArch } from './kit';

const STONE = 0xddd6c6;
const STONE_LIGHT = 0xebe5d8;
const STONE_DARK = 0xb3aa98;
const OPENING = 0x625a51;
const GLASS = 0x56636f;
const SLATE = 0x4d5058;

const W = 68.2, D = 27.8, FRONT = 13.9, EAVES = 16;

export function stadhuis(_lm: Landmark): THREE.BufferGeometry {
  const kit = new Kit();
  body(kit);
  frontispiece(kit);
  flags(kit);
  return kit.build();
}

function body(kit: Kit) {
  kit.box(W, EAVES, D, 0, 0, 0, STONE);
  kit.box(W + 0.3, 4.6, D + 0.3, 0, 0, 0, STONE_DARK);
  for (const y of [4.6, 9, 12.9]) kit.box(W + 0.5, 0.45, D + 0.5, 0, y, 0, STONE_DARK);
  const bays = 20, bay = W / bays;
  for (let i = 0; i < bays; i++) {
    const x = -W / 2 + bay * (i + 0.5);
    for (const side of [1, -1]) {
      const z = side * (D / 2 + 0.16);
      kit.group(x, 0, z, 0, () => kit.facade(roundArch(2.1, 2.4, 3.7), OPENING, 0.15));
      if (Math.abs(x) < 8.5 && side > 0) continue;
      kit.panel(1.3, 2.7, x, 5.6, z, GLASS).panel(1.3, 2.7, x, 9.8, z, GLASS);
      kit.box(0.35, 8, 0.25, x - bay / 2, 4.9, z, STONE_LIGHT);
    }
  }
  kit.box(W - 0.4, 3, D - 0.4, 0, 13.35, 0, OPENING);
  for (let x = -W / 2 + 0.9; x < W / 2; x += 1.7) for (const z of [D / 2 - 0.3, -D / 2 + 0.3]) kit.box(0.35, 3, 0.35, x, 13.35, z, STONE_LIGHT);
  kit.box(W + 0.6, 0.5, D + 0.6, 0, EAVES - 0.25, 0, STONE_DARK);
  kit.hip(W, D, 7, 0, EAVES, 0, SLATE);
  for (let x = -28; x <= 28; x += 7) {
    if (Math.abs(x) < 9) continue;
    for (const side of [1, -1]) {
      const z = side * 9.5;
      kit.box(2.2, 2.2, 2, x, EAVES + 1, z, STONE).gable(2.2, 2.4, 1.3, x, EAVES + 3.2, z, SLATE, 'z');
      kit.panel(1.2, 1.4, x, EAVES + 1.4, z + side * 1.05, GLASS);
    }
  }
}

function frontispiece(kit: Kit) {
  const zc = 11.2, front = FRONT + 0.6;
  kit.box(16.2, 21, 6.6, 0, 0, zc, STONE_LIGHT);
  for (const y of [4.6, 9, 12.9, 17]) kit.box(16.6, 0.45, 7, 0, y, zc, STONE_DARK);
  for (const x of [-4.8, 0, 4.8]) {
    kit.group(x, 0, front + 0.05, 0, () => kit.facade(roundArch(2.4, 2.6, 4.1), OPENING, 0.15));
    kit.panel(1.6, 2.8, x, 5.4, front, GLASS).panel(1.6, 2.8, x, 9.6, front, GLASS).panel(1.4, 2.6, x, 13.6, front, GLASS);
  }
  for (const x of [-7.6, -2.4, 2.4, 7.6]) kit.box(0.6, 16, 0.5, x, 4.6, front + 0.1, STONE);
  kit.box(8.2, 5, 5.8, 0, 21, zc, STONE_LIGHT).box(8.6, 0.4, 6.2, 0, 26, zc, STONE_DARK);
  kit.panel(1.6, 3.2, 0, 21.8, zc + 2.95, OPENING).box(0.8, 2.2, 0.5, 0, 22.2, zc + 3.0, GOLD);
  for (const x of [-7.4, 7.4]) kit.box(1.4, 6, 1.4, x, 21, 12.9, STONE_LIGHT).cone(0.9, 3.5, x, 27, 12.9, STONE, 4);
  kit.box(5.5, 8, 5, 0, 26.4, zc, STONE_LIGHT).panel(1.8, 4, 0, 28.5, zc + 2.55, GLASS);
  for (const x of [-3.3, 3.3]) kit.facade([[0, 0], [0.9, 0], [0, 3]].map(([u, v]) => [x < 0 ? x - u : x + u, 26.4 + v] as [number, number]), STONE_LIGHT, 0.8);
  kit.box(2.6, 3, 3, 0, 34.4, zc, STONE_LIGHT).box(0.6, 1.4, 0.6, 0, 37.4, zc, GOLD).box(2.4, 0.5, 0.25, 0, 38.2, zc, GOLD);
}

function flags(kit: Kit) {
  const z = FRONT + 1;
  const designs: number[][] = [
    [0x2b2b2b, 0xf2c200, 0xd8232a],
    [0xf6d000],
    [0x22409a],
    [0xd8232a, 0xf2f2ef],
  ];
  const xs = [-30, -24, -18, -12, 12, 18, 24, 30];
  xs.forEach((x, i) => {
    const colours = designs[i % designs.length];
    kit.box(0.08, 0.08, 1.4, x, 8.9, FRONT + 0.7, STONE_DARK);
    const w = 1.2 / colours.length;
    colours.forEach((c, k) => kit.panel(w, 1.7, x - 0.6 + w * (k + 0.5), 7.2, z, c, 0, 0.05));
    if (i % designs.length === 1) kit.panel(0.45, 0.6, x, 7.8, z + 0.04, 0x2b2b2b, 0, 0.05);
  });
}
