import * as THREE from 'three';
import type { Crowd } from '../actors/crowd';
import { GROUP, RAPIER, WHEELS, groups, type Physics } from '../physics/physics';
import { rand } from './buildings';
import type { Building, SignStyle } from './cityData';
import type { Environment } from './environment';
import { bays, doorBay, facadeStyle } from './facadeLayout';
import { inRing } from './polyline';
import type { Door } from './signs';

type Place = Exclude<SignStyle, 'street'>;

/** Room wanted per kind of place: [width along the street, depth] (m), shrunk to fit the building. */
const SIZE: Record<Place, [number, number]> = {
  cafe: [9, 11], restaurant: [10, 12], fastfood: [8, 9], bakery: [6, 8], jewelry: [6, 8], fashion: [9, 12], food: [12, 14],
  shop: [7, 10], pharmacy: [7, 9], bank: [8, 10], service: [6, 8], hotel: [10, 12], culture: [11, 14], club: [11, 14], public: [10, 12],
  plate: [6, 7],
};

const FRONT = 0.12; // m into the building: inner face of the front wall, just behind the facade
const ENTRY_X = 1.05, ENTRY_Z = 2.4; // entrance kept clear of furniture: |x| < ENTRY_X, z < ENTRY_Z
const SPAWN_Z = 1.5; // m: enter() puts the player here, on the doorway's axis

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

class Grow<T extends Float32Array | Uint32Array> {
  n = 0;
  constructor(public a: T) {}
  reserve(k: number) {
    if (this.n + k <= this.a.length) return;
    const b = new (this.a.constructor as new (n: number) => T)(Math.max(this.a.length * 2, this.n + k));
    b.set(this.a);
    this.a = b;
  }
}

/** Collects triangles in room space: x along the street wall (0 = the doorway), y up, z into the building. */
class Mesher {
  private pos = new Grow(new Float32Array(3 * 4096));
  private nor = new Grow(new Float32Array(3 * 4096));
  private col = new Grow(new Float32Array(3 * 4096));
  private uv = new Grow(new Float32Array(2 * 4096));
  private idx = new Grow(new Uint32Array(6 * 2048));
  private colour = new THREE.Color();
  private normalMatrix = new THREE.Matrix3();

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    const p = this.pos, n = this.nor, c = this.col, t = this.uv;
    p.a[p.n++] = x; p.a[p.n++] = y; p.a[p.n++] = z;
    n.a[n.n++] = nx; n.a[n.n++] = ny; n.a[n.n++] = nz;
    c.a[c.n++] = this.colour.r; c.a[c.n++] = this.colour.g; c.a[c.n++] = this.colour.b;
    t.a[t.n++] = u; t.a[t.n++] = v;
  }

  private reserve(vertices: number, indices: number) {
    this.pos.reserve(vertices * 3);
    this.nor.reserve(vertices * 3);
    this.col.reserve(vertices * 3);
    this.uv.reserve(vertices * 2);
    this.idx.reserve(indices);
  }

  quad(c: V3, e1: V3, e2: V3, n: V3, colour: number, uv = 0) {
    const p = [sub(sub(c, e1), e2), sub(add(c, e1), e2), add(add(c, e1), e2), add(sub(c, e1), e2)];
    const u = sub(p[1], p[0]), v = sub(p[2], p[0]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] < 0) p.reverse();
    this.colour.setHex(colour);
    this.reserve(4, 6);
    const base = this.pos.n / 3;
    for (const q of p) this.vertex(q[0], q[1], q[2], n[0], n[1], n[2], uv ? q[0] / uv : 0, uv ? q[2] / uv : 0);
    const i = this.idx;
    i.a[i.n++] = base; i.a[i.n++] = base + 1; i.a[i.n++] = base + 2;
    i.a[i.n++] = base; i.a[i.n++] = base + 2; i.a[i.n++] = base + 3;
  }

  box(x: number, z: number, y0: number, sx: number, sz: number, h: number, colour: number, bottom = false) {
    const c: V3 = [x, y0 + h / 2, z];
    const hx: V3 = [sx / 2, 0, 0], hy: V3 = [0, h / 2, 0], hz: V3 = [0, 0, sz / 2];
    this.quad(add(c, hy), hx, hz, [0, 1, 0], colour);
    if (bottom) this.quad(sub(c, hy), hx, hz, [0, -1, 0], colour);
    this.quad(add(c, hx), hy, hz, [1, 0, 0], colour);
    this.quad(sub(c, hx), hy, hz, [-1, 0, 0], colour);
    this.quad(add(c, hz), hx, hy, [0, 0, 1], colour);
    this.quad(sub(c, hz), hx, hy, [0, 0, -1], colour);
  }

  geometry(g: THREE.BufferGeometry, m: THREE.Matrix4, colour: number) {
    let t = templates.get(g);
    if (!t) {
      const index = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: g.getAttribute('position').count }, (_, i) => i);
      t = { p: g.getAttribute('position').array as Float32Array, n: g.getAttribute('normal').array as Float32Array, i: Uint32Array.from(index) };
      templates.set(g, t);
    }
    this.colour.setHex(colour);
    const e = m.elements, q = this.normalMatrix.getNormalMatrix(m).elements;
    const count = t.p.length / 3;
    this.reserve(count, t.i.length);
    const base = this.pos.n / 3;
    for (let i = 0; i < t.p.length; i += 3) {
      const x = t.p[i], y = t.p[i + 1], z = t.p[i + 2];
      const a = t.n[i], b = t.n[i + 1], c = t.n[i + 2];
      const nx = q[0] * a + q[3] * b + q[6] * c, ny = q[1] * a + q[4] * b + q[7] * c, nz = q[2] * a + q[5] * b + q[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      this.vertex(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14], nx / l, ny / l, nz / l, 0, 0);
    }
    const idx = this.idx;
    for (let k = 0; k < t.i.length; k++) idx.a[idx.n++] = base + t.i[k];
  }

  build(world: THREE.Matrix4): THREE.BufferGeometry | null {
    if (!this.idx.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.a.slice(0, this.pos.n), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.a.slice(0, this.nor.n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.a.slice(0, this.col.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.a.slice(0, this.uv.n), 2));
    g.setIndex(new THREE.BufferAttribute(this.idx.a.slice(0, this.idx.n), 1));
    return g.applyMatrix4(world);
  }
}

const templates = new WeakMap<THREE.BufferGeometry, { p: Float32Array; n: Float32Array; i: Uint32Array }>();

const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const BALL = new THREE.IcosahedronGeometry(1, 1);
const SHADE = new THREE.ConeGeometry(0.2, 0.18, 12, 1, true);
const KNOT = new THREE.TorusKnotGeometry(0.16, 0.05, 48, 8);
const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ry), new THREE.Vector3(sx, sy, sz));

type FloorKind = 'planks' | 'planksDark' | 'tiles' | 'checker' | 'marble' | 'carpet' | 'concrete';

