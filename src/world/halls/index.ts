import * as THREE from 'three';
import type { Crowd } from '../../actors/crowd';
import type { Player } from '../../actors/player';
import { GROUP, RAPIER, groups, type Physics } from '../../physics/physics';
import type { Landmark, LandmarkId } from '../cityData';
import type { Environment } from '../environment';
import { FLOOR_ROUGHNESS, MAX_LAMPS, lit, surfaceTexture, type Interiors } from '../interiors';
import { cathedral } from './cathedral';
import { centraal } from './centraal';
import { HallKit, LANDING, hallTexture, type Escalator, type Exit, type Floor, type HallLamp, type Mat, type Skin } from './kit';
import { mas } from './mas';
import { steen } from './steen';

export interface HallPlan {
  name: string;
  door: Exit;
  ambient: [number, number]; // colour, irradiance
  sun: number; // share of direct sunlight that gets in
  /** Keep the landmark's own model drawn: only MAS, whose galleries sit inside its glass. */
  keepExterior?: boolean;
  /** Light where you stand, if it differs across the hall; eased towards as you walk. */
  tone?(x: number, z: number, level: number): { ambient: [number, number]; sun: number };
  build(kit: HallKit, lm: Landmark, all: Landmark[]): void;
}

export const PLANS: Partial<Record<LandmarkId, HallPlan>> = { centraal, cathedral, mas, steen };

export interface HallDoor {
  hall: LandmarkId;
  x: number;
  z: number;
  nx: number;
  nz: number;
  w: number;
  name: string;
  style: 'public';
}

const ROUGHNESS: Record<Skin, number> = { ...FLOOR_ROUGHNESS, plaster: 0.92, ashlar: 0.9, flags: 0.55 };
const RIDE_SPEED = 2.2; // m/s along an escalator, a brisk walk up the moving steps
const RELIT = 0.4; // s between re-picking the lamps nearest the player

interface Person {
  avatar: number;
  matrix: THREE.Matrix4;
  phase: number;
  clip: 'idle' | 'moped';
}

interface Mover {
  avatar: number;
  path: [number, number][];
  lengths: number[];
  total: number;
  y: number;
  speed: number;
  s: number;
  matrix: THREE.Matrix4;
}

interface Ride {
  e: Escalator;
  up: boolean;
  u: number;
}

interface Active {
  plan: HallPlan;
  lm: Landmark;
  door: HallDoor;
  world: THREE.Matrix4;
  kit: HallKit;
  meshes: THREE.Mesh[];
  owned: { dispose(): void }[];
  colliders: Map<number, RAPIER.Collider[]>;
  people: Person[];
  movers: Mover[];
  level: number;
  ride: Ride | null;
  rideFloors: Map<Escalator, Floor>;
  outside: { x: number; z: number };
  groups: number;
  relight: number;
}

export class Halls {
  active: Active | null = null;
  private doors: HallDoor[] = [];
  private exteriors = new Map<LandmarkId, THREE.Object3D>();
  private landmarks = new Map<LandmarkId, Landmark>();
  private all: Landmark[];
  private time = 0;
  private sheets = new Map<string, THREE.CanvasTexture>();

  constructor(
    landmarks: Landmark[], exteriors: THREE.Object3D, private physics: Physics, private environment: Environment,
    private crowd: Crowd, private interiors: Interiors, private player: Player,
  ) {
    this.all = landmarks;
    for (const lm of landmarks) {
      const plan = PLANS[lm.id];
      if (!plan) continue;
      this.landmarks.set(lm.id, lm);
      const mesh = exteriors.getObjectByName(lm.id);
      if (mesh) this.exteriors.set(lm.id, mesh);
      const d = plan.door, [x, z] = toWorld(lm, d.x, d.z), [nx, nz] = turn(lm, d.nx, d.nz);
      this.doors.push({ hall: lm.id, x, z, nx, nz, w: d.w, name: plan.name, style: 'public' });
    }
  }

  get openAir(): boolean {
    const a = this.active;
    return !!a && !a.ride && a.kit.openAir.has(a.level);
  }

  doorAt(x: number, z: number): HallDoor | null {
    for (const d of this.doors) {
      const dx = x - d.x, dz = z - d.z;
      const out = dx * d.nx + dz * d.nz, side = dx * -d.nz + dz * d.nx;
      if (out > -0.2 && out < 2.6 && Math.abs(side) < d.w / 2 + 0.3) return d;
    }
    return null;
  }

