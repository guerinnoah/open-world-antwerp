import * as THREE from 'three';
import type { Clip, Crowd } from '../../actors/crowd';
import { GROUP, RAPIER, WHEELS, groups, type Physics } from '../../physics/physics';
import type { Building } from '../cityData';
import type { Environment } from '../environment';
import type { Door } from '../signs';
import { furnish } from './fitOuts';
import { board, nameBoard } from './furniture';
import { MAX_BLOCKS, MAX_LAMPS, lit, mergeLamps } from './lighting';
import { FRONT, Items, Mesher } from './mesher';
import { SPAWN_Z, fitRoom, shell, toLocal, toWorld, type Fit, type Kit } from './room';
import { FLOOR_ROUGHNESS, WALL_ROUGHNESS, surfaceTexture, type Surface } from './surfaces';

interface Person {
  avatar: number;
  matrix: THREE.Matrix4;
  phase: number;
  clip: Clip;
}

interface Room {
  door: Door;
  fit: Fit;
  meshes: THREE.Mesh[];
  colliders: RAPIER.Collider[];
  people: Person[];
  owned: { dispose(): void }[];
  outside: { x: number; z: number };
}

export class Interiors {
  readonly group = new THREE.Group();
  room: Room | null = null;
  private grid = new Map<string, Door[]>();
  private buildingGrid = new Map<string, Building[]>();
  private fits = new Map<Door, Fit | null>();
  private time = 0;
  readonly light = {
    uRoom: { value: new THREE.Matrix4() },
    uLamp: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
    uLampColour: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Color()) },
    uLamps: { value: 0 },
    uBlock: { value: Array.from({ length: MAX_BLOCKS }, () => new THREE.Vector4()) },
    uBlocks: { value: 0 },
    uBox: { value: new THREE.Vector4() },
    uAmbient: { value: new THREE.Color() },
    uSun: { value: 0.12 },
  };
  readonly materials = {
    solid: lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }), this.light),
    shiny: lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.55 }), this.light),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0xdfe8ee, transparent: true, opacity: 0.12, roughness: 0.03, depthWrite: false }),
    beam: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  };

  constructor(doors: Door[], buildings: Building[], private physics: Physics, private environment: Environment, private crowd: Crowd) {
    this.group.name = 'interiors';
    for (const b of buildings) {
      if (b.nc || (b.mh ?? 0) > 2.5) continue; // no walls down at street level
      const r = b.rings[0];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        x0 = Math.min(x0, r[i]);
        x1 = Math.max(x1, r[i]);
        z0 = Math.min(z0, r[i + 1]);
        z1 = Math.max(z1, r[i + 1]);
      }
      for (let i = Math.floor(x0 / 50); i <= Math.floor(x1 / 50); i++) {
        for (let j = Math.floor(z0 / 50); j <= Math.floor(z1 / 50); j++) this.buildingGrid.set(`${i},${j}`, [...(this.buildingGrid.get(`${i},${j}`) ?? []), b]);
      }
    }
    for (const d of doors) {
      const key = `${Math.floor(d.x / 20)},${Math.floor(d.z / 20)}`;
      this.grid.set(key, [...(this.grid.get(key) ?? []), d]);
    }
  }

  /** One mesh per room shader, to compile ahead: else the first shop entered stalls on them. */
  warmUp(): THREE.Group {
    const box = new Mesher();
    box.box(0, 0, 0, 0.1, 0.1, 0.1, 0xffffff);
    const geometry = box.build(new THREE.Matrix4())!;
    const map = new THREE.Texture(); // the shader doesn't depend on the image
    const group = new THREE.Group();
    for (const material of [
      ...Object.values(this.materials),
      lit(new THREE.MeshStandardMaterial({ map, vertexColors: true }), this.light),
      lit(new THREE.MeshStandardMaterial({ map }), this.light),
      new THREE.MeshBasicMaterial({ map }),
    ]) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    const items = new Items();
    items.box(0, 0, 0, 0.1, 0.1, 0.1, 0xffffff);
    group.add(...items.build(new THREE.Matrix4(), this.materials.solid));
    return group;
  }

  get inside(): boolean {
    return !!this.room;
  }

  doorAt(x: number, z: number): Door | null {
    let best: Door | null = null, bestD = Infinity;
    const gx = Math.floor(x / 20), gz = Math.floor(z / 20);
    for (let i = gx - 1; i <= gx + 1; i++) {
      for (let j = gz - 1; j <= gz + 1; j++) {
        for (const d of this.grid.get(`${i},${j}`) ?? []) {
          const dx = x - d.x, dz = z - d.z;
          const out = dx * d.nx + dz * d.nz, side = dx * d.ux + dz * d.uz;
          if (out < 0 || out > 1.9 || Math.abs(side) > 1.1) continue;
          const dist = Math.hypot(out, side);
          if (dist < bestD && this.fitFor(d)) {
            bestD = dist;
            best = d;
          }
        }
      }
    }
    return best;
  }

  atExit(x: number, z: number): boolean {
    if (!this.room) return false;
    const [lx, lz] = toLocal(this.room.door, x, z);
    return lz < 1.9 && Math.abs(lx) < 1.3;
  }

  enter(door: Door, fromX: number, fromZ: number, avoidAvatar: number): { x: number; z: number; heading: number } | null {
    const fit = this.fitFor(door);
    if (!fit) return null;
    if (this.room) this.leave();
    const vx = -door.nx, vz = -door.nz;
    const world = new THREE.Matrix4().makeBasis(new THREE.Vector3(door.ux, 0, door.uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(vx, 0, vz));
    world.setPosition(door.x, 0, door.z);
    let seed = Math.floor(Math.abs(door.x * 73.1 + door.z * 19.7) * 100) % 2147483646 + 1;
    const kit: Kit = {
      fit, solid: new Mesher(), shiny: new Mesher(), glow: new Mesher(), glass: new Mesher(), beam: new Mesher(), floor: new Mesher(),
      wall: new Mesher(), back: new Mesher(), ceiling: new Mesher(), items: new Items(), blocks: [], people: [], lamps: [], boards: [],
      r: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646,
    };
    const look = shell(kit, door);
    furnish(kit, door);

    const meshes: THREE.Mesh[] = [];
    const owned: { dispose(): void }[] = [];
    const surface = (kind: Surface, roughness: number, vertexColors: boolean) => {
      const m = lit(new THREE.MeshStandardMaterial({ map: surfaceTexture(kind, look.carpet), roughness, vertexColors }), this.light);
      owned.push(m);
      return m;
    };
    for (const [mesher, material] of [
      [kit.floor, surface(look.floor, FLOOR_ROUGHNESS[look.floor], false)], [kit.wall, surface(look.finish, WALL_ROUGHNESS[look.finish], true)],
      [kit.back, look.back ? surface(look.back, WALL_ROUGHNESS[look.back], true) : null], [kit.ceiling, surface('plaster', 0.95, true)],
      [kit.solid, this.materials.solid], [kit.shiny, this.materials.shiny], [kit.glow, this.materials.glow], [kit.glass, this.materials.glass],
      [kit.beam, this.materials.beam],
    ] as const) {
      const g = material && mesher.build(world);
      if (g) meshes.push(new THREE.Mesh(g, material));
    }
    meshes.push(...kit.items.build(world, this.materials.solid));
    for (const b of [...kit.boards, nameBoard(door, fit)]) {
      const m = board(b, world, this.light);
      meshes.push(m);
      owned.push(m.material, m.material.map!);
    }
    for (const m of meshes) {
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }

    const corners = [toWorld(door, fit.x0, FRONT), toWorld(door, fit.x1, FRONT), toWorld(door, fit.x1, fit.depth), toWorld(door, fit.x0, fit.depth)];
    const colliders = [
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.polyline(new Float32Array(corners.flat()), new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0]))
          .setCollisionGroups(groups(GROUP.STATIC, WHEELS | GROUP.PED)),
      ),
    ];
    const angle = Math.atan2(door.uz, door.ux);
    for (const [x, z, sx, sz] of kit.blocks) {
      const [wx, wz] = toWorld(door, x, z);
      colliders.push(this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(sx / 2, sz / 2).setTranslation(wx, wz).setRotation(angle).setCollisionGroups(groups(GROUP.STATIC, GROUP.PED)),
      ));
    }
    const people: Person[] = [];
    const count = this.crowd.avatarCount;
    let next = Math.floor(kit.r() * count);
    for (const [x, z, fx, fz, sitting] of kit.people) {
      const [wx, wz] = toWorld(door, x, z); // a sitter's origin is the chair seat's centre
      if (!sitting) {
        colliders.push(this.physics.world.createCollider(
          RAPIER.ColliderDesc.ball(0.25).setTranslation(wx, wz).setCollisionGroups(groups(GROUP.STATIC, GROUP.PED)),
        ));
      }
      const heading = Math.atan2(door.uz * fx + vz * fz, door.ux * fx + vx * fz);
      if (next % count === avoidAvatar && count > 1) next++;
      const avatar = next++ % count;
      people.push({
        avatar, phase: kit.r(), clip: sitting ? 'sit' : 'idle',
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(wx, 0, wz), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -heading), new THREE.Vector3(1, 1, 1)),
      });
    }
    const u = this.light;
    u.uRoom.value.copy(world).invert();
    u.uBox.value.set(fit.x0, fit.x1, fit.depth, fit.height);
    u.uAmbient.value.setHex(look.ambient[0]).multiplyScalar(look.ambient[1]);
    const lamps = mergeLamps(kit.lamps, MAX_LAMPS);
    lamps.forEach((l, i) => {
      const [wx, wz] = toWorld(door, l.x, l.z);
      u.uLamp.value[i].set(wx, l.y, wz, l.shaded ? -l.range : l.range);
      u.uLampColour.value[i].copy(l.colour).multiplyScalar(l.power);
    });
    u.uLamps.value = lamps.length;
    const blocks = [...kit.blocks].sort((a, b) => b[2] * b[3] - a[2] * a[3]).slice(0, MAX_BLOCKS);
    blocks.forEach(([x, z, sx, sz], i) => u.uBlock.value[i].set(x, z, sx / 2, sz / 2));
    u.uBlocks.value = blocks.length;
    this.room = { door, fit, meshes, colliders, people, owned, outside: { x: fromX, z: fromZ } };
    this.environment.setIndoor(true);
    const [x, z] = toWorld(door, 0, SPAWN_Z);
    return { x, z, heading: Math.atan2(vz, vx) };
  }

  leave(): { x: number; z: number; heading: number } {
    const room = this.room!;
    for (const m of room.meshes) {
      this.group.remove(m);
      if (m instanceof THREE.InstancedMesh) m.dispose(); // its shape is shared
      else m.geometry.dispose();
    }
    for (const o of room.owned) o.dispose();
    for (const c of room.colliders) this.physics.world.removeCollider(c, false);
    this.room = null;
    this.environment.setIndoor(false);
    const d = room.door;
    return { x: room.outside.x, z: room.outside.z, heading: Math.atan2(d.nz, d.nx) };
  }

  render(dt: number, camera: THREE.Vector3) {
    this.time += dt;
    if (!this.room) return;
    for (const p of this.room.people) {
      const info = this.crowd.clip(p.avatar, p.clip);
      const d = Math.hypot(p.matrix.elements[12] - camera.x, p.matrix.elements[14] - camera.z);
      this.crowd.add(p.avatar, p.matrix, p.clip, this.time / info.duration + p.phase, d);
    }
  }

  free(x: number, z: number, dx: number, dz: number): number {
    const room = this.room;
    if (!room) return Infinity;
    const { door, fit } = room;
    const m = 0.4;
    const [lx, lz] = toLocal(door, x, z);
    const ldx = dx * door.ux + dz * door.uz, ldz = -(dx * door.nx + dz * door.nz);
    let t = Infinity;
    if (ldx > 1e-6) t = Math.min(t, (fit.x1 - m - lx) / ldx);
    if (ldx < -1e-6) t = Math.min(t, (fit.x0 + m - lx) / ldx);
    if (ldz > 1e-6) t = Math.min(t, (fit.depth - m - lz) / ldz);
    if (ldz < -1e-6) t = Math.min(t, (FRONT + m - lz) / ldz);
    return Math.max(0, t);
  }

  confine(p: THREE.Vector3) {
    const room = this.room;
    if (!room) return;
    const { door, fit } = room;
    const m = 0.4;
    const [lx, lz] = toLocal(door, p.x, p.z);
    const [x, z] = toWorld(door, Math.min(Math.max(lx, fit.x0 + m), fit.x1 - m), Math.min(Math.max(lz, FRONT + m), fit.depth - m));
    p.set(x, Math.min(Math.max(p.y, 0.5), fit.height - 0.3), z);
  }

  private fitFor(door: Door): Fit | null {
    if (this.fits.has(door)) return this.fits.get(door)!;
    const neighbours = new Set<Building>();
    for (let i = Math.floor(door.x / 50) - 1; i <= Math.floor(door.x / 50) + 1; i++) {
      for (let j = Math.floor(door.z / 50) - 1; j <= Math.floor(door.z / 50) + 1; j++) {
        for (const b of this.buildingGrid.get(`${i},${j}`) ?? []) if (b !== door.building) neighbours.add(b);
      }
    }
    const fit = fitRoom(door, [...neighbours]);
    this.fits.set(door, fit);
    return fit;
  }
}
