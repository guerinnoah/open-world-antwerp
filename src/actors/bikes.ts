import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uploadFirst } from '../core/instancing';
import { coloured, stableRandom } from '../core/util';
import type { CityData } from '../world/cityData';
import { BIKE } from './bikeGeometry';
import type { Crowd } from './crowd';
import { block, closest, pose, ridePose, rod, type V3 } from './twoWheelers';
import type { Vehicle } from './vehicle';

const RED = 0xc8102e, DARK = 0x2a2b2e, BLACK = 0x151515, SILVER = 0xb9bdc1, LIGHT = 0xfff4d8, REAR_LIGHT = 0xff2a1a;

const tube = (a: V3, b: V3, r: number, hex: number, seg: number) => coloured(rod(a, b, r, seg), hex);
const box = (c: V3, size: V3, hex: number, rz = 0) => coloured(block(c, size, rz), hex);

const R = BIKE.wheelRadius;
const BB: V3 = [BIKE.bb[0], BIKE.bb[1], 0];
const REAR: V3 = [BIKE.rearX, R, 0], FRONT: V3 = [BIKE.frontX, R, 0];
const HEAD_TOP: V3 = [0.36, 0.86, 0], HEAD_BOTTOM: V3 = [0.42, 0.66, 0];
const STEER_AXIS = new THREE.Vector3(HEAD_TOP[0] - HEAD_BOTTOM[0], HEAD_TOP[1] - HEAD_BOTTOM[1], 0).normalize();
const SEAT = new THREE.Vector2(...BIKE.seatTube).normalize();
const along = (from: V3, t: number): V3 => [from[0] + SEAT.x * t, from[1] + SEAT.y * t, 0];
const SEAT_TOP = along(BB, 0.5);
const SADDLE = 0.92;
const STAND_LEAN = 0.1;

export const VELO_RED = RED;
/** Other colours are private bikes (cyclists.ts draws them). */
export const isVelo = (v: Vehicle) => v.colour === VELO_RED;

function wheelParts(near: boolean): THREE.BufferGeometry[] {
  const parts = [
    coloured(new THREE.TorusGeometry(R - 0.022, 0.022, near ? 6 : 4, near ? 24 : 14), BLACK),
    coloured(new THREE.TorusGeometry(R - 0.048, 0.01, 4, near ? 24 : 14), SILVER),
    coloured(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8).rotateX(Math.PI / 2), DARK),
  ];
  if (near) for (let k = 0; k < 8; k++) parts.push(coloured(new THREE.BoxGeometry(0.004, 2 * (R - 0.055), 0.004).rotateZ((k * Math.PI) / 8), SILVER));
  return parts;
}

function mudguard(start: number, arc: number): THREE.BufferGeometry {
  return coloured(new THREE.TorusGeometry(R + 0.03, 0.014, 3, 12, arc).scale(1, 1, 3.2).rotateZ(start), DARK);
}

function crankParts(): THREE.BufferGeometry[] {
  const c = BIKE.crank;
  return [
    coloured(new THREE.CylinderGeometry(0.09, 0.09, 0.008, 16).rotateX(Math.PI / 2).translate(0, 0, 0.05), DARK),
    box([0, c / 2, 0.075], [0.03, c, 0.012], SILVER),
    box([0, -c / 2, -0.075], [0.03, c, 0.012], SILVER),
    box([0, c, BIKE.pedalZ], [0.09, 0.025, 0.09], BLACK),
    box([0, -c, -BIKE.pedalZ], [0.09, 0.025, 0.09], BLACK),
  ];
}

function frameParts(near: boolean, saddle: number): THREE.BufferGeometry[] {
  const seg = near ? 8 : 5;
  const low: V3 = [0.12, 0.38, 0];
  const post = along(BB, (saddle - 0.05 - BB[1]) / SEAT.y);
  return [
    tube(BB, low, 0.024, RED, seg), tube(low, HEAD_BOTTOM, 0.024, RED, seg), tube(BB, SEAT_TOP, 0.02, RED, seg),
    tube(HEAD_BOTTOM, HEAD_TOP, 0.026, RED, seg),
    ...[-1, 1].flatMap((s) => [
      tube(BB, [REAR[0], REAR[1], s * 0.05], 0.011, RED, seg), tube(SEAT_TOP, [REAR[0], REAR[1], s * 0.05], 0.01, RED, seg),
    ]),
    box([(BB[0] + REAR[0]) / 2, (BB[1] + REAR[1]) / 2 + 0.01, 0.075], [0.66, 0.1, 0.02], RED, Math.atan2(REAR[1] - BB[1], REAR[0] - BB[0]) + Math.PI),
    mudguard(0.4 * Math.PI, 0.8 * Math.PI).translate(...REAR),
    box([REAR[0] - 0.36, 0.57, 0], [0.03, 0.05, 0.05], REAR_LIGHT),
    tube(SEAT_TOP, post, 0.014, SILVER, seg),
    box([post[0] - 0.02, post[1] + 0.03, 0], [0.27, 0.06, 0.17], BLACK),
    box([0.56, 0.84, 0], [0.36, 0.025, 0.3], BLACK),
    tube([0.4, 0.78, 0], [0.5, 0.835, 0], 0.012, BLACK, seg),
    box([0.75, 0.76, 0], [0.02, 0.15, 0.28], RED),
    box([0.735, 0.79, 0], [0.012, 0.06, 0.22], 0xf4f4f2),
  ];
}