const floors = new Map<string, THREE.CanvasTexture>();
function floorTexture(kind: FloorKind, tint = '#3a3d4a'): THREE.CanvasTexture {
  const key = kind + tint;
  const cached = floors.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d')!;
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shade = (base: number[], k: number) => `rgb(${base.map((v) => Math.round(v * k)).join(',')})`;
  if (kind === 'planks' || kind === 'planksDark') {
    const base = kind === 'planks' ? [176, 132, 86] : [92, 58, 34];
    for (let row = 0; row < 16; row++) {
      let x = -r() * 400;
      while (x < 512) {
        const len = 260 + r() * 300;
        g.fillStyle = shade(base, 0.82 + r() * 0.3);
        g.fillRect(x, row * 32, len, 32);
        g.globalAlpha = 0.08;
        g.fillStyle = '#000';
        for (let k = 0; k < 4; k++) g.fillRect(x, row * 32 + 4 + r() * 24, len, 1);
        g.globalAlpha = 1;
        g.fillStyle = shade(base, 0.45);
        g.fillRect(x, row * 32, 2, 32);
        x += len;
      }
      g.fillStyle = shade(base, 0.4);
      g.fillRect(0, row * 32, 512, 2);
    }
  } else if (kind === 'tiles' || kind === 'checker') {
    const n = kind === 'tiles' ? 4 : 8, s = 512 / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const dark = kind === 'checker' && (i + j) % 2 === 1;
        g.fillStyle = dark ? shade([40, 40, 42], 0.9 + r() * 0.2) : shade([214, 212, 206], 0.94 + r() * 0.08);
        g.fillRect(i * s, j * s, s, s);
      }
    }
    g.fillStyle = kind === 'tiles' ? '#9a9892' : '#7a7a76';
    for (let i = 0; i <= n; i++) {
      g.fillRect(i * s - 1.5, 0, 3, 512);
      g.fillRect(0, i * s - 1.5, 512, 3);
    }
  } else if (kind === 'marble') {
    g.fillStyle = '#d6cfc1';
    g.fillRect(0, 0, 512, 512);
    g.lineWidth = 0.8;
    for (let k = 0; k < 12; k++) {
      g.strokeStyle = `rgba(120,108,96,${0.08 + r() * 0.14})`;
      g.beginPath();
      g.moveTo(r() * 512, r() * 512);
      g.bezierCurveTo(r() * 512, r() * 512, r() * 512, r() * 512, r() * 512, r() * 512);
      g.stroke();
    }
    g.fillStyle = 'rgba(90,80,70,0.35)';
    for (const p of [0, 256]) {
      g.fillRect(p, 0, 2, 512);
      g.fillRect(0, p, 512, 2);
    }
  } else {
    g.fillStyle = kind === 'carpet' ? tint : '#8e8c88';
    g.fillRect(0, 0, 512, 512);
    const img = g.getImageData(0, 0, 512, 512);
    const amp = kind === 'carpet' ? 26 : 14;
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (r() - 0.5) * amp;
      for (let c = 0; c < 3; c++) img.data[i + c] += v;
    }
    g.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  floors.set(key, tex);
  return tex;
}

const FLOOR_ROUGHNESS: Record<FloorKind, number> = { planks: 0.5, planksDark: 0.45, tiles: 0.3, checker: 0.35, marble: 0.12, carpet: 0.95, concrete: 0.35 };

interface Fit {
  x0: number;
  x1: number;
  depth: number;
  height: number;
}