  enter(door: HallDoor, fromX: number, fromZ: number, avoidAvatar: number): { x: number; z: number; heading: number } {
    if (this.active) this.leave();
    const lm = this.landmarks.get(door.hall)!, plan = PLANS[door.hall]!;
    const world = new THREE.Matrix4().makeTranslation(lm.x, 0, lm.z).multiply(new THREE.Matrix4().makeRotationY(-lm.angle));
    const kit = new HallKit(Math.floor(Math.abs(lm.x * 73.1 + lm.z * 19.7) * 100) % 2147483646 + 1);
    plan.build(kit, lm, this.all);

    const meshes: THREE.Mesh[] = [], owned: { dispose(): void }[] = [];
    const m = this.interiors.materials;
    const shared: Partial<Record<Mat, THREE.Material>> = { solid: m.solid, shiny: m.shiny, glow: m.glow, glass: m.glass, beam: m.beam };
    for (const [mat, mesher] of kit.meshers) {
      let material = shared[mat];
      if (!material) {
        const skin = mat as Skin;
        const map = skin === 'ashlar' || skin === 'flags' ? hallTexture(skin) : surfaceTexture(skin);
        material = lit(new THREE.MeshStandardMaterial({ map, roughness: ROUGHNESS[skin], vertexColors: true }), this.interiors.light);
        owned.push(material);
      }
      const g = mesher.build(world);
      if (g) meshes.push(new THREE.Mesh(g, material));
    }
    for (const s of kit.sheets) {
      let map = s.key ? this.sheets.get(s.key) : undefined;
      if (!map) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(1024, Math.max(64, Math.round(256 * s.w)));
        canvas.height = Math.max(16, Math.round((canvas.width * s.h) / s.w));
        s.draw(canvas.getContext('2d')!, canvas.width, canvas.height);
        map = new THREE.CanvasTexture(canvas);
        map.colorSpace = THREE.SRGBColorSpace;
        map.anisotropy = 4;
        if (s.key) this.sheets.set(s.key, map);
        else owned.push(map);
      }
      const material = s.glow ? new THREE.MeshBasicMaterial({ map }) : lit(new THREE.MeshStandardMaterial({ map, roughness: 0.85 }), this.interiors.light);
      owned.push(material);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), material);
      mesh.matrix.copy(world).multiply(s.m);
      meshes.push(mesh);
    }
    for (const mesh of meshes) {
      mesh.matrixAutoUpdate = false;
      this.interiors.group.add(mesh);
    }

    const levels = new Set([0, ...kit.floors.flatMap((f) => [f.level, ...(f.link ?? [])])]);
    const colliders = new Map<number, RAPIER.Collider[]>();
    const add = (level: number, desc: RAPIER.ColliderDesc) => {
      const c = this.physics.world.createCollider(desc.setCollisionGroups(groups(GROUP.HALL, GROUP.PED)).setEnabled(level === 0));
      colliders.set(level, [...(colliders.get(level) ?? []), c]);
    };
    for (const level of levels) {
      const segments = outline(floorsOn(kit.floors, level));
      for (const [ax, az, bx, bz, l] of kit.rails) if (l === level) segments.push([ax, az, bx, bz]);
      if (!segments.length) continue;
      const vertices = segments.flatMap(([ax, az, bx, bz]) => [...toWorld(lm, ax, az), ...toWorld(lm, bx, bz)]);
      add(level, RAPIER.ColliderDesc.polyline(new Float32Array(vertices), Uint32Array.from(segments.flatMap((_, i) => [i * 2, i * 2 + 1]))));
    }
    const blocks = [...kit.blocks];
    const rideFloors = new Map<Escalator, Floor>();
    for (const e of kit.escalators) {
      const [dx, dz, len] = direction(e);
      const s0 = 0.8, cx = e.a[0] + (dx * (s0 + len)) / 2, cz = e.a[2] + (dz * (s0 + len)) / 2;
      const along = len - s0, across = e.w;
      blocks.push({ x: cx, z: cz, sx: Math.abs(dx) * along + Math.abs(dz) * across, sz: Math.abs(dz) * along + Math.abs(dx) * across, level: e.from, round: false });
      const x0 = Math.min(e.a[0], e.b[0]) - Math.abs(dz) * (e.w / 2), x1 = Math.max(e.a[0], e.b[0]) + Math.abs(dz) * (e.w / 2);
      const z0 = Math.min(e.a[2], e.b[2]) - Math.abs(dx) * (e.w / 2), z1 = Math.max(e.a[2], e.b[2]) + Math.abs(dx) * (e.w / 2);
      rideFloors.set(e, { x0, x1, z0, z1, y: e.a[1], h: 3, level: -1, ramp: { x: e.a[0], z: e.a[2], dx, dz, len, rise: e.b[1] - e.a[1] } });
    }
    for (const b of blocks) {
      const [wx, wz] = toWorld(lm, b.x, b.z);
      const desc = b.round ? RAPIER.ColliderDesc.ball(b.sx / 2) : RAPIER.ColliderDesc.cuboid(b.sx / 2, b.sz / 2).setRotation(lm.angle);
      add(b.level, desc.setTranslation(wx, wz));
    }

    const people: Person[] = [], count = this.crowd.avatarCount;
    let next = Math.floor(kit.r() * count);
    const avatar = () => {
      if (next % count === avoidAvatar && count > 1) next++;
      return next++ % count;
    };
    for (const p of kit.people) {
      const sitting = p.clip === 'moped';
      // The seated clip is baked on a moped: hips 0.3 m behind its origin.
      const [wx, wz] = toWorld(lm, sitting ? p.x + p.fx * 0.3 : p.x, sitting ? p.z + p.fz * 0.3 : p.z);
      if (!sitting) add(p.level, RAPIER.ColliderDesc.ball(0.25).setTranslation(wx, wz));
      const heading = Math.atan2(p.fz, p.fx) + lm.angle;
      people.push({
        avatar: avatar(), phase: kit.r(), clip: sitting ? 'moped' : 'idle',
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(wx, p.y + (sitting ? 0.48 - 0.74 : 0), wz), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -heading), new THREE.Vector3(1, 1, 1)),
      });
    }
    const movers = kit.walkers.map((w) => {
      const path = w.path.map(([x, z]) => toWorld(lm, x, z));
      const lengths = path.map((p, i) => Math.hypot(path[(i + 1) % path.length][0] - p[0], path[(i + 1) % path.length][1] - p[1]));
      const total = lengths.reduce((a, b) => a + b, 0);
      return { avatar: avatar(), path, lengths, total, y: w.y, speed: w.speed * (0.85 + kit.r() * 0.3), s: kit.r() * total, matrix: new THREE.Matrix4() };
    });

    const collider = this.player.body.collider(0);
    const saved = collider.collisionGroups();
    collider.setCollisionGroups(groups(GROUP.PED, GROUP.HALL));
    if (!plan.keepExterior) this.exteriors.get(lm.id)?.traverse((o) => (o.visible = false));

    const u = this.interiors.light;
    // Room space only feeds the shop shader's wall-and-ceiling darkening: push every wall of that box far away.
    u.uRoom.value.makeTranslation(0, 0, 1e4).multiply(world.clone().invert());
    u.uBox.value.set(-1e5, 1e5, 1e5, 1e5);
    u.uBlocks.value = 0;
    this.active = {
      plan, lm, door, world, kit, meshes, owned, colliders, people, movers, level: 0, ride: null, rideFloors,
      outside: { x: fromX, z: fromZ }, groups: saved, relight: 0,
    };
    this.relight();
    this.environment.setIndoor(true);
    const d = plan.door, [x, z] = toWorld(lm, d.x - d.nx * 1.6, d.z - d.nz * 1.6);
    this.tone(this.active, d.x - d.nx * 1.6, d.z - d.nz * 1.6, 1);
    return { x, z, heading: Math.atan2(-door.nz, -door.nx) };
  }

  leave(): { x: number; z: number; heading: number } {
    const a = this.active!;
    for (const m of a.meshes) {
      this.interiors.group.remove(m);
      m.geometry.dispose();
    }
    for (const o of a.owned) o.dispose();
    for (const list of a.colliders.values()) for (const c of list) this.physics.world.removeCollider(c, false);
    this.player.body.collider(0).setCollisionGroups(a.groups);
    this.exteriors.get(a.lm.id)?.traverse((o) => (o.visible = true));
    this.active = null;
    this.environment.setIndoor(false);
    return { x: a.outside.x, z: a.outside.z, heading: Math.atan2(a.door.nz, a.door.nx) };
  }

  usable(x: number, z: number): string | null {
    const a = this.active!;
    if (a.ride) return null;
    const [lx, lz] = toLocal(a.lm, x, z), d = a.plan.door;
    if (a.level === 0) {
      const inward = (d.x - lx) * d.nx + (d.z - lz) * d.nz, side = (lx - d.x) * -d.nz + (lz - d.z) * d.nx;
      if (inward < 2.4 && Math.abs(side) < d.w / 2 + 0.2) return 'Leave';
    }
    const lift = a.kit.lifts.find((l) => l.level === a.level && Math.hypot(l.x - lx, l.z - lz) < 1.7);
    return lift ? lift.label : null;
  }

  use(x: number, z: number): 'leave' | 'moved' | null {
    const a = this.active!, label = this.usable(x, z);
    if (label === 'Leave') return 'leave';
    if (!label) return null;
    const [lx, lz] = toLocal(a.lm, x, z);
    const lift = a.kit.lifts.find((l) => l.level === a.level && Math.hypot(l.x - lx, l.z - lz) < 1.7)!;
    const [wx, wz] = toWorld(a.lm, lift.to.x, lift.to.z);
    this.setLevel(lift.to.level);
    this.player.place(wx, wz, lift.to.heading + a.lm.angle, this.floorY(lift.to.x, lift.to.z) ?? 0);
    return 'moved';
  }

  step(dt: number) {
    const a = this.active;
    if (!a) return;
    const p = this.player;
    if (a.ride) {
      this.advance(a, a.ride, dt);
      return;
    }
    const [lx, lz] = toLocal(a.lm, p.x, p.z);
    const f = floorAt(floorsOn(a.kit.floors, a.level), lx, lz);
    if (f) {
      p.elevation = floorY(f, lx, lz);
      if (f.link && f.ramp) {
        const level = p.elevation - f.y < f.ramp.rise / 2 ? f.link[0] : f.link[1];
        if (level !== a.level) this.setLevel(level);
      }
    }
    const v = p.body.linvel(), [vx, vz] = turn(a.lm, v.x, v.y, -1);
    for (const e of a.kit.escalators) {
      const [dx, dz] = direction(e);
      const along = vx * dx + vz * dz;
      if (a.level === e.from) {
        const s = (lx - e.a[0]) * dx + (lz - e.a[2]) * dz, c = (lx - e.a[0]) * -dz + (lz - e.a[2]) * dx;
        if (s > -0.2 && s < 0.8 && Math.abs(c) < e.w / 2 - 0.1 && along > 0.8) return this.board(a, e, true);
      }
      if (a.level === e.to) {
        const s = (e.b[0] - lx) * dx + (e.b[2] - lz) * dz, c = (lx - e.b[0]) * -dz + (lz - e.b[2]) * dx;
        if (s > -0.2 && s < 0.8 && Math.abs(c) < e.w / 2 - 0.1 && along < -0.8) return this.board(a, e, false);
      }
    }
  }

  render(dt: number, camera: THREE.Vector3) {
    this.time += dt;
    const a = this.active;
    if (!a) return;
    if ((a.relight -= dt) <= 0) this.relight();
    this.tone(a, ...toLocal(a.lm, this.player.x, this.player.z), Math.min(1, dt * 1.5));
    for (const p of a.people) {
      const info = this.crowd.clip(p.avatar, p.clip);
      const d = Math.hypot(p.matrix.elements[12] - camera.x, p.matrix.elements[13] - camera.y, p.matrix.elements[14] - camera.z);
      this.crowd.add(p.avatar, p.matrix, p.clip, this.time / info.duration + p.phase, d);
    }
    const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    for (const w of a.movers) {
      w.s = (w.s + w.speed * dt) % w.total;
      let s = w.s, i = 0;
      while (s > w.lengths[i]) s -= w.lengths[i++];
      const [ax, az] = w.path[i], [bx, bz] = w.path[(i + 1) % w.path.length], t = s / (w.lengths[i] || 1);
      pos.set(ax + (bx - ax) * t, w.y, az + (bz - az) * t);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -Math.atan2(bz - az, bx - ax));
      w.matrix.compose(pos, q, one);
      const info = this.crowd.clip(w.avatar, 'walk');
      this.crowd.add(w.avatar, w.matrix, 'walk', info.stride > 0 ? w.s / info.stride : this.time / info.duration, pos.distanceTo(camera));
    }
  }

  free(x: number, z: number, dx: number, dz: number): number {
    const a = this.active!, cells = this.cells(a);
    const [lx, lz] = toLocal(a.lm, x, z), [ldx, ldz] = turn(a.lm, dx, dz, -1);
    for (let t = 0.25; t < 12; t += 0.25) {
      if (!cells.some((f) => inside(f, lx + ldx * t, lz + ldz * t, 0.3))) return t - 0.25;
    }
    return 12;
  }

  confine(p: THREE.Vector3) {
    const a = this.active!;
    const [lx, lz] = toLocal(a.lm, p.x, p.z);
    let best: [number, number, number] | null = null, bestD = Infinity;
    for (const f of this.cells(a)) {
      const m = 0.3, x = clamp(lx, f.x0 + m, f.x1 - m), z = clamp(lz, f.z0 + m, f.z1 - m), y0 = floorY(f, x, z);
      const y = clamp(p.y, y0 + 0.4, y0 + f.h - 0.3);
      const d = (x - lx) ** 2 + (z - lz) ** 2 + (y - p.y) ** 2;
      if (d < bestD) [best, bestD] = [[x, y, z], d];
    }
    if (!best) return;
    const [wx, wz] = toWorld(a.lm, best[0], best[2]);
    p.set(wx, best[1], wz);
  }

  private floorY(lx: number, lz: number): number | null {
    const a = this.active!, f = floorAt(floorsOn(a.kit.floors, a.level), lx, lz);
    return f ? floorY(f, lx, lz) : null;
  }

  private cells(a: Active): Floor[] {
    const own = floorsOn(a.kit.floors, a.level);
    if (!a.ride) return own;
    return [...own, ...floorsOn(a.kit.floors, a.ride.up ? a.ride.e.to : a.ride.e.from), a.rideFloors.get(a.ride.e)!];
  }

  private setLevel(level: number) {
    const a = this.active!;
    const was = this.openAir;
    a.level = level;
    for (const [l, list] of a.colliders) for (const c of list) c.setEnabled(l === level);
    if (this.openAir !== was) this.environment.setIndoor(!this.openAir);
    this.relight();
  }

  private board(a: Active, e: Escalator, up: boolean) {
    a.ride = { e, up, u: 0 };
    for (const list of a.colliders.values()) for (const c of list) c.setEnabled(false);
    this.player.body.collider(0).setCollisionGroups(groups(GROUP.PED, 0));
    this.advance(a, a.ride, 0);
  }

  private advance(a: Active, ride: Ride, dt: number) {
    const { e, up } = ride, [dx, dz, len] = direction(e);
    ride.u = Math.min(len, ride.u + RIDE_SPEED * dt);
    const s = up ? ride.u : len - ride.u; // from the bottom
    const t = clamp((s - LANDING) / (len - 2 * LANDING), 0, 1);
    const y = e.a[1] + (e.b[1] - e.a[1]) * (t * t * (3 - 2 * t) * 0.15 + t * 0.85);
    const p = this.player;
    const sign = up ? 1 : -1;
    if (ride.u >= len) {
      a.ride = null;
      this.player.body.collider(0).setCollisionGroups(groups(GROUP.PED, GROUP.HALL));
      const end = up ? e.b : e.a, [wx, wz] = toWorld(a.lm, end[0] + dx * sign * 1.1, end[2] + dz * sign * 1.1);
      this.setLevel(up ? e.to : e.from);
      p.body.setTranslation({ x: wx, y: wz }, true);
      p.body.setLinvel({ x: 0, y: 0 }, true);
      p.elevation = end[1];
      return;
    }
    const [wx, wz] = toWorld(a.lm, e.a[0] + dx * s, e.a[2] + dz * s);
    p.body.setTranslation({ x: wx, y: wz }, true);
    p.body.setLinvel({ x: 0, y: 0 }, true);
    p.heading = Math.atan2(dz * sign, dx * sign) + a.lm.angle;
    p.elevation = y;
  }

  private tone(a: Active, lx: number, lz: number, k: number) {
    const t = a.plan.tone?.(lx, lz, a.level) ?? { ambient: a.plan.ambient, sun: a.plan.sun };
    const u = this.interiors.light;
    u.uAmbient.value.lerp(ambient.setHex(t.ambient[0]).multiplyScalar(t.ambient[1]), k);
    u.uSun.value += (t.sun - u.uSun.value) * k;
  }

  private relight() {
    const a = this.active!, u = this.interiors.light, p = this.player;
    a.relight = RELIT;
    const [lx, lz] = toLocal(a.lm, p.x, p.z), y = p.elevation;
    const lamps = [...a.kit.lamps].sort((l, m) => dist(l, lx, y, lz) - dist(m, lx, y, lz)).slice(0, MAX_LAMPS);
    lamps.forEach((l, i) => {
      const [wx, wz] = toWorld(a.lm, l.x, l.z);
      u.uLamp.value[i].set(wx, l.y, wz, l.shaded ? -l.range : l.range);
      u.uLampColour.value[i].copy(l.colour).multiplyScalar(l.power);
    });
    u.uLamps.value = lamps.length;
  }
}