function steeringParts(near: boolean): THREE.BufferGeometry[] {
  const seg = near ? 8 : 5;
  const stem: V3 = [0.33, 1.0, 0];
  const [gx, gy, gz] = BIKE.grip;
  return [
    ...[-1, 1].map((s) => tube(HEAD_BOTTOM, [FRONT[0], FRONT[1], s * 0.055], 0.013, RED, seg)),
    box([HEAD_BOTTOM[0], HEAD_BOTTOM[1] - 0.02, 0], [0.05, 0.04, 0.13], RED),
    tube(HEAD_TOP, stem, 0.014, SILVER, seg),
    ...[-1, 1].flatMap((s) => [
      tube(stem, [0.31, 1.0, s * 0.16], 0.011, BLACK, seg), tube([0.31, 1.0, s * 0.16], [gx + 0.03, gy - 0.005, s * (gz - 0.04)], 0.011, BLACK, seg),
      tube([gx + 0.03, gy - 0.005, s * (gz - 0.04)], [gx - 0.03, gy + 0.005, s * (gz + 0.05)], 0.017, BLACK, seg),
    ]),
    mudguard(0.15 * Math.PI, 0.72 * Math.PI).translate(...FRONT),
    box([HEAD_TOP[0] + 0.07, 0.8, 0], [0.05, 0.05, 0.06], LIGHT),
  ];
}

function staticBike(saddle: number): THREE.BufferGeometry {
  const wheels = [REAR, FRONT].flatMap((p) => wheelParts(false).map((g) => g.translate(...p)));
  const crank = crankParts().map((g) => g.rotateZ(-0.5).translate(...BB));
  const stand = tube([BB[0] - 0.08, 0.27, -0.06], [BB[0] - 0.2, 0.0, -0.24], 0.01, BLACK, 5);
  return mergeGeometries([...frameParts(false, saddle), ...steeringParts(false), ...wheels, ...crank, stand]);
}

interface Dock {
  x: number;
  z: number;
  angle: number;
  bike: boolean;
}

interface Ridden {
  root: THREE.Group;
  steering: THREE.Group;
  front: THREE.Object3D;
  rear: THREE.Object3D;
  crank: THREE.Object3D;
  frame: THREE.Mesh;
  saddle: number;
}