interface Person {
  avatar: number;
  matrix: THREE.Matrix4;
  phase: number;
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

interface Kit {
  fit: Fit;
  solid: Mesher;
  shiny: Mesher;
  glow: Mesher;
  glass: Mesher;
  floor: Mesher;
  blocks: [number, number, number, number][];
  people: [number, number, number, number][];
  r: () => number;
}

export class Interiors {
  readonly group = new THREE.Group();
  room: Room | null = null;
  private grid = new Map<string, Door[]>();
  private buildingGrid = new Map<string, Building[]>();
  private fits = new Map<Door, Fit | null>();
  private time = 0;
  private materials = {
    solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }),
    shiny: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.55 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0xdfe8ee, transparent: true, opacity: 0.12, roughness: 0.03, depthWrite: false }),
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
      fit, solid: new Mesher(), shiny: new Mesher(), glow: new Mesher(), glass: new Mesher(), floor: new Mesher(), blocks: [], people: [],
      r: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646,
    };
    const look = shell(kit, door);
    furnish(kit, door.style as Place);

    const meshes: THREE.Mesh[] = [];
    const floorMaterial = new THREE.MeshStandardMaterial({ map: floorTexture(look.floor, look.carpet), roughness: FLOOR_ROUGHNESS[look.floor] });
    for (const [mesher, material] of [
      [kit.floor, floorMaterial], [kit.solid, this.materials.solid], [kit.shiny, this.materials.shiny], [kit.glow, this.materials.glow],
      [kit.glass, this.materials.glass],
    ] as const) {
      const g = mesher.build(world);
      if (g) meshes.push(new THREE.Mesh(g, material));
    }
    const sign = nameSign(door, fit, world);
    meshes.push(sign);
    const signMaterial = sign.material as THREE.MeshBasicMaterial;
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
    // Everyone a different avatar while there are enough, never the player's own.
    const count = this.crowd.avatarCount;
    let next = Math.floor(kit.r() * count);
    for (const [x, z, fx, fz] of kit.people) {
      const [wx, wz] = toWorld(door, x, z);
      colliders.push(this.physics.world.createCollider(
        RAPIER.ColliderDesc.ball(0.25).setTranslation(wx, wz).setCollisionGroups(groups(GROUP.STATIC, GROUP.PED)),
      ));
      const heading = Math.atan2(door.uz * fx + vz * fz, door.ux * fx + vx * fz);
      if (next % count === avoidAvatar && count > 1) next++;
      const avatar = next++ % count;
      people.push({
        avatar, phase: kit.r(),
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(wx, 0, wz), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -heading), new THREE.Vector3(1, 1, 1)),
      });
    }
    this.room = { door, fit, meshes, colliders, people, owned: [floorMaterial, signMaterial, signMaterial.map!], outside: { x: fromX, z: fromZ } };
    this.environment.setIndoor(true);
    const [x, z] = toWorld(door, 0, SPAWN_Z);
    return { x, z, heading: Math.atan2(vz, vx) };
  }

  leave(): { x: number; z: number; heading: number } {
    const room = this.room!;
    for (const m of room.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
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
      const info = this.crowd.clip(p.avatar, 'idle');
      const d = Math.hypot(p.matrix.elements[12] - camera.x, p.matrix.elements[14] - camera.z);
      this.crowd.add(p.avatar, p.matrix, 'idle', this.time / info.duration + p.phase, d);
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

function toLocal(d: Door, x: number, z: number): [number, number] {
  const dx = x - d.x, dz = z - d.z;
  return [dx * d.ux + dz * d.uz, -(dx * d.nx + dz * d.nz)];
}

function toWorld(d: Door, x: number, z: number): [number, number] {
  return [d.x + d.ux * x - d.nx * z, d.z + d.uz * x - d.nz * z];
}

function segmentHitsRect(ax: number, az: number, bx: number, bz: number, x0: number, x1: number, z0: number, z1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function fitRoom(door: Door, neighbours: Building[]): Fit | null {
  if (door.style === 'street') return null;
  const b = door.building;
  const height = Math.min(door.groundH - 0.1, b.h - 0.5, 4.3);
  if (height < 2.9) return null;
  const walls: number[][] = [];
  const addWalls = (ring: number[], skip = -1) => {
    const l: number[] = [];
    for (let i = 0; i < ring.length; i += 2) l.push(...toLocal(door, ring[i], ring[i + 1]));
    for (let i = 0; i < l.length; i += 2) if (i / 2 !== skip) walls.push([l[i], l[i + 1], l[(i + 2) % l.length], l[(i + 3) % l.length]]);
  };
  b.rings.forEach((ring, r) => addWalls(ring, r === 0 ? door.edge : -1));
  for (const n of neighbours) addWalls(n.rings[0]);
  const outer = b.rings[0];
  const [wantW, wantD] = SIZE[door.style];
  const fits = (left: number, right: number, depth: number) => {
    const m = 0.08;
    if (walls.some(([ax, az, bx, bz]) => segmentHitsRect(ax, az, bx, bz, -left - m, right + m, 0.04, depth + m))) return false;
    return inRing(outer, ...toWorld(door, (right - left) / 2, depth / 2));
  };
  const maxLeft = door.along - 0.25, maxRight = door.length - door.along - 0.25;
  const sizes = [0.9, 1.3, 1.8, 2.4, 3, 3.6, 4.5, 5.5, 6.5, 8];
  let best: Fit | null = null, bestScore = 0;
  for (const l of sizes) {
    for (const r of sizes) {
      const left = Math.min(l, maxLeft), right = Math.min(r, maxRight);
      if (left < 0.9 || right < 0.9 || left + right < 3.4 || left + right > wantW + 0.01) continue;
      if ((left < l && l > sizes[0]) || (right < r && r > sizes[0])) {
        // Clipped by the wall's end: only try the clipped size once.
        if (sizes[sizes.indexOf(l) - 1] >= maxLeft || sizes[sizes.indexOf(r) - 1] >= maxRight) continue;
      }
      for (let depth = wantD; depth >= 4; depth -= 0.5) {
        const area = (left + right) * depth * (depth >= 5 ? 1 : 0.6); // shallow rooms count for less
        if (area <= bestScore) break;
        if (fits(left, right, depth)) {
          best = { x0: -left, x1: right, depth, height };
          bestScore = area;
          break;
        }
      }
    }
  }
  return best;
}

interface ShellLook {
  floor: FloorKind;
  carpet?: string;
  wall: number;
  wainscot?: number;
  ceiling: number;
}

const SHELLS: Record<Place, ShellLook> = {
  cafe: { floor: 'planksDark', wall: 0xc9b38e, wainscot: 0x3d2716, ceiling: 0x8f7a5c },
  restaurant: { floor: 'planks', wall: 0xe6dccb, wainscot: 0x5d3f27, ceiling: 0xefe9de },
  fastfood: { floor: 'checker', wall: 0xf1efe9, wainscot: 0xb5372a, ceiling: 0xf4f4f2 },
  bakery: { floor: 'checker', wall: 0xeee1c6, wainscot: 0xf2f0ea, ceiling: 0xf2ece0 },
  jewelry: { floor: 'carpet', carpet: '#3a1f28', wall: 0x2d2a2e, ceiling: 0x1f1d20 },
  fashion: { floor: 'planks', wall: 0xf3f1ec, ceiling: 0xf5f5f3 },
  food: { floor: 'tiles', wall: 0xf0efeb, ceiling: 0xf4f4f2 },
  shop: { floor: 'planks', wall: 0xece6dc, ceiling: 0xf2f0ec },
  pharmacy: { floor: 'tiles', wall: 0xf4f6f4, ceiling: 0xf6f7f6 },
  bank: { floor: 'marble', wall: 0xe8e6e0, wainscot: 0x2f3b4e, ceiling: 0xf2f2f0 },
  service: { floor: 'checker', wall: 0xf1ece6, ceiling: 0xf4f2ef },
  hotel: { floor: 'marble', wall: 0xe7dfcf, wainscot: 0x4a2f1d, ceiling: 0xf0e9dc },
  culture: { floor: 'concrete', wall: 0xf4f3f0, ceiling: 0xf6f6f4 },
  club: { floor: 'carpet', carpet: '#17151c', wall: 0x16131c, ceiling: 0x0c0b10 },
  public: { floor: 'planks', wall: 0xe9e4d8, wainscot: 0x6b5236, ceiling: 0xf0ede6 },
  plate: { floor: 'carpet', carpet: '#4a5260', wall: 0xf1f1ef, ceiling: 0xf6f6f5 },
};

function shell(k: Kit, door: Door): ShellLook {
  const { x0, x1, depth: d, height: h } = k.fit;
  const look = SHELLS[door.style as Place];
  const cx = (x0 + x1) / 2, hw = (x1 - x0) / 2, cz = (FRONT + d) / 2, hd = (d - FRONT) / 2;
  k.floor.quad([cx, 0.012, cz], [hw, 0, 0], [0, 0, hd], [0, 1, 0], 0xffffff, 2);
  k.solid.quad([cx, h, cz], [hw, 0, 0], [0, 0, hd], [0, -1, 0], look.ceiling);
  k.solid.quad([cx, h / 2, d], [hw, 0, 0], [0, h / 2, 0], [0, 0, -1], look.wall);
  k.solid.quad([x0, h / 2, cz], [0, h / 2, 0], [0, 0, hd], [1, 0, 0], look.wall);
  k.solid.quad([x1, h / 2, cz], [0, h / 2, 0], [0, 0, hd], [-1, 0, 0], look.wall);
  const low = look.wainscot ?? 0x5a5550;
  const lh = look.wainscot ? 1.05 : 0.09;
  const band = (t: number, y: number, bh: number) => {
    k.solid.box(cx, d - t / 2, y, x1 - x0, t, bh, low);
    k.solid.box(x0 + t / 2, cz, y, t, d - FRONT, bh, low);
    k.solid.box(x1 - t / 2, cz, y, t, d - FRONT, bh, low);
  };
  band(0.03, 0, lh);
  if (look.wainscot) band(0.06, lh, 0.05);

  // Openings in the front wall: the door, and the facade's windows (same bays as the building shader draws).
  const b = door.building;
  const seed = rand(b, 5);
  const style = facadeStyle(seed);
  const { count, width } = bays(door.length, style.bayTarget);
  const shop = !!b.sh && (b.sf ?? []).includes(door.edge);
  const shopDoor = doorBay(seed, count);
  const holes: { x0: number; x1: number; y0: number; y1: number }[] = [{ x0: -0.6, x1: 0.6, y0: 0, y1: 2.42 }];
  for (let i = 0; i < count; i++) {
    const c = (i + 0.5) * width - door.along;
    const [half, y0, y1] = shop
      ? i === shopDoor ? [0.55, 0, Math.min(2.5, door.groundH - 1.1)] : [width * 0.44, 0.5, door.groundH - 1.1]
      : [(style.winW * width) / 2, 0.9, Math.min(h - 0.5, 0.9 + style.winH * style.floorH)];
    const lo = Math.max(c - half, x0 + 0.2), hi = Math.min(c + half, x1 - 0.2);
    if (hi - lo > 0.4 && y1 - y0 > 0.5) holes.push({ x0: lo, x1: hi, y0, y1: Math.min(y1, h - 0.3) });
  }
  const xs = [...new Set([x0, x1, ...holes.flatMap((o) => [o.x0, o.x1])])].filter((x) => x >= x0 && x <= x1).sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], c = xs[i + 1], mid = (a + c) / 2;
    const spans = holes.filter((o) => o.x0 <= mid && mid <= o.x1).map((o) => [o.y0, o.y1]).sort((p, q) => p[0] - q[0]);
    let y = 0;
    const wall = (ya: number, yb: number) => {
      if (yb - ya > 0.005) k.solid.quad([mid, (ya + yb) / 2, FRONT], [(c - a) / 2, 0, 0], [0, (yb - ya) / 2, 0], [0, 0, 1], look.wall);
    };
    for (const [ya, yb] of spans) {
      wall(y, ya);
      y = Math.max(y, yb);
    }
    wall(y, h);
  }
  for (const o of holes) {
    const overlaps = holes.some((q) => q !== o && q.x0 < o.x1 && o.x0 < q.x1);
    const w = o.x1 - o.x0, ym = (o.y0 + o.y1) / 2, hh = (o.y1 - o.y0) / 2;
    if (!overlaps) {
      k.solid.quad([o.x0, ym, FRONT / 2 - 0.03], [0, hh, 0], [0, 0, FRONT / 2 + 0.03], [1, 0, 0], look.wall);
      k.solid.quad([o.x1, ym, FRONT / 2 - 0.03], [0, hh, 0], [0, 0, FRONT / 2 + 0.03], [-1, 0, 0], look.wall);
      k.solid.quad([(o.x0 + o.x1) / 2, o.y1, FRONT / 2 - 0.03], [w / 2, 0, 0], [0, 0, FRONT / 2 + 0.03], [0, -1, 0], look.wall);
    }
    for (const x of [o.x0, o.x1]) k.solid.box(x, FRONT + 0.02, o.y0, 0.07, 0.04, o.y1 - o.y0, 0x232426);
    k.solid.box((o.x0 + o.x1) / 2, FRONT + 0.02, o.y1 - 0.035, w + 0.07, 0.04, 0.07, 0x232426);
    if (o.y0 > 0) {
      k.solid.box((o.x0 + o.x1) / 2, FRONT / 2 + 0.06, o.y0 - 0.05, w + 0.12, FRONT + 0.22, 0.05, 0xb9b2a5);
      k.glass.quad([(o.x0 + o.x1) / 2, ym, 0.0], [w / 2, 0, 0], [0, hh, 0], [0, 0, 1], 0xffffff);
    }
  }
  k.shiny.box(0, -0.04, 1.03, 0.75, 0.04, 0.04, 0x9a9da0);
  k.solid.box(0, FRONT + 0.45, 0, 1.3, 0.7, 0.012, 0x2a2624);
  return look;
}

function nameSign(door: Door, fit: Fit, world: THREE.Matrix4): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const g = canvas.getContext('2d')!;
  g.fillStyle = door.look.bg;
  g.fillRect(0, 0, 1024, 160);
  g.fillStyle = door.look.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 96;
  for (; size > 24; size -= 4) {
    g.font = door.look.font.replace('{s}', String(size));
    if (g.measureText(door.name).width < 960) break;
  }
  g.fillText(door.name, 512, 84);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const w = Math.min(fit.x1 - fit.x0 - 1, 3.6), h = (w * 160) / 1024;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  mesh.matrix.copy(world).multiply(at((fit.x0 + fit.x1) / 2, fit.height - 0.45 - h / 2, fit.depth - 0.03, 1, 1, 1, Math.PI));
  return mesh;
}

