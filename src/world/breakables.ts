import * as THREE from 'three';
import { Debris } from '../fx/debris';
import { GROUP, RAPIER, groups, type Physics } from '../physics/physics';
import type { Breakable, Props } from './props';

// Overlaps are a grid lookup, not Rapier colliders: Rapier's JS side walks every collider each step (slow on phones).
const RESTORE = 300;
const CELL = 8;
const REACH = 1;

const cellKey = (cx: number, cz: number) => cx * 100003 + cz;

export class Breakables {
  readonly group: THREE.Group;
  private debris: Debris;
  private posts: (RAPIER.Collider | null)[] = [];
  private cells = new Map<number, number[]>();
  private broken = new Set<number>();
  private sinceCheck = 0;
  extras: ((b: Breakable) => THREE.InstancedMesh[]) | null = null;

  constructor(
    private physics: Physics,
    private props: Props,
  ) {
    this.debris = new Debris((x, z, dx, dz, max) => physics.castSolid(x, z, dx, dz, max));
    this.group = this.debris.group;
    props.breakables.forEach((b, id) => {
      const key = cellKey(Math.floor(b.x / CELL), Math.floor(b.z / CELL));
      const cell = this.cells.get(key);
      if (cell) cell.push(id);
      else this.cells.set(key, [id]);
      this.posts.push(
        b.blocksPeople
          ? physics.world.createCollider(
              this.shape(b).setTranslation(b.x, b.z).setRotation(b.angle).setCollisionGroups(groups(GROUP.STATIC, GROUP.PED | GROUP.BIKE)),
            )
          : null,
      );
    });
  }

  private shape(b: Breakable) {
    return typeof b.size === 'number' ? RAPIER.ColliderDesc.ball(b.size) : RAPIER.ColliderDesc.cuboid(b.size[0], b.size[1]);
  }

  touching(x: number, z: number, angle: number, halfLength: number, halfWidth: number, hit: (id: number) => void) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const reach = Math.hypot(halfLength, halfWidth) + REACH;
    const [x0, x1] = [Math.floor((x - reach) / CELL), Math.floor((x + reach) / CELL)];
    const [z0, z1] = [Math.floor((z - reach) / CELL), Math.floor((z + reach) / CELL)];
    const overlaps = (px: number, pz: number, r: number) => {
      const dx = px - x, dz = pz - z;
      const lx = Math.max(Math.abs(dx * c + dz * s) - halfLength, 0);
      const lz = Math.max(Math.abs(-dx * s + dz * c) - halfWidth, 0);
      return lx * lx + lz * lz < r * r;
    };
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (const id of this.cells.get(cellKey(cx, cz)) ?? []) {
          if (this.broken.has(id)) continue;
          const b = this.props.breakables[id];
          let touch: boolean;
          if (typeof b.size === 'number') touch = overlaps(b.x, b.z, b.size);
          else {
            const [hl, hw] = b.size;
            const ux = Math.cos(b.angle) * (hl - hw), uz = Math.sin(b.angle) * (hl - hw);
            touch = overlaps(b.x - ux, b.z - uz, hw) || overlaps(b.x, b.z, hw) || overlaps(b.x + ux, b.z + uz, hw);
          }
          if (touch) hit(id);
        }
      }
    }
  }

  knock(id: number, x: number, z: number, vx: number, vz: number): Breakable | null {
    if (this.broken.has(id)) return null;
    this.broken.add(id);
    const b = this.props.breakables[id];
    this.posts[id]?.setEnabled(false);
    this.props.setBroken(b, true);

    const speed = Math.hypot(vx, vz);
    const out = Math.hypot(b.x - x, b.z - z) || 1;
    const [dx, dz] = speed > 0.5 ? [vx / speed, vz / speed] : [(b.x - x) / out, (b.z - z) / out];
    const side = Math.sign((b.x - x) * -dz + (b.z - z) * dx) || (Math.random() < 0.5 ? -1 : 1);
    const [sx, sz] = [-dz * side, dx * side];
    const r = () => Math.random() * 2 - 1;
    for (const mesh of [...b.parts.map((part) => this.props.loose(part)), ...(this.extras?.(b) ?? [])]) {
      const vel = new THREE.Vector3(), spin = new THREE.Vector3();
      if (b.tall) {
        const ahead = speed * 0.7, aside = speed * 0.1;
        vel.set(dx * ahead + sx * aside, 0.5 + speed * 0.12, dz * ahead + sz * aside);
        spin.set(dz, 0, -dx).multiplyScalar(0.8 + speed * 0.12).add(new THREE.Vector3(r(), r(), r()).multiplyScalar(0.3));
      } else {
        const k = speed * (0.8 + Math.random() * 0.3);
        vel.set((dx * 0.85 + sx * 0.35) * k, 1 + k * 0.25, (dz * 0.85 + sz * 0.35) * k);
        spin.set(r(), r(), r()).multiplyScalar(1 + speed * 0.4);
      }
      this.debris.launch(mesh, vel, spin, id);
    }
    return b;
  }

  update(dt: number, x: number, z: number) {
    this.debris.update(dt, x, z);
    if ((this.sinceCheck += dt) < 1) return;
    this.sinceCheck = 0;
    for (const id of this.broken) {
      const b = this.props.breakables[id];
      if (Math.hypot(b.x - x, b.z - z) < RESTORE || this.carOn(b)) continue;
      this.broken.delete(id);
      this.posts[id]?.setEnabled(true);
      this.props.setBroken(b, false);
      this.debris.clear(id);
    }
  }

  private carOn(b: Breakable): boolean {
    const shape = typeof b.size === 'number' ? new RAPIER.Ball(b.size) : new RAPIER.Cuboid(b.size[0], b.size[1]);
    let hit = false;
    this.physics.world.intersectionsWithShape(
      { x: b.x, y: b.z },
      b.angle,
      shape,
      () => ((hit = true), false),
      RAPIER.QueryFilterFlags.EXCLUDE_FIXED,
      groups(GROUP.STATIC, GROUP.VEHICLE),
    );
    return hit;
  }
}