const ambient = new THREE.Color();
const dist = (l: HallLamp, x: number, y: number, z: number) => Math.hypot(l.x - x, (l.y - y) * 2, l.z - z) - l.range * 0.3;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function toLocal(lm: Landmark, x: number, z: number): [number, number] {
  const c = Math.cos(lm.angle), s = Math.sin(lm.angle), dx = x - lm.x, dz = z - lm.z;
  return [dx * c + dz * s, -dx * s + dz * c];
}

function toWorld(lm: Landmark, x: number, z: number): [number, number] {
  const c = Math.cos(lm.angle), s = Math.sin(lm.angle);
  return [lm.x + x * c - z * s, lm.z + x * s + z * c];
}

/** A direction from the landmark's frame to the world's (sign -1: back). */
function turn(lm: Landmark, x: number, z: number, sign = 1): [number, number] {
  const c = Math.cos(lm.angle), s = Math.sin(lm.angle) * sign;
  return [x * c - z * s, x * s + z * c];
}

function direction(e: Escalator): [number, number, number] {
  const dx = e.b[0] - e.a[0], dz = e.b[2] - e.a[2], len = Math.hypot(dx, dz);
  return [dx / len, dz / len, len];
}

export function floorsOn(floors: Floor[], level: number): Floor[] {
  return floors.filter((f) => f.level === level || f.link?.includes(level));
}