const PAINT = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xe67e22, 0x8e44ad, 0xecf0f1, 0x34495e, 0xd35400, 0x16a085, 0xf5b7b1, 0x5d6d7e];
const CLOTHES = [0x1f2633, 0x2c2c2c, 0x8a7f6e, 0xd8d2c4, 0x5b6b7a, 0x7a2e2e, 0x34513c, 0xb08d57, 0xe9e4da, 0x3c3f58];
const BOOKS = [0x7a2e2e, 0x2e4a7a, 0x2f5d3a, 0x8a6d3b, 0x3b3b3b, 0xb59a6a, 0x5a3a5e, 0x9c4f2e];

const pick = (k: Kit, list: number[]) => list[Math.floor(k.r() * list.length)];

/** How deep the clear entrance reaches: ENTRY_Z, less in a shallow room, but always past the player's spawn (radius 0.35). */
const entryZ = (depth: number) => Math.max(SPAWN_Z + 0.4, Math.min(ENTRY_Z, depth - 2.2));

/** Whether an sx by sz footprint centred on (x, z) reaches into the clear entrance. */
const inEntry = (k: Kit, x: number, z: number, sx: number, sz: number) => Math.abs(x) - sx / 2 < ENTRY_X && z - sz / 2 < entryZ(k.fit.depth);

function free(k: Kit, x: number, z: number, sx: number, sz: number, margin: number): boolean {
  const { x0, x1, depth } = k.fit;
  if (x - sx / 2 < x0 + margin || x + sx / 2 > x1 - margin || z - sz / 2 < FRONT + margin || z + sz / 2 > depth - margin) return false;
  if (inEntry(k, x, z, sx, sz)) return false;
  return !k.blocks.some(([bx, bz, bsx, bsz]) => Math.abs(bx - x) < (bsx + sx) / 2 + 0.3 && Math.abs(bz - z) < (bsz + sz) / 2 + 0.3);
}

type Goods = 'grocery' | 'general' | 'pharmacy' | 'books';

const PACKS: Record<Exclude<Goods, 'books'>, number[]> = {
  grocery: [0xf2efe6, 0xe8dcc0, 0xc0392b, 0x1f5fa8, 0xf1c40f, 0x2e7d32, 0x6d4c41, 0x212121, 0xe67e22, 0x8e244d, 0x9e9e9e, 0xffffff, 0x0d47a1],
  general: [0xece6da, 0x8a7f6e, 0x34495e, 0xb08d57, 0x7a2e2e, 0x5b6b7a, 0xd8d2c4, 0x2f5d3a, 0x1f1f1f],
  pharmacy: [0xf6f6f4, 0xf6f6f4, 0xe8f0ea, 0x2e8b57, 0x3b6fb5, 0xd9e4f2, 0xc0392b],
};
const PRODUCT = new THREE.CylinderGeometry(1, 1, 1, 8);

function shelving(k: Kit, x: number, z: number, length: number, alongZ: boolean, faces: number, levels: number[], goods: Goods, density: number, frame = 0xd9d9d6) {
  const depth = faces === 0 ? 0.9 : 0.45;
  const [sx, sz] = alongZ ? [depth, length] : [length, depth];
  const top = levels[levels.length - 1] + 0.42;
  block(k, x, z, 0, sx, sz, 0.1, 0x3a3a3a);
  k.solid.box(x + (alongZ && faces ? -faces * (depth / 2 - 0.02) : 0), z + (!alongZ && faces ? -faces * (depth / 2 - 0.02) : 0), 0.1,
    alongZ ? 0.04 : length, alongZ ? length : 0.04, top - 0.1, frame);
  for (const e of [-1, 1]) {
    k.solid.box(x + (alongZ ? 0 : (e * (length - 0.04)) / 2), z + (alongZ ? (e * (length - 0.04)) / 2 : 0), 0, alongZ ? depth : 0.04, alongZ ? 0.04 : depth, top, frame);
  }
  const half = faces === 0 ? depth / 2 : depth;
  for (const side of faces === 0 ? [-1, 1] : [faces]) {
    const off = faces === 0 ? side * depth * 0.25 : 0;
    const put = (along: number, y: number, w: number, d: number, h: number, colour: number, round: boolean) => {
      const o = off + side * (half / 2 - d / 2 - 0.03);
      const [px, pz] = alongZ ? [x + o, z + along] : [x + along, z + o];
      if (round) k.solid.geometry(PRODUCT, at(px, y + h / 2, pz, w / 2, h, w / 2), colour);
      else k.solid.box(px, pz, y, alongZ ? d : w, alongZ ? w : d, h, colour);
    };
    for (const y of levels) {
      k.solid.box(x + (alongZ ? off : 0), z + (alongZ ? 0 : off), y - 0.025, alongZ ? half : length - 0.06, alongZ ? length - 0.06 : half, 0.025, frame);
      const room = Math.min(0.36, (levels[1] ?? y + 0.45) - levels[0] - 0.06);
      for (let s = -length / 2 + 0.06; s < length / 2 - 0.1;) {
        if (goods === 'books') {
          const w = 0.025 + k.r() * 0.04, h = room * (0.62 + k.r() * 0.35);
          if (k.r() < density) put(s + w / 2, y, w, 0.2 + k.r() * 0.05, h, pick(k, BOOKS), false);
          s += w + 0.004;
          continue;
        }
        const shape = goods === 'pharmacy' ? 0 : k.r();
        const round = shape > 0.55;
        const w = round ? 0.06 + k.r() * 0.03 : 0.05 + k.r() * 0.1;
        const h = Math.min(room, round ? (shape > 0.8 ? 0.11 : 0.2 + k.r() * 0.1) : 0.08 + k.r() * 0.2);
        const d = round ? w : Math.min(half - 0.08, 0.06 + k.r() * 0.14);
        const colour = pick(k, PACKS[goods]);
        const n = 2 + Math.floor(k.r() * 5);
        const gap = k.r() > density;
        for (let i = 0; i < n && s < length / 2 - 0.1; i++) {
          if (!gap) put(s + w / 2, y, w, d, h, colour, round);
          s += w + 0.008;
        }
        s += 0.02;
      }
    }
  }
}

function person(k: Kit, x: number, z: number, fx: number, fz: number) {
  const { x0, x1, depth } = k.fit;
  if (x < x0 + 0.35 || x > x1 - 0.35 || z < FRONT + 0.35 || z > depth - 0.3 || inEntry(k, x, z, 0.5, 0.5)) return;
  if (k.blocks.some(([bx, bz, sx, sz]) => Math.abs(bx - x) < sx / 2 + 0.22 && Math.abs(bz - z) < sz / 2 + 0.22)) return;
  if (k.people.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.6)) return;
  k.people.push([x, z, fx, fz]);
}

function block(k: Kit, x: number, z: number, y0: number, sx: number, sz: number, h: number, colour: number) {
  k.solid.box(x, z, y0, sx, sz, h, colour);
  k.blocks.push([x, z, sx, sz]);
}

function pendant(k: Kit, x: number, z: number) {
  const h = k.fit.height;
  k.solid.box(x, z, h - 0.75, 0.012, 0.012, 0.75, 0x1a1a1a);
  k.solid.geometry(SHADE, at(x, h - 0.82, z, 1, 1, 1), 0x1e2a24);
  k.glow.geometry(BALL, at(x, h - 0.88, z, 0.08, 0.08, 0.08), 0xffd9a0);
}

function ceilingLight(k: Kit, x: number, z: number, sx: number, sz: number) {
  k.glow.box(x, z, k.fit.height - 0.03, sx, sz, 0.03, 0xf4f2ec, true);
}

function spot(k: Kit, x: number, z: number, r: number, colour: number) {
  k.glow.geometry(CYL, at(x, k.fit.height - 0.02, z, r, 0.02, r), colour);
}

function chair(k: Kit, x: number, z: number, faceX: number, faceZ: number, colour: number) {
  k.solid.box(x, z, 0.44, 0.42, 0.42, 0.04, colour);
  k.solid.box(x - faceX * 0.19, z - faceZ * 0.19, 0.48, faceX ? 0.04 : 0.42, faceZ ? 0.04 : 0.42, 0.45, colour);
  for (const dx of [-0.17, 0.17]) for (const dz of [-0.17, 0.17]) k.solid.box(x + dx, z + dz, 0, 0.03, 0.03, 0.44, 0x2a2a2a);
}

