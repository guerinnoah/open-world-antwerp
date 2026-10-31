import { RAPIER, type Physics } from '../physics/physics';
import { pointAt } from '../world/polyline';

interface Route {
  p: number[];
  cum: number[];
  len: number;
}

interface Probed {
  collider: RAPIER.Collider;
  gap: number; // to its near side: to a 7 m section's middle, followers drove into it
  across: number;
  side: number;
  dx: number;
  dz: number;
}

const STEP = 4;
let box: RAPIER.Cuboid | null = null;

/** Boxes along the route to see round bends; stops at the first box where found() is true. */
export function probeRoute(
  physics: Physics,
  route: Route,
  from: number,
  dir: 1 | -1,
  look: number,
  halfWidth: number,
  filterGroups: number,
  skip: (collider: RAPIER.Collider) => boolean,
  found: (hit: Probed) => boolean,
) {
  box ??= new RAPIER.Cuboid(1, 1);
  let any = false;
  for (let a = 0; a < look && !any; a += STEP) {
    const s0 = from + dir * a;
    if (s0 < 0 || s0 > route.len) break;
    const len = Math.min(STEP, look - a);
    const start = pointAt(route.p, route.cum, s0);
    const dx = start.dx * dir, dz = start.dz * dir;
    // longer than the piece, so boxes overlap on bends
    box.halfExtents = { x: len / 2 + 0.3, y: halfWidth };
    physics.world.intersectionsWithShape(
      { x: start.x + (dx * len) / 2, y: start.z + (dz * len) / 2 },
      Math.atan2(dz, dx),
      box,
      (collider) => {
        const c = collider.translation();
        const ox = c.x - start.x, oz = c.y - start.z;
        const cross = dx * oz - dz * ox;
        const counts = found({
          collider,
          gap: a + ox * dx + oz * dz - extent(collider, dx, dz),
          across: Math.abs(cross) - extent(collider, -dz, dx),
          side: cross < 0 ? -1 : 1,
          dx,
          dz,
        });
        any ||= counts;
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      filterGroups,
      undefined,
      undefined,
      (collider) => !skip(collider),
    );
  }
}

export function extent(collider: RAPIER.Collider, ux: number, uz: number): number {
  if (collider.shapeType() === RAPIER.ShapeType.Ball) return collider.radius();
  if (collider.shapeType() !== RAPIER.ShapeType.Cuboid) return 1;
  const h = collider.halfExtents()!, a = collider.rotation();
  const c = Math.cos(a), s = Math.sin(a);
  return Math.abs(h.x * (c * ux + s * uz)) + Math.abs(h.y * (c * uz - s * ux));
}
