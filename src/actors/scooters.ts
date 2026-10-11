import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uploadFirst } from '../core/instancing';
import { coloured, mulberry32 } from '../core/util';
import { GROUP, RAPIER, groups, type Physics } from '../physics/physics';
import type { RoadGraph } from '../world/cityData';
import type { Crowd } from './crowd';
import { SCOOTER } from './scooterGeometry';
import { block, closest, pose, ridePose, rod, type V3 } from './twoWheelers';
import type { Vehicle } from './vehicle';

export interface Brand {
  name: 'Lime' | 'Bolt' | 'Voi';
  colour: number; // also the scooter Vehicle's colour, which brandOf() maps back to the brand
  stem: number;
  word: string;
  wordColour: string;
  share: number;
}

export const BRANDS: Brand[] = [
  { name: 'Lime', colour: 0x44cc33, stem: 0xf1f2ee, word: 'lime', wordColour: '#2fb82a', share: 0.37 },
  { name: 'Bolt', colour: 0x34c47c, stem: 0x34c47c, word: 'Bolt', wordColour: '#ffffff', share: 0.36 },
  { name: 'Voi', colour: 0xf2665c, stem: 0xf2665c, word: 'voi.', wordColour: '#ffffff', share: 0.27 },
];

export const brandOf = (colour: number) => Math.max(0, BRANDS.findIndex((b) => b.colour === colour));

const DARK = 0x26282b, BLACK = 0x141414, GREY = 0x6b6f74, SILVER = 0xb9bdc1, LIGHT = 0xfff4d8, REAR_LIGHT = 0xff2a1a;
const ATLAS = 256, COLUMN = 32; // wordmark texture: one 32 px column per brand, plain white to the right
const PLAIN = [0.75, 0.5]; // atlas UV of the white patch, so the vertex colour shows as is

function paint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = coloured(g, hex), n = geo.getAttribute('position').count;
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) uvs.set(PLAIN, i * 2);
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

const tube = (a: V3, b: V3, r: number, hex: number, seg: number) => paint(rod(a, b, r, seg), hex);
const box = (c: V3, size: V3, hex: number, rz = 0) => paint(block(c, size, rz), hex);

const R = SCOOTER.wheelRadius;
const REAR: V3 = [SCOOTER.rearX, R, 0], FRONT: V3 = [SCOOTER.frontX, R, 0];
const HEAD: V3 = [SCOOTER.head[0], SCOOTER.head[1], 0], TOP: V3 = [SCOOTER.stemTop[0], SCOOTER.stemTop[1], 0];
const BAR: V3 = [SCOOTER.grip[0], SCOOTER.grip[1], 0];
const stem = (t: number): V3 => [HEAD[0] + (TOP[0] - HEAD[0]) * t, HEAD[1] + (TOP[1] - HEAD[1]) * t, 0];
const RAKE = Math.atan2(HEAD[0] - TOP[0], TOP[1] - HEAD[1]);
const STEER_AXIS = new THREE.Vector3(TOP[0] - HEAD[0], TOP[1] - HEAD[1], 0).normalize();
const STAND_LEAN = -0.1; // rad, + = over to the right: on the kickstand
const FALLEN = 1.3;
const CELL = 40;

function wheelParts(near: boolean): THREE.BufferGeometry[] {
  return [
    paint(new THREE.TorusGeometry(R - 0.03, 0.03, near ? 8 : 4, near ? 20 : 12), BLACK),
    paint(new THREE.CylinderGeometry(R - 0.04, R - 0.04, 0.05, near ? 16 : 8).rotateX(Math.PI / 2), GREY),
    paint(new THREE.CylinderGeometry(0.045, 0.045, 0.075, 8).rotateX(Math.PI / 2), DARK),
  ];
}

function mudguard(start: number, arc: number, hex: number): THREE.BufferGeometry {
  return paint(new THREE.TorusGeometry(R + 0.025, 0.012, 3, 10, arc).scale(1, 1, 4).rotateZ(start), hex);
}

function frameParts(b: Brand, near: boolean): THREE.BufferGeometry[] {
  const seg = near ? 10 : 6;
  const { deck, deckFront, deckBack } = SCOOTER;
  const len = deckFront - deckBack, mid = (deckFront + deckBack) / 2;
  return [
    box([mid, deck - 0.045, 0], [len, 0.08, 0.18], DARK),
    box([mid, deck - 0.002, 0], [len - 0.04, 0.006, 0.15], BLACK),
    ...[-1, 1].map((s) => box([mid, deck - 0.05, s * 0.091], [len - 0.06, 0.035, 0.004], b.colour)),
    tube([deckFront - 0.06, deck - 0.05, 0], HEAD, 0.045, b.colour, seg),
    ...[-1, 1].map((s) => tube([deckBack + 0.04, deck - 0.06, s * 0.05], [REAR[0], REAR[1], s * 0.05], 0.014, DARK, seg)),
    mudguard(0.3 * Math.PI, 0.65 * Math.PI, b.colour).translate(...REAR),
    box([REAR[0] - 0.15, R + 0.075, 0], [0.02, 0.03, 0.07], REAR_LIGHT),
  ];
}