function table(k: Kit, x: number, z: number, round: boolean, top: number, chairs: number) {
  if (round) {
    k.solid.geometry(CYL, at(x, 0.75, z, 0.36, 0.035, 0.36), top);
    k.solid.geometry(CYL, at(x, 0.37, z, 0.035, 0.74, 0.035), 0x222222);
    k.solid.geometry(CYL, at(x, 0.015, z, 0.22, 0.03, 0.22), 0x222222);
  } else {
    k.solid.box(x, z, 0.72, 0.8, 0.8, 0.04, top);
    for (const dx of [-0.35, 0.35]) for (const dz of [-0.35, 0.35]) k.solid.box(x + dx, z + dz, 0, 0.04, 0.04, 0.72, 0x2a2a2a);
  }
  chair(k, x - 0.62, z, 1, 0, chairs);
  chair(k, x + 0.62, z, -1, 0, chairs);
  k.blocks.push([x, z, 1.6, 0.8]);
}

function bottles(k: Kit, x0: number, x1: number, y: number, z: number) {
  for (let x = x0; x < x1; x += 0.09 + k.r() * 0.05) {
    const hgt = 0.22 + k.r() * 0.12;
    k.shiny.geometry(CYL, at(x, y + hgt / 2, z, 0.035, hgt, 0.035), pick(k, [0x2f5d3a, 0x5a3a1e, 0xc9d6d0, 0x7a2e2e, 0x8a6d3b, 0x1f2e2a]));
  }
}

function plant(k: Kit, x: number, z: number, big = true) {
  const s = big ? 1 : 0.6;
  k.solid.geometry(CYL, at(x, 0.25 * s, z, 0.22 * s, 0.5 * s, 0.22 * s), 0x8a8580);
  k.solid.geometry(BALL, at(x, 0.95 * s, z, 0.42 * s, 0.6 * s, 0.42 * s), 0x2f5a2c);
  k.blocks.push([x, z, 0.5 * s, 0.5 * s]);
}

function counter(k: Kit, x: number, z: number, length: number, front: number, top: number, h: number, depth: number) {
  block(k, x, z, 0, length, depth, h - 0.04, front);
  k.shiny.box(x, z - 0.03, h - 0.04, length + 0.06, depth + 0.1, 0.04, top);
}

function till(k: Kit, x: number, z: number, y: number) {
  k.solid.box(x, z, y, 0.32, 0.22, 0.08, 0x2a2a2a);
  k.solid.box(x, z + 0.05, y + 0.08, 0.04, 0.04, 0.18, 0x2a2a2a);
  k.glow.box(x, z + 0.04, y + 0.22, 0.3, 0.02, 0.2, 0x7fa7c9);
}

function picture(k: Kit, x: number, z: number, y: number, w: number, h: number, wall: 'back' | 'left' | 'right', frame: number) {
  const along = wall === 'back';
  const nx = wall === 'left' ? 1 : wall === 'right' ? -1 : 0, nz = along ? -1 : 0;
  k.solid.box(x, z, y - h / 2, along ? w + 0.1 : 0.04, along ? 0.04 : w + 0.1, h + 0.1, frame);
  k.solid.quad([x + nx * 0.025, y, z + nz * 0.025], along ? [w / 2, 0, 0] : [0, 0, w / 2], [0, h / 2, 0], [nx, 0, nz], pick(k, [0xe9e1d0, 0x2b2b2b, 0x9c3b2b, 0x2e4a7a, 0xd9b44a]));
  for (let i = 0; i < 3; i++) {
    const hw = w * (0.08 + k.r() * 0.18), hh = h * (0.08 + k.r() * 0.18);
    const off = 0.004 * (i + 1);
    k.solid.quad([x + nx * (0.025 + off) + (along ? (k.r() - 0.5) * (w - 2 * hw) : 0), y + (k.r() - 0.5) * (h - 2 * hh), z + nz * (0.025 + off) + (along ? 0 : (k.r() - 0.5) * (w - 2 * hw))],
      along ? [hw, 0, 0] : [0, 0, hw], [0, hh, 0], [nx, 0, nz], pick(k, PAINT));
  }
}

