// 2D on the ground plane: Rapier (x, y) is world (x, z), and Rapier angle θ is three.js rotation.y = -θ.
import RAPIER from '@dimforge/rapier2d-compat';
import type { CityData } from '../world/cityData';

export { RAPIER };

export const GROUP = { STATIC: 0x1, VEHICLE: 0x2, PED: 0x4, BIKE: 0x8 } as const;
export const WHEELS = GROUP.VEHICLE | GROUP.BIKE;

export const groups = (member: number, filter: number) => (member << 16) | filter;

const CHUNK = 250; // m; outlines merge into a collider per chunk (hundreds, not ~25k)

const ray = (x: number, z: number, dx: number, dz: number) => {
  const len = Math.hypot(dx, dz) || 1;
  return new RAPIER.Ray({ x, y: z }, { x: dx / len, y: dz / len });
};

export type Owner = { kind: 'vehicle' | 'ped' | 'player' | 'tram' | 'bus' | 'cyclist'; entity: unknown };

export class Physics {
  readonly world: RAPIER.World;
  readonly owners = new Map<number, Owner>();
  readonly contacts: [Owner, Owner][] = [];
  private events = new RAPIER.EventQueue(true);
  private box = new RAPIER.Cuboid(1, 1);

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: 0 });
    this.world.timestep = 1 / 60;
    // no soft bodies: skip Rapier 0.21's per-step collider re-sync (~3 ms)
    this.world.mapNewSoftBodies = () => {};
    this.world.colliders.unmapRemovedColliders = () => {};
  }

  step() {
    this.world.step(this.events);
    this.contacts.length = 0;
    this.events.drainCollisionEvents((h1, h2, started) => {
      const a = this.owners.get(h1), b = this.owners.get(h2);
      if (started && a && b) this.contacts.push([a, b]);
    });
  }

  remove(body: RAPIER.RigidBody) {
    // a double remove poisons Rapier's wasm; isValid() checks the generation, bodies.contains() doesn't
    if (!body.isValid()) return;
    for (let i = 0; i < body.numColliders(); i++) this.owners.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  static async create(city: CityData): Promise<Physics> {
    await RAPIER.init();
    const physics = new Physics();
    physics.addStatic(city);
    return physics;
  }

  private addStatic(city: CityData) {
    const chunks = new Map<string, { vertices: number[]; indices: number[] }>();
    const addRing = (kind: string, ring: number[]) => {
      const key = `${kind}:${Math.floor(ring[0] / CHUNK)},${Math.floor(ring[1] / CHUNK)}`;
      let chunk = chunks.get(key);
      if (!chunk) chunks.set(key, (chunk = { vertices: [], indices: [] }));
      const base = chunk.vertices.length / 2;
      const n = ring.length / 2;
      chunk.vertices.push(...ring);
      for (let i = 0; i < n; i++) chunk.indices.push(base + i, base + ((i + 1) % n));
    };

    for (const b of city.buildings) {
      if (!b.nc) for (const ring of b.rings) addRing('building', ring);
    }
    const { minX, minZ, maxX, maxZ } = city.bounds;
    addRing('edge', [minX, minZ, maxX, minZ, maxX, maxZ, minX, maxZ]);

    for (let i = 0; i < city.trees.length; i += 4) {
      this.world.createCollider(
        RAPIER.ColliderDesc.ball(0.3)
          .setTranslation(city.trees[i], city.trees[i + 1])
          .setCollisionGroups(groups(GROUP.STATIC, WHEELS | GROUP.PED)),
      );
    }

    for (const { vertices, indices } of chunks.values()) {
      const desc = RAPIER.ColliderDesc.polyline(new Float32Array(vertices), new Uint32Array(indices))
        .setFriction(0.2)
        .setRestitution(0.1)
        .setCollisionGroups(groups(GROUP.STATIC, WHEELS | GROUP.PED));
      this.world.createCollider(desc);
    }
  }

  castStatic(x: number, z: number, dx: number, dz: number, max: number): number {
    // static colliders take wheels and people, not STATIC: ask as a car
    const hit = this.world.castRay(ray(x, z, dx, dz), max, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, groups(GROUP.VEHICLE, GROUP.STATIC));
    return hit ? hit.timeOfImpact : max;
  }

  castSolid(x: number, z: number, dx: number, dz: number, max: number): { dist: number; nx: number; nz: number } | null {
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const hit = this.world.castRayAndGetNormal(ray(x, z, dx, dz), max, true, flags, groups(GROUP.VEHICLE, GROUP.STATIC));
    return hit ? { dist: hit.timeOfImpact, nx: hit.normal.x, nz: hit.normal.y } : null;
  }

  boxOverlaps(x: number, z: number, angle: number, halfLength: number, halfWidth: number, flags?: RAPIER.QueryFilterFlags, filter?: number): boolean {
    let hit = false;
    this.box.halfExtents = { x: halfLength, y: halfWidth };
    this.world.intersectionsWithShape(
      { x, y: z },
      angle,
      this.box,
      () => {
        hit = true;
        return false;
      },
      flags,
      filter,
    );
    return hit;
  }
}