/** The floor under (x, z): a later floor laid over an earlier one (a dais, a step) wins. */
export function floorAt(floors: Floor[], x: number, z: number): Floor | undefined {
  for (let i = floors.length - 1; i >= 0; i--) if (inside(floors[i], x, z, 0)) return floors[i];
}

function inside(f: Floor, x: number, z: number, m: number): boolean {
  return x >= f.x0 + m && x <= f.x1 - m && z >= f.z0 + m && z <= f.z1 - m;
}

function floorY(f: Floor, x: number, z: number): number {
  const r = f.ramp;
  if (!r) return f.y;
  return f.y + clamp(((x - r.x) * r.dx + (z - r.z) * r.dz) / r.len, 0, 1) * r.rise;
}

/** Walls round a level's floors: every stretch of edge with no floor at the same height just beyond it. */
export function outline(floors: Floor[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const f of floors) {
    const edges: [boolean, number, number, number, number][] = [
      [true, f.z0, f.x0, f.x1, -1], [true, f.z1, f.x0, f.x1, 1], [false, f.x0, f.z0, f.z1, -1], [false, f.x1, f.z0, f.z1, 1],
    ];
    for (const [alongX, c, a, b, n] of edges) {
      const cuts = new Set([a, b]);
      for (const g of floors) {
        if (g === f) continue;
        for (const v of alongX ? [g.x0, g.x1] : [g.z0, g.z1]) if (v > a && v < b) cuts.add(v);
      }
      const s = [...cuts].sort((p, q) => p - q);
      for (let i = 0; i + 1 < s.length; i++) {
        const mid = (s[i] + s[i + 1]) / 2;
        const [px, pz] = alongX ? [mid, c] : [c, mid], [ox, oz] = alongX ? [mid, c + n * 0.05] : [c + n * 0.05, mid];
        const y = floorY(f, px, pz);
        if (floors.some((g) => g !== f && inside(g, ox, oz, 0) && Math.abs(floorY(g, ox, oz) - y) < 0.3)) continue;
        out.push(alongX ? [s[i], c, s[i + 1], c] : [c, s[i], c, s[i + 1]]);
      }
    }
  }
  return out;
}