export class Bikes {
  readonly group = new THREE.Group();
  private docks: Dock[] = [];
  private grid = new Map<string, Dock[]>();
  private still: THREE.InstancedMesh;
  private ridden: Ridden;
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 });
  private docked = 0;
  private timer = 0;
  private matrix = new THREE.Matrix4();

  constructor(city: CityData, private crowd: Crowd, private view = 130) {
    this.group.name = 'bikes';
    // same docks as world/props.ts
    const velo = city.velo ?? [];
    for (let i = 0; i < velo.length; i += 4) {
      const [x, z, angle, docks] = velo.slice(i, i + 4);
      const ux = Math.cos(angle), uz = Math.sin(angle);
      for (let k = 0; k < docks; k++) {
        const s = (k - (docks - 1) / 2) * 0.75;
        const d = { x: x + ux * s, z: z + uz * s, angle, bike: false };
        d.bike = stableRandom(d.x, d.z) < 0.65; // ~2 in 3; seeded so every player sees the same
        this.docks.push(d);
        const key = `${Math.floor(d.x / 40)},${Math.floor(d.z / 40)}`;
        this.grid.set(key, [...(this.grid.get(key) ?? []), d]);
      }
    }
    this.still = new THREE.InstancedMesh(staticBike(SADDLE), this.material, 600);
    this.still.count = 0;
    this.still.frustumCulled = false;
    this.still.receiveShadow = true;
    this.group.add(this.still);
    this.ridden = this.buildRidden();
    this.group.add(this.ridden.root);
  }

  private buildRidden(): Ridden {
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    root.visible = false;
    const mesh = (parts: THREE.BufferGeometry[]) => {
      const m = new THREE.Mesh(mergeGeometries(parts), this.material);
      m.castShadow = m.receiveShadow = true;
      return m;
    };
    const frame = mesh(frameParts(true, SADDLE));
    const steering = new THREE.Group();
    steering.position.set(...HEAD_BOTTOM);
    const steer = mesh(steeringParts(true));
    steer.position.set(-HEAD_BOTTOM[0], -HEAD_BOTTOM[1], 0);
    const front = mesh(wheelParts(true));
    front.position.set(FRONT[0] - HEAD_BOTTOM[0], FRONT[1] - HEAD_BOTTOM[1], 0);
    steering.add(steer, front);
    const rear = mesh(wheelParts(true));
    rear.position.set(...REAR);
    const crank = mesh(crankParts());
    crank.position.set(...BB);
    root.add(frame, steering, rear, crank);
    return { root, steering, front, rear, crank, frame, saddle: SADDLE };
  }

  dockedNear(x: number, z: number, range = 1.4): Dock | null {
    return closest(this.nearby(x, z).filter((d) => d.bike), x, z, range);
  }

  emptyDockNear(x: number, z: number, range = 2.2): Dock | null {
    return closest(this.nearby(x, z).filter((d) => !d.bike), x, z, range);
  }

  take(d: Dock): { x: number; z: number; heading: number } {
    d.bike = false;
    this.timer = 0;
    return { x: d.x, z: d.z, heading: d.angle + Math.PI / 2 };
  }

  dock(d: Dock) {
    d.bike = true;
    this.timer = 0;
  }

  clearDocks(x: number, z: number, radius: number): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const d of this.nearby(x, z)) {
      if (!d.bike || Math.hypot(d.x - x, d.z - z) > radius) continue;
      d.bike = false;
      const mesh = new THREE.InstancedMesh(this.still.geometry, this.material, 1);
      mesh.position.set(d.x, 0, d.z);
      mesh.rotation.y = -(d.angle - Math.PI / 2);
      mesh.castShadow = true;
      out.push(mesh);
    }
    if (out.length) this.timer = 0;
    return out;
  }

  private nearby(x: number, z: number): Dock[] {
    const out: Dock[] = [];
    const gx = Math.floor(x / 40), gz = Math.floor(z / 40);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) out.push(...(this.grid.get(`${i},${j}`) ?? []));
    return out;
  }

  update(camera: THREE.Vector3, vehicles: Vehicle[], riding: Vehicle | null, avatar: number, alpha: number, dt: number) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.3;
      this.docked = 0;
      const r = Math.ceil(this.view / 40);
      const gx = Math.floor(camera.x / 40), gz = Math.floor(camera.z / 40);
      for (let i = gx - r; i <= gx + r; i++) {
        for (let j = gz - r; j <= gz + r; j++) {
          for (const d of this.grid.get(`${i},${j}`) ?? []) {
            if (!d.bike || this.docked >= this.still.instanceMatrix.count - 40) continue;
            if (Math.hypot(d.x - camera.x, d.z - camera.z) > this.view) continue;
            this.still.setMatrixAt(this.docked++, pose(this.matrix, d.x, 0, d.z, d.angle - Math.PI / 2, 0));
          }
        }
      }
    }
    let n = this.docked;
    for (const v of vehicles) {
      if (v.spec.name !== 'bike' || !isVelo(v) || v === riding || n >= this.still.instanceMatrix.count) continue;
      if (Math.hypot(v.x - camera.x, v.z - camera.z) > this.view) continue;
      this.still.setMatrixAt(n++, ridePose(this.matrix, v, alpha, v.remote ? v.roll : STAND_LEAN));
    }
    this.still.count = n;
    uploadFirst(this.still.instanceMatrix, n);

    const b = this.ridden;
    b.root.visible = !!riding;
    if (!riding) return;
    const saddle = this.crowd.saddle(avatar);
    if (Math.abs(saddle - b.saddle) > 0.005) {
      b.frame.geometry.dispose();
      b.frame.geometry = mergeGeometries(frameParts(true, saddle));
      b.saddle = saddle;
    }
    const m = ridePose(this.matrix, riding, alpha, riding.roll);
    b.root.matrix.copy(m);
    b.root.matrixWorldNeedsUpdate = true;
    const speed01 = Math.min(Math.abs(riding.forwardSpeed) / riding.spec.maxSpeed, 1);
    b.steering.quaternion.setFromAxisAngle(STEER_AXIS, -riding.steerSmoothed * (0.5 - 0.35 * speed01));
    b.front.rotation.z = b.rear.rotation.z = -riding.wheelSpin;
    b.crank.rotation.z = -riding.pedals * Math.PI * 2;
    this.crowd.add(avatar, m, 'ride', riding.pedals, Math.hypot(m.elements[12] - camera.x, m.elements[14] - camera.z));
  }
}
