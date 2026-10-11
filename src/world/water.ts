import type { CityData } from './cityData';
import { inRing } from './polyline';

export class WaterMap {
  private polygons: { rings: number[][]; minX: number; minZ: number; maxX: number; maxZ: number }[] = [];

  constructor(city: CityData) {
    for (const a of city.areas) {
      if (a.k !== 'water') continue;
      const outer = a.rings[0];
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < outer.length; i += 2) {
        minX = Math.min(minX, outer[i]);
        maxX = Math.max(maxX, outer[i]);
        minZ = Math.min(minZ, outer[i + 1]);
        maxZ = Math.max(maxZ, outer[i + 1]);
      }
      this.polygons.push({ rings: a.rings, minX, minZ, maxX, maxZ });
    }
  }

  contains(x: number, z: number): boolean {
    for (const p of this.polygons) {
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      let inside = false;
      for (const r of p.rings) if (inRing(r, x, z)) inside = !inside;
      if (inside) return true;
    }
    return false;
  }
}
