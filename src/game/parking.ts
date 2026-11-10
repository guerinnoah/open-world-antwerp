import { VEHICLE_TYPES, Vehicle, paintFor, type VehicleSpec } from '../actors/vehicle';
import { mulberry32 } from '../core/util';
import type { Physics } from '../physics/physics';
import type { NavGraph } from '../world/navGraph';
import { TRAM_HALF, type trackTest } from '../world/trackClearance';
import type { WaterMap } from '../world/water';

/** Asleep along the kerbs of wide, slow streets; `start` is kept clear. */
export function parkCars(
  physics: Physics, drive: NavGraph, water: WaterMap, onTramTrack: ReturnType<typeof trackTest>, start: { x: number; z: number }, count: number,
): Vehicle[] {
  const rand = mulberry32(2000); // fixed seed: every player gets the same parked cars ('took' messages rely on it)
  const segments: { x0: number; z0: number; x1: number; z1: number; len: number; w: number }[] = [];
  let total = 0;
  for (const e of drive.edges) {
    if (e.w < (e.o ? 6.6 : 10.4) || e.s > 14) continue;
    for (let i = 0; i < e.p.length - 2; i += 2) {
      const [x0, z0, x1, z1] = [e.p[i], e.p[i + 1], e.p[i + 2], e.p[i + 3]];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 8) continue;
      segments.push({ x0, z0, x1, z1, len, w: e.w });
      total += len;
    }
  }
  const weights = VEHICLE_TYPES.reduce((s, [, w, p = w]) => s + p, 0);
  const pickType = (): VehicleSpec => {
    let r = rand() * weights;
    for (const [spec, w, p = w] of VEHICLE_TYPES) if ((r -= p) < 0) return spec;
    return VEHICLE_TYPES[0][0];
  };

  const parked: Vehicle[] = [];
  for (let attempt = 0; attempt < count * 3 && parked.length < count; attempt++) {
    let d = rand() * total;
    const s = segments.find((seg) => (d -= seg.len) < 0) ?? segments[segments.length - 1];
    const t = 0.15 + rand() * 0.7;
    const side = rand() < 0.5 ? 1 : -1;
    const ux = (s.x1 - s.x0) / s.len, uz = (s.z1 - s.z0) / s.len;
    const spec = pickType();
    const off = side * (s.w / 2 - spec.width / 2 - 0.2);
    const x = s.x0 + (s.x1 - s.x0) * t - uz * off;
    const z = s.z0 + (s.z1 - s.z0) * t + ux * off;
    const angle = Math.atan2(uz, ux) + (side > 0 ? 0 : Math.PI);
    if (physics.boxOverlaps(x, z, angle, spec.length / 2 + 0.4, spec.width / 2 + 0.1)) continue;
    if ([-0.5, 0, 0.5].some((k) => onTramTrack(x + ux * k * spec.length, z + uz * k * spec.length, TRAM_HALF + spec.width / 2))) continue;
    if (Math.hypot(x - start.x, z - start.z) < 3 || water.contains(x, z)) continue;
    const v = new Vehicle(physics.world, spec, paintFor(spec, rand), x, z, angle);
    v.body.sleep();
    parked.push(v);
  }
  return parked;
}
