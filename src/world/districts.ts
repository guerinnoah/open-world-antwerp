import { inRing } from './polyline';

export interface District {
  n: string;
  p: number[];
}

export class Districts {
  private list: { name: string; ring: number[]; minX: number; minZ: number; maxX: number; maxZ: number }[] = [];

  constructor(data: District[]) {
    for (const { n, p } of data) {
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        minX = Math.min(minX, p[i]);
        maxX = Math.max(maxX, p[i]);
        minZ = Math.min(minZ, p[i + 1]);
        maxZ = Math.max(maxZ, p[i + 1]);
      }
      this.list.push({ name: n, ring: p, minX, minZ, maxX, maxZ });
    }
  }

  /** The smallest quarter: map:fetch-districts sorts them smallest first. */
  at(x: number, z: number): string {
    for (const d of this.list) {
      if (x < d.minX || x > d.maxX || z < d.minZ || z > d.maxZ) continue;
      if (inRing(d.ring, x, z)) return d.name;
    }
    return '';
  }
}