function furnish(k: Kit, style: Place) {
  const { x0, x1, depth: d, height: h } = k.fit;
  const span = x1 - x0, cx = (x0 + x1) / 2;
  const back = d - 0.45;

  switch (style) {
    case 'cafe':
    case 'restaurant':
    case 'fastfood': {
      const cafe = style === 'cafe', fast = style === 'fastfood';
      const barZ = d - 1.55, barL = Math.min(span - 1.2, 6);
      counter(k, cx, barZ, barL, cafe ? 0x3a2414 : fast ? 0xb5372a : 0x5d3f27, cafe ? 0x1b120c : 0x2a2a2a, 1.08, 0.6);
      if (fast) {
        for (let i = 0; i < 3; i++) k.glow.box(cx + (i - 1) * Math.min(1.3, barL / 3), d - 0.04, h - 1.3, Math.min(1.2, barL / 3 - 0.1), 0.03, 0.75, [0x3a2a1c, 0x2a1e14, 0x4a2f1a][i]);
        for (let x = cx - barL / 2 + 0.4; x < cx + barL / 2 - 0.3; x += 1.2) till(k, x, barZ, 1.08);
      } else {
        for (const y of [1.25, 1.7, 2.15]) {
          if (y > h - 1.4) continue;
          k.solid.box(cx, d - 0.15, y - 0.03, barL, 0.28, 0.03, 0x2a1a0e);
          bottles(k, cx - barL / 2 + 0.1, cx + barL / 2 - 0.1, y, d - 0.15);
        }
        if (cafe) for (let x = cx - 0.6; x <= cx + 0.6; x += 0.3) k.shiny.geometry(CYL, at(x, 1.25, barZ + 0.1, 0.025, 0.35, 0.025), 0xc9c9c9);
      }
      person(k, cx + (k.r() - 0.5) * (barL - 1), d - 0.85, 0, -1);
      if (!fast) {
        for (let x = cx - barL / 2 + 0.4; x < cx + barL / 2 - 0.2; x += 0.75) {
          if (inEntry(k, x, barZ - 0.65, 0.36, 0.36)) continue;
          k.solid.geometry(CYL, at(x, 0.74, barZ - 0.65, 0.17, 0.06, 0.17), cafe ? 0x5a1e1e : 0x2a2a2a);
          k.solid.geometry(CYL, at(x, 0.37, barZ - 0.65, 0.03, 0.74, 0.03), 0x1e1e1e);
          k.blocks.push([x, barZ - 0.65, 0.36, 0.36]);
        }
      }
      for (let i = 0, n = 1 + Math.floor(k.r() * 2); i < n; i++) person(k, cx + (k.r() - 0.5) * (barL - 1), barZ - 1.15, 0, 1);
      const top = cafe ? 0x4a2f1c : style === 'restaurant' ? 0xf2efe8 : 0xdedad2;
      for (let z = FRONT + 1.3; z < barZ - 1.9; z += 1.9) {
        for (let x = x0 + 1.05; x < x1 - 0.9; x += 2.0) {
          if (!free(k, x, z, 1.7, 0.9, 0.15)) continue;
          table(k, x, z, cafe, top, cafe ? 0x3a2a1c : fast ? 0xb5372a : 0x5d3f27);
          if (!fast) pendant(k, x, z);
        }
      }
      if (fast) {
        for (let x = cx - barL / 2 + 0.6; x < cx + barL / 2; x += 1.4) ceilingLight(k, x, barZ - 0.6, 0.9, 0.3);
        for (let z = FRONT + 1.5; z < barZ - 1; z += 2.4) ceilingLight(k, cx, z, Math.min(span - 1, 3), 0.25);
      } else {
        for (const x of [cx - barL / 2 + 0.4, cx + barL / 2 - 0.4]) pendant(k, x, barZ);
      }
      if (span > 6) plant(k, x0 + 0.45, FRONT + 0.5);
      break;
    }
    case 'food': {
      const z0 = 3.0, z1 = d - 1.9;
      const len = z1 - z0;
      const levels = [0.15, 0.55, 0.95, 1.35, 1.7];
      if (len > 1.5) {
        for (let x = x0 + 1.9; x < x1 - 1.1; x += 2.3) {
          if (Math.abs(x) < 0.9) continue;
          shelving(k, x, (z0 + z1) / 2, len, true, 0, levels, 'grocery', 0.94);
          ceilingLight(k, x - 1.15, (z0 + z1) / 2, 0.15, len);
        }
        shelving(k, x0 + 0.25, (2.6 + z1) / 2, z1 - 2.6, true, 1, levels, 'grocery', 0.94);
        shelving(k, x1 - 0.25, (2.6 + z1) / 2, z1 - 2.6, true, -1, levels, 'grocery', 0.94);
      }
      const fl = span - 0.8;
      block(k, cx, back - 0.05, 0, fl, 0.8, 0.25, 0xe9e9e6);
      k.solid.box(cx, back - 0.05, 2.0, fl, 0.8, 0.2, 0xe9e9e6);
      k.glow.quad([cx, 1.12, d - 0.1], [fl / 2, 0, 0], [0, 0.88, 0], [0, 0, -1], 0xdde8f2);
      for (const y of [0.3, 0.75, 1.2, 1.65]) {
        k.shiny.box(cx, d - 0.45, y - 0.02, fl, 0.6, 0.02, 0xb0b4b8);
        for (let x = cx - fl / 2 + 0.06; x < cx + fl / 2 - 0.05; x += 0.085) {
          if (k.r() < 0.85) k.solid.geometry(CYL, at(x, y + 0.13, d - 0.62, 0.032, 0.26, 0.032), pick(k, [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0xecf0f1, 0x2c2c2c]));
        }
      }
      k.glass.quad([cx, 1.12, back - 0.46], [fl / 2, 0, 0], [0, 0.88, 0], [0, 0, -1], 0xffffff);
      const side = x1 > 3.2 ? 1 : x0 < -3.2 ? -1 : 0;
      if (side) {
        block(k, side * 2.3, 1.75, 0, 0.7, 1.5, 0.88, 0x3a3f45);
        k.solid.box(side * 2.3, 1.75, 0.88, 0.55, 1.4, 0.03, 0x1a1a1a);
        till(k, side * 2.3 + side * 0.2, 2.3, 0.91);
        person(k, side * 2.95, 2.1, -side, 0);
        person(k, side * 1.65, 1.5, 0, 1);
      }
      for (let i = 0; i < 3; i++) {
        const aisle = Math.floor(k.r() * Math.max(1, span / 2.3));
        person(k, aisle === 0 ? x0 + 0.96 : x0 + 0.75 + 2.3 * aisle, z0 + 0.3 + k.r() * Math.max(0.3, len - 0.6), k.r() < 0.5 ? 1 : -1, 0);
      }
      for (let z = FRONT + 1.2; z < 2.8; z += 1.3) ceilingLight(k, 0, z, 1.6, 0.18);
      k.solid.box(-1.4, FRONT + 0.6, 0, 0.45, 0.35, 0.5, 0xc0392b);
      break;
    }
    case 'fashion': {
      const rail = (x: number, z0: number, z1: number) => {
        const len = z1 - z0, zc = (z0 + z1) / 2;
        for (const z of [z0 + 0.05, z1 - 0.05]) k.shiny.geometry(CYL, at(x, 0.8, z, 0.018, 1.6, 0.018), 0xb8b8b8);
        k.shiny.box(x, zc, 1.58, 0.03, len, 0.03, 0xc8c8c8);
        for (let z = z0 + 0.12; z < z1 - 0.1; z += 0.07 + k.r() * 0.05) {
          const long = 0.55 + k.r() * 0.4, c = pick(k, CLOTHES);
          k.solid.box(x, z, 1.47 - long, 0.46, 0.03, long, c);
          k.solid.box(x, z, 1.47, 0.34, 0.03, 0.06, c);
          k.shiny.box(x, z, 1.53, 0.02, 0.01, 0.06, 0x9a9a9a);
        }
        k.blocks.push([x, zc, 0.6, len]);
      };
      if (d - 1.3 > 3) {
        rail(x0 + 0.4, 2.6, d - 1.3);
        rail(x1 - 0.4, 2.6, d - 1.3);
        // The middle rails start further in: only where that still leaves a rail.
        if (span > 6.5 && d - 2.2 > 3.6) for (const x of [-1.6, 1.6]) if (x > x0 + 1.8 && x < x1 - 1.8) rail(x, 3.2, Math.min(d - 2.2, 7));
      }
      const mannequin = (x: number, z: number) => {
        const c = pick(k, CLOTHES);
        k.solid.geometry(CYL, at(x, 0.02, z, 0.2, 0.04, 0.2), 0x2a2a2a);
        k.solid.box(x, z, 0.1, 0.24, 0.16, 0.8, pick(k, CLOTHES));
        k.solid.box(x, z, 0.9, 0.38, 0.22, 0.58, c);
        k.solid.geometry(BALL, at(x, 1.62, z, 0.11, 0.13, 0.11), 0xe9e6e0);
        k.blocks.push([x, z, 0.5, 0.4]);
      };
      if (x0 < -2.2) mannequin(x0 + 1.2, FRONT + 0.9);
      if (x1 > 2.2) mannequin(x1 - 1.2, FRONT + 0.9);
      counter(k, cx, d - 1.4, Math.min(1.8, span - 2), 0xf4f2ee, 0x1e1e1e, 1.0, 0.6);
      till(k, cx + 0.4, d - 1.4, 1.0);
      person(k, cx, d - 0.75, 0, -1);
      person(k, x0 + 1.15, 3.2 + k.r() * Math.max(0, d - 5), -1, 0);
      k.shiny.box(x1 - 0.04, d - 0.9, 0.1, 0.02, 0.7, 1.9, 0xd8dde0);
      for (let x = x0 + 1; x < x1 - 0.5; x += 1.8) for (let z = FRONT + 1.2; z < d - 0.6; z += 2) spot(k, x, z, 0.09, 0xfff6e6);
      break;
    }
    case 'bakery': {
      const cz = Math.max(d - 2.2, entryZ(d) + 0.35), cl = span - 1.0; // a shallow room's counter goes back, clear of the entrance
      counter(k, cx, cz, cl, 0xf2efe8, 0x8a6d3b, 0.9, 0.7);
      k.glow.box(cx, cz, 0.93, cl - 0.1, 0.55, 0.02, 0xfff1d6);
      for (const tray of [0.97, 1.17]) {
        for (let x = cx - cl / 2 + 0.12; x < cx + cl / 2 - 0.1; x += 0.13) {
          k.solid.geometry(BALL, at(x, tray + 0.03, cz - 0.1 + (tray > 1 ? 0.12 : -0.05), 0.055, 0.03, 0.05), pick(k, [0xb8762a, 0xd9a24a, 0x7a3e1a, 0xe8c9a0, 0xc7586a]));
        }
      }
      k.solid.box(cx, cz, 1.13, cl - 0.1, 0.55, 0.015, 0xd0d0d0);
      k.glass.quad([cx, 1.2, cz - 0.34], [cl / 2, 0, 0], [0, 0.28, 0], [0, 0, -1], 0xffffff);
      k.glass.quad([cx, 1.48, cz], [cl / 2, 0, 0], [0, 0, 0.34], [0, 1, 0], 0xffffff);
      for (const y of [0.95, 1.4, 1.85]) {
        k.solid.box(cx, d - 0.22, y - 0.03, span - 0.6, 0.4, 0.03, 0x8a6d3b);
        for (let x = cx - span / 2 + 0.45; x < cx + span / 2 - 0.4; x += 0.3) {
          k.solid.geometry(BALL, at(x, y + 0.06, d - 0.22, 0.13, 0.07, 0.09), pick(k, [0xa0612a, 0x8a4f22, 0xc98a45, 0x6b3a1a]));
        }
      }
      person(k, cx, cz + 1.0, 0, -1);
      person(k, cx + (k.r() - 0.5) * 1.5, cz - 1.0, 0, 1);
      for (let x = cx - cl / 2 + 0.6; x < cx + cl / 2; x += 1.4) pendant(k, x, cz);
      break;
    }
    case 'jewelry': {
      const caseAt = (x: number, z: number, sx: number, sz: number) => {
        block(k, x, z, 0, sx, sz, 0.9, 0x1c1a1d);
        k.glow.box(x, z, 0.9, sx - 0.04, sz - 0.04, 0.015, 0x3a3236);
        for (let i = 0; i < sx * sz * 40; i++) {
          k.glow.box(x + (k.r() - 0.5) * (sx - 0.1), z + (k.r() - 0.5) * (sz - 0.1), 0.92, 0.025, 0.025, 0.012, k.r() < 0.6 ? 0xf2d27a : 0xf4f4f4);
        }
        k.glass.quad([x, 1.25, z], [sx / 2, 0, 0], [0, 0, sz / 2], [0, 1, 0], 0xffffff);
        for (const s of [-1, 1]) {
          k.glass.quad([x, 1.07, z + (s * sz) / 2], [sx / 2, 0, 0], [0, 0.18, 0], [0, 0, s], 0xffffff);
          k.glass.quad([x + (s * sx) / 2, 1.07, z], [0, 0.18, 0], [0, 0, sz / 2], [s, 0, 0], 0xffffff);
        }
      };
      if (d > 5) {
        caseAt(x0 + 0.35, (2.6 + d - 1.5) / 2, 0.55, d - 4.1);
        caseAt(x1 - 0.35, (2.6 + d - 1.5) / 2, 0.55, d - 4.1);
      }
      if (span > 4.5 && d > 6) caseAt(cx, (d + 2.4) / 2 - 0.4, 0.8, 0.8);
      counter(k, cx, d - 1.2, Math.min(2, span - 2), 0x1c1a1d, 0x0e0e0e, 1.0, 0.6);
      person(k, cx, d - 0.6, 0, -1);
      person(k, cx + 0.5, d - 2.0, 0, 1);
      for (let x = x0 + 0.8; x < x1 - 0.3; x += 1.5) for (let z = FRONT + 1.5; z < d - 0.3; z += 1.8) spot(k, x, z, 0.06, 0xfff1d0);
      break;
    }
    case 'pharmacy':
    case 'shop': {
      const pharmacy = style === 'pharmacy';
      const goods: Goods = pharmacy ? 'pharmacy' : 'general';
      const frame = pharmacy ? 0xf2f2f0 : 0xb08d57;
      const levels = [0.4, 0.85, 1.3, 1.75].filter((y) => y < h - 1.5);
      if (d - 2.8 > 1.5) {
        shelving(k, x0 + 0.25, (2.6 + d - 0.4) / 2, d - 3.0, true, 1, levels, goods, 0.85, frame);
        shelving(k, x1 - 0.25, (2.6 + d - 0.4) / 2, d - 3.0, true, -1, levels, goods, 0.85, frame);
      }
      if (span - 1.2 > 1.5) shelving(k, cx, d - 0.25, span - 1.2, false, -1, levels, goods, 0.9, frame);
      const cz = pharmacy ? d - 1.7 : d - 1.6;
      counter(k, cx, cz, Math.min(span - 2.2, pharmacy ? 4 : 2), 0xf4f4f2, pharmacy ? 0x2e8b57 : 0x6b4a30, 1.0, 0.6);
      till(k, cx + 0.5, cz, 1.0);
      person(k, cx - 0.3, cz + 0.65, 0, -1);
      if (pharmacy) {
        k.glow.box(x0 + 0.03, FRONT + 1.8, h - 1.1, 0.02, 0.18, 0.55, 0x2bd46b);
        k.glow.box(x0 + 0.03, FRONT + 1.8, h - 0.92, 0.02, 0.55, 0.18, 0x2bd46b);
      }
      if (free(k, cx, (2.4 + cz) / 2, 1.3, 0.8, 0.6) && cz - 2.4 > 2.2) {
        const tz = (2.4 + cz) / 2;
        block(k, cx, tz, 0, 1.3, 0.8, 0.78, 0xd8cdb8);
        for (let i = 0; i < 10; i++) k.solid.box(cx + (k.r() - 0.5) * 1.1, tz + (k.r() - 0.5) * 0.6, 0.78, 0.14, 0.14, 0.08 + k.r() * 0.2, pick(k, PACKS[goods]));
      }
      person(k, cx + 0.2, cz - 0.95, 0, 1);
      for (let z = FRONT + 1.5; z < d - 0.5; z += 2.2) ceilingLight(k, cx, z, Math.min(span - 1.5, 2.5), 0.3);
      break;
    }
    case 'bank': {
      for (const x of [cx - 1.4, cx + 1.4]) {
        if (x < x0 + 0.9 || x > x1 - 0.9) continue;
        block(k, x, d - 1.8, 0.72, 1.4, 0.7, 0.04, 0xe9e6e0);
        k.solid.box(x, d - 1.8, 0, 1.36, 0.04, 0.72, 0x2f3b4e);
        k.solid.box(x, d - 1.6, 0.76, 0.5, 0.04, 0.32, 0x1a1a1a);
        k.glow.box(x, d - 1.62, 0.79, 0.46, 0.01, 0.26, 0x8fb4d6);
        person(k, x, d - 1.1, 0, -1);
        chair(k, x - 0.3, d - 2.45, 0, 1, 0x2f3b4e);
        chair(k, x + 0.3, d - 2.45, 0, 1, 0x2f3b4e);
      }
      block(k, x0 + 0.2, FRONT + 2.8, 0, 0.4, 0.7, 1.7, 0x5a6068);
      k.glow.box(x0 + 0.41, FRONT + 2.8, 1.15, 0.01, 0.4, 0.3, 0x7fb0e0);
      plant(k, x1 - 0.45, FRONT + 0.6);
      plant(k, x0 + 0.45, d - 0.5);
      person(k, cx + 0.6, d - 3.2, 0, 1);
      for (let z = FRONT + 1.5; z < d - 0.5; z += 2.2) ceilingLight(k, cx, z, Math.min(span - 1.5, 3), 0.5);
      break;
    }
    case 'service': {
      for (let z = 2.8; z < d - 1.0; z += 1.4) {
        k.shiny.box(x0 + 0.03, z, 1.0, 0.02, 0.8, 1.0, 0xd8dde0);
        k.solid.box(x0 + 0.2, z, 0.85, 0.3, 0.9, 0.04, 0xf2f2f0);
        k.solid.geometry(CYL, at(x0 + 0.95, 0.25, z, 0.24, 0.5, 0.24), 0x1a1a1a);
        k.solid.box(x0 + 0.95, z, 0.5, 0.5, 0.5, 0.12, 0x2a2a2a);
        k.solid.box(x0 + 1.17, z, 0.6, 0.08, 0.5, 0.55, 0x2a2a2a);
        k.blocks.push([x0 + 0.95, z, 0.6, 0.6]);
      }
      person(k, x0 + 1.55, 2.8, -1, 0);
      counter(k, x1 - 1.0, d - 1.3, 1.2, 0x2a2a2a, 0xd8d2c4, 1.05, 0.55);
      person(k, x1 - 1.0, d - 0.7, 0, -1);
      if (x1 > 2.3) block(k, x1 - 0.9, FRONT + 0.45, 0.42, 1.2, 0.42, 0.06, 0x8a7f6e);
      plant(k, x1 - 0.4, d - 2.4, false);
      for (let z = FRONT + 1.5; z < d - 0.5; z += 2) ceilingLight(k, cx, z, 0.6, 0.6);
      break;
    }
    case 'hotel': {
      counter(k, cx, d - 1.6, Math.min(2.6, span - 2), 0x4a2f1d, 0xe8e2d6, 1.1, 0.7);
      person(k, cx, d - 0.9, 0, -1);
      for (let i = 0; i < 12; i++) k.shiny.box(cx - 0.75 + (i % 6) * 0.3, d - 0.04, 1.4 + Math.floor(i / 6) * 0.3, 0.06, 0.03, 0.12, 0xc9a04a);
      const sx = x0 + 2.0;
      if (sx + 1.1 < x1 - 1.0 && d > 6) {
        const sz = d / 2 + 0.3;
        k.solid.box(sx, sz, 0.005, 2.6, 2.4, 0.01, 0x6b1f2a);
        for (const s of [-1, 1]) {
          const z = sz + s * 1.0;
          block(k, sx, z, 0, 1.8, 0.85, 0.42, 0x2f3b4e);
          k.solid.box(sx, z + s * 0.33, 0.42, 1.8, 0.2, 0.45, 0x2f3b4e);
          for (const e of [-1, 1]) k.solid.box(sx + e * 0.85, z, 0.42, 0.14, 0.85, 0.2, 0x2f3b4e);
        }
        block(k, sx, sz, 0, 1.0, 0.6, 0.42, 0x3a2414);
      }
      plant(k, x0 + 0.45, d - 0.5);
      plant(k, x1 - 0.45, FRONT + 0.6);
      if (d > 7) {
        k.shiny.quad([x1 - 0.01, 1.05, d - 2.5], [0, 1.05, 0], [0, 0, 0.55], [-1, 0, 0], 0xb8bcc0);
        k.solid.box(x1 - 0.02, d - 2.5, 2.1, 0.04, 1.3, 0.12, 0x2a2a2a);
        k.glow.box(x1 - 0.03, d - 3.2, 1.2, 0.02, 0.08, 0.14, 0xf2d27a);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        k.glow.geometry(BALL, at(cx + Math.cos(a) * 0.35, h - 0.75, d / 2 + Math.sin(a) * 0.35, 0.06, 0.08, 0.06), 0xffe2b0);
      }
      k.shiny.geometry(CYL, at(cx, h - 0.4, d / 2, 0.02, 0.8, 0.02), 0xc9a04a);
      k.shiny.geometry(CYL, at(cx, h - 0.75, d / 2, 0.38, 0.03, 0.38), 0xc9a04a);
      person(k, cx - 0.6, d - 2.5, 0, 1);
      break;
    }
    case 'culture': {
      for (let x = x0 + 1.2; x < x1 - 0.9; x += 2.2) {
        const ph = 0.8 + k.r() * 0.3;
        picture(k, x, d - 0.02, Math.min(1.6, h - 1.2 - ph / 2), 1.1, ph, 'back', pick(k, [0x1a1a1a, 0xb08d57, 0xf4f4f2]));
        spot(k, x, d - 1.0, 0.07, 0xfff6e6);
      }
      for (let z = 2.8; z < d - 1.0; z += 2.4) {
        picture(k, x0 + 0.02, z, 1.65, 1.1, 0.8 + k.r() * 0.4, 'left', pick(k, [0x1a1a1a, 0xb08d57]));
        picture(k, x1 - 0.02, z, 1.65, 1.1, 0.8 + k.r() * 0.4, 'right', pick(k, [0x1a1a1a, 0xb08d57]));
        spot(k, x0 + 1.0, z, 0.07, 0xfff6e6);
        spot(k, x1 - 1.0, z, 0.07, 0xfff6e6);
      }
      if (d > 6) block(k, cx, d / 2 + 0.8, 0, 1.6, 0.45, 0.45, 0x3a2414);
      if (span > 5 && d > 7) {
        const px = cx + 1.8 < x1 - 1 ? cx + 1.8 : cx - 1.8;
        block(k, px, d / 2 - 1.2, 0, 0.5, 0.5, 1.0, 0xf4f4f2);
        k.shiny.geometry(KNOT, at(px, 1.28, d / 2 - 1.2, 1, 1, 1), 0x8a5a2b);
      }
      person(k, x1 - 0.6, FRONT + 1.6, -1, 0);
      person(k, cx - 0.4, d - 2.0, 0, 1);
      break;
    }
    case 'club': {
      const neon = [0xff3fa4, 0x3fe0ff, 0x9b5cff, 0xffb347];
      const fz0 = 2.6, fz1 = Math.max(fz0 + 2, d - 2.4), fx0 = x0 + 0.8, fx1 = Math.min(x1 - 2.2, x0 + 0.8 + 6);
      for (let x = fx0; x < fx1 - 0.25; x += 0.6) {
        for (let z = fz0; z < fz1 - 0.25; z += 0.6) k.glow.box(x + 0.3, z + 0.3, 0.012, 0.56, 0.56, 0.008, k.r() < 0.5 ? 0x1a1424 : pick(k, neon));
      }
      block(k, cx, d - 0.9, 0, Math.min(2.2, span - 2), 0.8, 1.1, 0x111114);
      for (const s of [-0.4, 0.4]) k.solid.geometry(CYL, at(cx + s, 1.12, d - 0.9, 0.17, 0.03, 0.17), 0x2a2a2a);
      k.glow.box(cx, d - 1.31, 0.2, Math.min(2.0, span - 2.2), 0.02, 0.7, 0x9b5cff);
      person(k, cx, d - 0.3, 0, -1);
      if (x1 - fx1 > 1.4 && d - 4.8 > 0.5) {
        const bz = (2.6 + d - 2) / 2;
        block(k, x1 - 0.6, bz, 0, 0.6, d - 4.6, 1.08, 0x1c1820);
        k.glow.box(x1 - 0.91, bz, 0.15, 0.02, d - 4.8, 0.05, 0xff3fa4);
        k.glow.box(x1 - 0.12, bz, 1.46, 0.2, d - 4.8, 0.03, 0x3fe0ff);
        for (let z = 2.5; z < d - 2.2; z += 0.1 + k.r() * 0.05) {
          const hgt = 0.22 + k.r() * 0.12;
          k.shiny.geometry(CYL, at(x1 - 0.12, 1.49 + hgt / 2, z, 0.035, hgt, 0.035), pick(k, [0x2f5d3a, 0x5a3a1e, 0xc9d6d0, 0x7a2e2e, 0x8a6d3b]));
        }
        person(k, x1 - 0.2, bz, -1, 0);
      }
      for (let x = fx0 + 0.6; x < fx1; x += 1.3) for (let z = fz0 + 0.6; z < fz1; z += 1.5) k.glow.geometry(CYL, at(x, h - 0.03, z, 0.1, 0.03, 0.1), pick(k, neon));
      for (let i = 0; i < 6; i++) person(k, fx0 + 0.4 + k.r() * (fx1 - fx0 - 0.8), fz0 + 0.4 + k.r() * (fz1 - fz0 - 0.8), k.r() - 0.5, k.r() - 0.5);
      break;
    }
    case 'public': {
      const books = (x: number, z: number, length: number, alongZ: boolean, faces: number) =>
        shelving(k, x, z, length, alongZ, faces, [0.35, 0.75, 1.15, 1.55, 1.95].filter((y) => y < h - 1.5), 'books', 0.95, 0x5a3e26);
      if (d - 3 > 1.5) {
        books(x0 + 0.22, (2.6 + d - 0.4) / 2, d - 3.0, true, 1);
        books(x1 - 0.22, (2.6 + d - 0.4) / 2, d - 3.0, true, -1);
      }
      if (span > 2) books(cx, d - 0.22, span - 1.2, false, -1);
      for (let z = 3.0; z < d - 1.6; z += 2.2) {
        for (let x = x0 + 1.8; x < x1 - 1.6; x += 2.6) {
          if (!free(k, x, z, 1.6, 1.4, 0.6)) continue;
          k.solid.box(x, z, 0.72, 1.6, 0.8, 0.04, 0x8a6d3b);
          for (const dx of [-0.7, 0.7]) for (const dz of [-0.32, 0.32]) k.solid.box(x + dx, z + dz, 0, 0.05, 0.05, 0.72, 0x3a2a1c);
          for (const s of [-1, 1]) for (const dx of [-0.4, 0.4]) chair(k, x + dx, z + s * 0.62, 0, -s, 0x5a3e26);
          k.blocks.push([x, z, 1.6, 1.4]);
          pendant(k, x, z);
        }
      }
      if (x1 > 2.5) {
        counter(k, x1 - 1.3, FRONT + 1.6, 1.4, 0x5a3e26, 0x2a1a0e, 1.0, 0.6);
        person(k, x1 - 1.3, FRONT + 2.2, 0, -1);
      }
      person(k, x0 + 1.0, d / 2, -1, 0);
      break;
    }
    case 'plate': {
      counter(k, cx, d - 1.5, Math.min(2.2, span - 1.6), 0xf2f2f0, 0x3a3f45, 1.08, 0.65);
      till(k, cx + 0.4, d - 1.5, 1.08);
      person(k, cx, d - 0.85, 0, -1);
      for (let z = 2.6; z < d - 2.4; z += 0.6) chair(k, x0 + 0.4, z, 1, 0, 0x3a4a5e);
      if (d - 2.4 > 2.8) k.blocks.push([x0 + 0.4, (2.6 + d - 2.4) / 2, 0.5, d - 5.0]);
      plant(k, x1 - 0.45, FRONT + 0.5);
      k.solid.quad([x1 - 0.01, 1.05, d - 0.9], [0, 1.05, 0], [0, 0, 0.45], [-1, 0, 0], 0x6b4a30);
      k.shiny.box(x1 - 0.04, d - 1.25, 1.0, 0.05, 0.05, 0.05, 0xc0c0c0);
      for (let z = FRONT + 1.5; z < d - 0.4; z += 2) ceilingLight(k, cx, z, 0.6, 0.6);
      break;
    }
  }
}