function wordmarks(brand: number): THREE.BufferGeometry[] {
  const mid = stem(0.5), out = 0.034;
  return [1, -1].map((side) => {
    const g = new THREE.PlaneGeometry(0.036, 0.29).toNonIndexed();
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (brand * COLUMN + uv.getX(i) * COLUMN) / ATLAS);
    const colours = new Float32Array(uv.count * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    return g.rotateY((side * Math.PI) / 2).rotateZ(RAKE).translate(mid[0] + side * Math.cos(RAKE) * out, mid[1] + side * Math.sin(RAKE) * out, 0);
  });
}

function steeringParts(brand: number, near: boolean): THREE.BufferGeometry[] {
  const b = BRANDS[brand], seg = near ? 10 : 6;
  const lamp = stem(0.62);
  return [
    ...[-1, 1].map((s) => tube([HEAD[0], HEAD[1], s * 0.05], [FRONT[0], FRONT[1], s * 0.05], 0.014, DARK, seg)),
    tube(HEAD, TOP, 0.032, b.stem, seg),
    tube(TOP, BAR, 0.03, b.stem, seg),
    box([lamp[0] + 0.035, lamp[1], 0], [0.03, 0.05, 0.06], LIGHT, RAKE),
    box([BAR[0] + 0.02, BAR[1] + 0.03, 0], [0.1, 0.035, 0.13], DARK),
    tube([BAR[0], BAR[1], -0.31], [BAR[0], BAR[1], 0.31], 0.013, DARK, seg),
    ...[-1, 1].flatMap((s) => [
      tube([BAR[0], BAR[1], s * 0.19], [BAR[0], BAR[1], s * 0.31], 0.019, BLACK, seg),
      box([BAR[0] + 0.055, BAR[1] - 0.01, s * 0.23], [0.1, 0.012, 0.02], GREY, -0.2),
    ]),
    paint(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10).translate(BAR[0] + 0.01, BAR[1] + 0.025, -0.14), SILVER),
    mudguard(0.12 * Math.PI, 0.55 * Math.PI, b.colour).translate(...FRONT),
    ...wordmarks(brand),
  ];
}

function staticScooter(brand: number): THREE.BufferGeometry {
  const wheels = [REAR, FRONT].flatMap((p) => wheelParts(false).map((g) => g.translate(...p)));
  const stand = tube([-0.05, SCOOTER.deck - 0.08, -0.09], [-0.16, 0.0, -0.21], 0.01, DARK, 5);
  return mergeGeometries([...frameParts(BRANDS[brand], false), ...steeringParts(brand, false), ...wheels, stand]);
}

function atlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = ATLAS;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  BRANDS.forEach((b, i) => {
    ctx.fillStyle = `#${b.stem.toString(16).padStart(6, '0')}`;
    ctx.fillRect(i * COLUMN, 0, COLUMN, ATLAS);
    ctx.save();
    ctx.translate(i * COLUMN + COLUMN / 2, ATLAS / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = b.wordColour;
    ctx.font = `700 ${COLUMN * 0.8}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.word, 0, 1, ATLAS * 0.8);
    ctx.restore();
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface Parked {
  x: number;
  z: number;
  angle: number;
  brand: number;
  roll: number;
  down: boolean;
  taken: boolean;
}

interface Ridden {
  root: THREE.Group;
  steering: THREE.Group;
  front: THREE.Object3D;
  rear: THREE.Object3D;
}

/** Seeded, so every game (and every player) gets the same scooters: groups of 1–5 along the pavements. */
export function scatter(walk: RoadGraph): Parked[] {
  const rand = mulberry32(0x5c007e);
  const pickBrand = () => {
    let r = rand();
    for (let i = 0; i < BRANDS.length; i++) if ((r -= BRANDS[i].share) < 0) return i;
    return 0;
  };
  const out: Parked[] = [];
  for (const e of walk.edges) {
    const sw = e.sw ?? [0, 0];
    const spots: [number, boolean][] = [];
    if (sw[0] === 0 && sw[1] === 0) {
      const across = e.w >= 8;
      if (e.w >= 5) for (const side of [-1, 1]) spots.push([side * (e.w / 2 - (across ? 0.9 : 0.6)), across]);
    } else {
      sw.forEach((o, s) => {
        const room = o - e.w / 2;
        const side = s === 0 ? -1 : 1;
        if (room >= 1.3) spots.push([side * (e.w / 2 + 0.75), true]);
        else if (room >= 0.8) spots.push([side * (e.w / 2 + 0.45), false]);
      });
    }
    if (!spots.length) continue;
    const p = e.p;
    let along = 0, next = 12 + rand() * 30;
    for (let i = 0; i < p.length - 2; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1], len = Math.hypot(dx, dz);
      if (!len) continue;
      const ux = dx / len, uz = dz / len;
      for (; next < along + len; next += 30 + rand() * 30) {
        if (next > e.len - 12) continue;
        const x = p[i] + ux * (next - along), z = p[i + 1] + uz * (next - along);
        if (rand() > 0.12 + 0.4 / (1 + (Math.hypot(x, z) / 1000) ** 2)) continue;
        const [off, across] = spots[Math.floor(rand() * spots.length)];
        const r = rand(), n = r < 0.45 ? 1 : r < 0.7 ? 2 : r < 0.88 ? 3 : r < 0.96 ? 4 : 5;
        const main = pickBrand();
        const cx = x - uz * off, cz = z + ux * off;
        const facing = across ? Math.atan2(-Math.sign(off) * ux, Math.sign(off) * uz) : Math.atan2(uz, ux) + (rand() < 0.5 ? Math.PI : 0);
        const spacing = across ? 0.62 : 1.35;
        for (let k = 0; k < n; k++) {
          const s = (k - (n - 1) / 2) * spacing;
          const down = rand() < 0.05;
          out.push({
            x: cx + ux * s, z: cz + uz * s,
            angle: facing + (rand() - 0.5) * (n === 1 ? 1.2 : 0.25),
            brand: rand() < 0.75 ? main : pickBrand(),
            roll: down ? (rand() < 0.5 ? -FALLEN : FALLEN) : STAND_LEAN, down, taken: false,
          });
        }
      }
      along += len;
    }
  }
  return out;
}

export class Scooters {
  readonly group = new THREE.Group();
  readonly parked: Parked[];
  private grid = new Map<string, Parked[]>();
  private still: THREE.InstancedMesh[];
  private shown: number[];
  private ridden: Ridden[];
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas(), roughness: 0.55, metalness: 0.1 });
  private falling: { p: Parked; t: number; from: number; to: number }[] = [];
  private timer = 0;
  private clock = 0;
  private matrix = new THREE.Matrix4();

  constructor(walk: RoadGraph, private crowd: Crowd, private view = 130, physics?: Physics) {
    this.group.name = 'scooters';
    this.parked = scatter(walk).filter((p) => !physics || !blocked(physics, p));
    for (const p of this.parked) this.cell(p.x, p.z, true)!.push(p);
    this.still = BRANDS.map((_, i) => {
      const mesh = new THREE.InstancedMesh(staticScooter(i), this.material, 300);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    });
    this.shown = BRANDS.map(() => 0);
    this.ridden = BRANDS.map((_, i) => this.buildRidden(i));
  }

  private buildRidden(brand: number): Ridden {
    const b = BRANDS[brand];
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.visible = false;
    const mesh = (parts: THREE.BufferGeometry[]) => {
      const m = new THREE.Mesh(mergeGeometries(parts), this.material);
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    const steering = new THREE.Group();
    steering.position.set(...HEAD);
    const steer = mesh(steeringParts(brand, true));
    steer.position.set(-HEAD[0], -HEAD[1], 0);
    const front = mesh(wheelParts(true));
    front.position.set(FRONT[0] - HEAD[0], FRONT[1] - HEAD[1], 0);
    steering.add(steer, front);
    const rear = mesh(wheelParts(true));
    rear.position.set(...REAR);
    root.add(mesh(frameParts(b, true)), steering, rear);
    this.group.add(root);
    return { root, steering, front, rear };
  }

  private cell(x: number, z: number, make = false): Parked[] | undefined {
    const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
    let list = this.grid.get(key);
    if (!list && make) this.grid.set(key, (list = []));
    return list;
  }

  private *nearby(x: number, z: number): Generator<Parked> {
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) yield* this.grid.get(`${i},${j}`) ?? [];
  }

  nearest(x: number, z: number, range = 1.4): Parked | null {
    return closest(this.nearby(x, z), x, z, range);
  }

  take(p: Parked): { x: number; z: number; heading: number; colour: number } {
    const list = this.cell(p.x, p.z);
    list?.splice(list.indexOf(p), 1);
    p.taken = true;
    this.falling = this.falling.filter((f) => f.p !== p);
    this.timer = 0;
    return { x: p.x, z: p.z, heading: p.angle, colour: BRANDS[p.brand].colour };
  }

  /** Another player took the one of this colour at (x, z); false if it isn't here. */
  takeAt(x: number, z: number, colour: number): boolean {
    const p = [...this.nearby(x, z)].find((p) => BRANDS[p.brand].colour === colour && Math.hypot(p.x - x, p.z - z) < 0.5);
    if (p) this.take(p);
    return !!p;
  }

  knock(v: Vehicle): number {
    const vel = v.body.linvel(), speed = Math.hypot(vel.x, vel.y);
    if (speed < 1) return 0;
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    const hl = v.spec.length / 2 + 0.35, hw = v.spec.width / 2 + 0.3;
    let n = 0;
    for (const p of [...this.nearby(v.x, v.z)]) {
      if (p.down) continue;
      const dx = p.x - v.x, dz = p.z - v.z;
      if (Math.abs(dx * c + dz * s) > hl || Math.abs(-dx * s + dz * c) > hw) continue;
      const right = -Math.sin(p.angle) * vel.x + Math.cos(p.angle) * vel.y;
      const shove = Math.min(speed * 0.12, 1.5) / speed;
      const list = this.cell(p.x, p.z)!;
      list.splice(list.indexOf(p), 1);
      p.x += vel.x * shove;
      p.z += vel.y * shove;
      this.cell(p.x, p.z, true)!.push(p);
      p.angle += (Math.random() - 0.5) * 0.8;
      p.down = true;
      this.falling.push({ p, t: 0, from: p.roll, to: right >= 0 ? FALLEN : -FALLEN });
      n++;
    }
    return n;
  }

  update(camera: THREE.Vector3, vehicles: Vehicle[], riding: Vehicle | null, avatar: number, alpha: number, dt: number) {
    this.clock += dt;
    for (const f of this.falling) {
      f.t = Math.min(1, f.t + dt * 2.8);
      f.p.roll = f.from + (f.to - f.from) * f.t * f.t;
    }
    if (this.falling.length) this.timer = 0;
    this.falling = this.falling.filter((f) => f.t < 1);
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.3;
      this.shown.fill(0);
      const r = Math.ceil(this.view / CELL);
      const gx = Math.floor(camera.x / CELL), gz = Math.floor(camera.z / CELL);
      for (let i = gx - r; i <= gx + r; i++) {
        for (let j = gz - r; j <= gz + r; j++) {
          for (const p of this.grid.get(`${i},${j}`) ?? []) {
            if (this.shown[p.brand] >= this.still[p.brand].instanceMatrix.count - 20) continue;
            if (Math.hypot(p.x - camera.x, p.z - camera.z) > this.view) continue;
            const lift = Math.max(0, Math.abs(p.roll) - 0.5) * 0.075;
            this.still[p.brand].setMatrixAt(this.shown[p.brand]++, pose(this.matrix, p.x, lift, p.z, p.angle, p.roll));
          }
        }
      }
    }
    const n = [...this.shown];
    for (const v of vehicles) {
      if (v.spec.name !== 'scooter' || v === riding) continue;
      const b = brandOf(v.colour);
      if (n[b] >= this.still[b].instanceMatrix.count || Math.hypot(v.x - camera.x, v.z - camera.z) > this.view) continue;
      this.still[b].setMatrixAt(n[b]++, ridePose(this.matrix, v, alpha, v.remote ? v.roll : STAND_LEAN));
    }
    this.still.forEach((mesh, b) => {
      mesh.count = n[b];
      uploadFirst(mesh.instanceMatrix, n[b]);
    });

    const brand = riding ? brandOf(riding.colour) : -1;
    this.ridden.forEach((r, b) => (r.root.visible = b === brand));
    if (!riding) return;
    const s = this.ridden[brand];
    const m = ridePose(this.matrix, riding, alpha, riding.roll);
    s.root.matrix.copy(m);
    s.root.matrixWorldNeedsUpdate = true;
    const speed01 = Math.min(Math.abs(riding.forwardSpeed) / riding.spec.maxSpeed, 1);
    s.steering.quaternion.setFromAxisAngle(STEER_AXIS, -riding.steerSmoothed * (0.45 - 0.3 * speed01));
    s.front.rotation.z = s.rear.rotation.z = -riding.wheelSpin;
    const sway = this.crowd.clip(avatar, 'scoot');
    this.crowd.add(avatar, m, 'scoot', sway ? this.clock / sway.duration : 0, Math.hypot(m.elements[12] - camera.x, m.elements[14] - camera.z));
  }
}

function blocked(physics: Physics, p: Parked): boolean {
  let hit = false;
  physics.world.intersectionsWithShape(
    { x: p.x, y: p.z },
    p.angle,
    new RAPIER.Cuboid(0.6, 0.32),
    () => ((hit = true), false),
    RAPIER.QueryFilterFlags.EXCLUDE_SENSORS | RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC,
    groups(GROUP.BIKE, GROUP.STATIC),
  );
  return hit;
}
