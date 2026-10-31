import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uploadFirst } from '../core/instancing';
import { coloured } from '../core/util';
import type { Clip, Crowd } from './crowd';
import { MOPED, MOTORBIKE, type RideGeometry } from './motorbikeGeometry';
import { block, ridePose, rod, type V3 } from './twoWheelers';
import type { Vehicle } from './vehicle';

const BLACK = 0x141414, DARK = 0x2b2d30, GREY = 0x5d6166, SILVER = 0xb9bdc1, CHROME = 0xd8dcdf, LIGHT = 0xfff4d8;
const RED_LIGHT = 0xc81a14, PLATE = 0xf2f2f0, SEAT = 0x1c1a19, TYRE = 0x161616;
const MOPED_PAINTS = [0xa8d5c2, 0xe9dfc4, 0xb3202a, 0x8fb8d8, 0xf1f0ea, 0x2f3e46, 0xd9a441, 0x6e8b5e];

interface Type {
  geo: RideGeometry;
  clip: Clip;
  parkedRoll: number; // rad, + = right; 0 on a centre stand
  parkedSteer: number;
  lock: [number, number]; // rad at full lock: [standstill, top speed]
}

const TYPES: Type[] = [
  { geo: MOTORBIKE, clip: 'moto', parkedRoll: -0.14, parkedSteer: 0.5, lock: [0.5, 0.06] },
  { geo: MOPED, clip: 'moped', parkedRoll: 0, parkedSteer: 0, lock: [0.55, 0.12] },
];
const typeOf = (v: Vehicle) => (v.spec.name === 'moped' ? 1 : 0);

/** From the car paint, so every game agrees. */
const mopedPaint = (colour: number) => MOPED_PAINTS[(colour ^ (colour >>> 9)) % MOPED_PAINTS.length];

/** 'paint' parts take instanceColor, so paint and trim share one mesh. */
function part(g: THREE.BufferGeometry, hex: number, paint = false): THREE.BufferGeometry {
  const geo = coloured(g, hex);
  geo.setAttribute('paint', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count).fill(paint ? 1 : 0), 1));
  return geo;
}

const tube = (a: V3, b: V3, r: number, hex: number, paint = false, seg = 8) => part(rod(a, b, r, seg), hex, paint);
const box = (c: V3, size: V3, hex: number, paint = false, rz = 0) => part(block(c, size, rz), hex, paint);

function blob(c: V3, r: V3, hex: number, paint = false): THREE.BufferGeometry {
  return part(new THREE.SphereGeometry(1, 14, 9).scale(...r).translate(...c), hex, paint);
}

function lamp(c: V3, r: number, depth: number, hex: number): THREE.BufferGeometry {
  return part(new THREE.CylinderGeometry(r, r, depth, 14).rotateZ(Math.PI / 2).translate(...c), hex);
}

function mudguard(at: V3, R: number, start: number, arc: number, width: number, hex: number, paint: boolean): THREE.BufferGeometry {
  return part(new THREE.TorusGeometry(R + 0.03, 0.016, 3, 14, arc).scale(1, 1, width / 0.032).rotateZ(start).translate(...at), hex, paint);
}

function wheel(g: RideGeometry, spokes: boolean): THREE.BufferGeometry {
  const R = g.wheelRadius, tyre = R * 0.16;
  const parts = [
    part(new THREE.TorusGeometry(R - tyre, tyre, 8, 24), TYRE),
    part(new THREE.TorusGeometry(R - tyre * 2, 0.012, 4, 24), DARK),
    part(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 10).rotateX(Math.PI / 2), SILVER),
    part(new THREE.CylinderGeometry(R * 0.5, R * 0.5, 0.008, 18).rotateX(Math.PI / 2).translate(0, 0, 0.075), SILVER),
  ];
  if (spokes) for (let k = 0; k < 6; k++) parts.push(part(new THREE.BoxGeometry(0.03, R - tyre * 2, 0.02).translate(0, (R - tyre * 2) / 2, 0).rotateZ((k * Math.PI) / 3), DARK));
  else parts.push(part(new THREE.CylinderGeometry(R - tyre * 2, R - tyre * 2, 0.06, 18).rotateX(Math.PI / 2), GREY));
  return mergeGeometries(parts);
}

function axis(g: RideGeometry, y: number): V3 {
  const t = (y - g.head[1]) / (g.bars[1] - g.head[1]);
  return [g.head[0] + (g.bars[0] - g.head[0]) * t, y, 0];
}

function motorbikeBody(): THREE.BufferGeometry {
  const g = MOTORBIKE, R = g.wheelRadius;
  const top = axis(g, 0.98), bottom = axis(g, 0.76);
  const pivot: V3 = [-0.15, 0.5, 0];
  return mergeGeometries([
    tube(bottom, top, 0.035, DARK),
    ...[-1, 1].flatMap((s) => [
      tube([top[0] - 0.02, 0.9, s * 0.07], [pivot[0], 0.62, s * 0.13], 0.026, DARK),
      tube([pivot[0], pivot[1], s * 0.12], [g.rearX, R, s * 0.1], 0.03, GREY),
    ]),
    box([0.08, 0.46, 0], [0.42, 0.32, 0.3], DARK),
    box([0.22, 0.67, 0], [0.22, 0.12, 0.3], GREY, false, -0.35),
    part(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 14).rotateX(Math.PI / 2).translate(0, 0.42, -0.16), SILVER),
    box([0.39, 0.62, 0], [0.05, 0.28, 0.34], BLACK),
    tube([0.3, 0.62, 0.06], [0.3, 0.26, 0.1], 0.022, CHROME),
    tube([0.3, 0.26, 0.1], [-0.05, 0.2, 0.13], 0.025, CHROME),
    tube([-0.05, 0.2, 0.15], [-0.32, 0.3, 0.17], 0.075, BLACK, false, 12),
    tube([-0.06, 0.38, -0.11], [g.rearX, R, -0.11], 0.012, BLACK, false, 5),
    blob([0.17, 0.93, 0], [0.26, 0.12, 0.17], 0, true),
    ...[-1, 1].map((s) => box([0.33, 0.82, s * 0.15], [0.22, 0.18, 0.03], 0, true, 0.35)),
    box([-0.33, 0.84, 0], [0.5, 0.07, 0.26], SEAT),
    box([-0.62, 0.91, 0], [0.2, 0.06, 0.2], SEAT, false, 0.25),
    box([-0.73, 0.89, 0], [0.26, 0.08, 0.16], 0, true, 0.2),
    box([-0.86, 0.93, 0], [0.03, 0.04, 0.12], RED_LIGHT),
    tube([-0.8, 0.85, 0], [-0.92, 0.66, 0], 0.012, BLACK, false, 5),
    box([-0.93, 0.6, 0], [0.01, 0.12, 0.2], PLATE, false, 0.3),
    tube([-0.15, 0.66, 0], [-0.33, 0.44, 0], 0.03, 0xb8261c),
    ...[-1, 1].map((s) => tube([g.feet[0], g.feet[1], s * 0.12], [g.feet[0], g.feet[1], s * 0.24], 0.012, SILVER, false, 5)),
  ]);
}

function motorbikeSteering(): THREE.BufferGeometry {
  const g = MOTORBIKE, [gx, gy, gz] = g.grip;
  const front: V3 = [g.frontX, g.wheelRadius, 0];
  return mergeGeometries([
    ...[-1, 1].flatMap((s) => [
      tube([0.5, 0.98, s * 0.1], [0.66, 0.5, s * 0.1], 0.022, SILVER),
      tube([0.66, 0.5, s * 0.1], [front[0] + 0.01, front[1], s * 0.1], 0.03, BLACK),
      tube([g.bars[0], g.bars[1], s * 0.1], [gx + 0.02, gy, s * (gz - 0.08)], 0.014, BLACK),
      tube([gx + 0.02, gy, s * (gz - 0.07)], [gx - 0.01, gy + 0.005, s * (gz + 0.06)], 0.019, BLACK),
      box([gx + 0.07, gy - 0.01, s * (gz - 0.02)], [0.1, 0.012, 0.02], SILVER, false, -0.2),
      tube([gx + 0.02, gy + 0.02, s * (gz - 0.1)], [gx + 0.05, gy + 0.2, s * (gz - 0.06)], 0.007, BLACK, false, 5),
      part(new THREE.CylinderGeometry(0.045, 0.045, 0.015, 10).rotateZ(Math.PI / 2).translate(gx + 0.05, gy + 0.21, s * (gz - 0.06)), BLACK),
    ]),
    box([0.47, 1.0, 0], [0.1, 0.03, 0.26], SILVER, false, 0.42),
    box([0.47, 1.07, 0], [0.06, 0.05, 0.12], BLACK),
    lamp([0.6, 0.9, 0], 0.09, 0.09, BLACK),
    lamp([0.645, 0.9, 0], 0.075, 0.01, LIGHT),
    mudguard(front, g.wheelRadius, 0.2 * Math.PI, 0.55 * Math.PI, 0.13, 0, true),
  ]);
}

function mopedBody(): THREE.BufferGeometry {
  const g = MOPED;
  return mergeGeometries([
    blob([-0.42, 0.52, 0], [0.38, 0.24, 0.27], 0, true),
    box([-0.05, 0.36, 0], [0.42, 0.16, 0.2], 0, true),
    box([0.13, 0.27, 0], [0.6, 0.05, 0.34], BLACK),
    ...[-1, 1].map((s) => box([0.13, 0.3, s * 0.15], [0.56, 0.012, 0.012], CHROME)),
    box([0.49, 0.63, 0], [0.05, 0.72, 0.42], 0, true, 0.22),
    box([0.53, 0.86, 0], [0.04, 0.12, 0.08], CHROME, false, 0.22),
    box([-0.42, 0.81, 0], [0.62, 0.09, 0.28], SEAT),
    tube([-0.72, 0.86, -0.12], [-0.86, 0.86, -0.12], 0.01, CHROME, false, 5),
    tube([-0.72, 0.86, 0.12], [-0.86, 0.86, 0.12], 0.01, CHROME, false, 5),
    tube([-0.86, 0.86, -0.12], [-0.86, 0.86, 0.12], 0.01, CHROME, false, 5),
    box([-0.82, 0.68, 0], [0.04, 0.06, 0.12], RED_LIGHT, false, -0.4),
    box([-0.86, 0.55, 0], [0.01, 0.12, 0.17], PLATE, false, 0.2),
    tube([-0.3, 0.24, 0.17], [-0.62, 0.3, 0.19], 0.05, DARK, false, 10),
    tube([-0.2, 0.26, -0.08], [g.rearX, g.wheelRadius, -0.08], 0.04, DARK),
  ]);
}

function mopedSteering(): THREE.BufferGeometry {
  const g = MOPED, [gx, gy, gz] = g.grip;
  const front: V3 = [g.frontX, g.wheelRadius, 0];
  return mergeGeometries([
    tube(axis(g, 0.42), axis(g, 0.98), 0.03, DARK),
    blob([0.47, 1.01, 0], [0.12, 0.07, 0.15], 0, true),
    lamp([0.585, 1.01, 0], 0.055, 0.02, LIGHT),
    ...[-1, 1].flatMap((s) => [
      tube([gx + 0.01, gy, s * 0.14], [gx - 0.01, gy + 0.005, s * (gz + 0.06)], 0.018, BLACK),
      box([gx + 0.06, gy - 0.005, s * (gz - 0.03)], [0.09, 0.012, 0.02], SILVER, false, -0.15),
      tube([gx + 0.02, gy + 0.02, s * 0.2], [gx + 0.02, gy + 0.2, s * 0.26], 0.007, CHROME, false, 5),
      part(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 12).rotateZ(Math.PI / 2).translate(gx + 0.02, gy + 0.21, s * 0.26), CHROME),
    ]),
    tube([g.head[0], g.head[1], -0.08], [front[0], front[1], -0.08], 0.03, DARK),
    mudguard(front, g.wheelRadius, 0.05 * Math.PI, 0.7 * Math.PI, 0.17, 0, true),
  ]);
}

function paintMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.35 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint;')
      .replace('#include <color_vertex>', 'vColor = vec4(1.0);\nvColor.rgb *= mix(color.rgb, instanceColor.rgb, paint);');
  };
  m.customProgramCacheKey = () => 'motorbike-paint';
  return m;
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number, painted: boolean): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  if (painted) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

interface Meshes {
  body: THREE.InstancedMesh;
  steering: THREE.InstancedMesh;
  wheels: THREE.InstancedMesh;
  head: THREE.Vector3;
  axis: THREE.Vector3;
}

export class Motorbikes {
  readonly group = new THREE.Group();
  private meshes: Meshes[];
  private stands: THREE.InstancedMesh;
  private riders = new WeakMap<Vehicle, number>();
  private clock = 0;
  private matrix = new THREE.Matrix4();
  private steer = new THREE.Matrix4();
  private part = new THREE.Matrix4();
  private wheel = new THREE.Matrix4();
  private out = new THREE.Matrix4();
  private colour = new THREE.Color();

  constructor(private crowd: Crowd, private view = 300, capacity = 120) {
    this.group.name = 'motorbikes';
    const paint = paintMaterial();
    const trim = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.4 });
    const models = [[motorbikeBody(), motorbikeSteering(), wheel(MOTORBIKE, true)], [mopedBody(), mopedSteering(), wheel(MOPED, false)]];
    this.meshes = TYPES.map((t, i) => {
      const [body, steering, wheels] = models[i];
      const m = {
        body: instanced(body, paint, capacity, true),
        steering: instanced(steering, paint, capacity, true),
        wheels: instanced(wheels, trim, capacity * 2, false),
        head: new THREE.Vector3(t.geo.head[0], t.geo.head[1], 0),
        axis: new THREE.Vector3(t.geo.bars[0] - t.geo.head[0], t.geo.bars[1] - t.geo.head[1], 0).normalize(),
      };
      this.group.add(m.body, m.steering, m.wheels);
      return m;
    });
    this.stands = instanced(tube([-0.12, 0.34, -0.14], [-0.24, 0.01, -0.32], 0.013, BLACK, false, 6), trim, capacity, false);
    this.group.add(this.stands);
  }

  update(camera: THREE.Vector3, vehicles: Vehicle[], riding: Vehicle | null, avatar: number, alpha: number, dt: number) {
    this.clock += dt;
    const counts = TYPES.map(() => 0);
    let stands = 0;
    for (const v of vehicles) {
      if (v.spec.name !== 'motorbike' && v.spec.name !== 'moped') continue;
      const distance = Math.hypot(v.x - camera.x, v.z - camera.z);
      if (distance > this.view) continue;
      const k = typeOf(v), t = TYPES[k], m = this.meshes[k], g = t.geo;
      const i = counts[k];
      if (i >= m.body.instanceMatrix.count) continue;
      counts[k]++;
      const moving = v.driven || v.remote;
      const M = ridePose(this.matrix, v, alpha, moving ? v.roll : t.parkedRoll);
      m.body.setMatrixAt(i, M);
      m.body.setColorAt(i, this.colour.setHex(k === 1 ? mopedPaint(v.colour) : v.colour));
      const speed01 = Math.min(Math.abs(v.forwardSpeed) / v.spec.maxSpeed, 1);
      const angle = moving ? -v.steerSmoothed * (t.lock[0] + (t.lock[1] - t.lock[0]) * speed01) : t.parkedSteer;
      this.steer.makeTranslation(m.head).multiply(this.part.makeRotationAxis(m.axis, angle)).multiply(this.part.makeTranslation(-m.head.x, -m.head.y, 0));
      this.steer.premultiply(M);
      m.steering.setMatrixAt(i, this.steer);
      m.steering.setColorAt(i, this.colour);
      const spin = this.part.makeRotationZ(-v.wheelSpin);
      this.wheel.makeTranslation(g.frontX, g.wheelRadius, 0).multiply(spin);
      m.wheels.setMatrixAt(i * 2, this.out.multiplyMatrices(this.steer, this.wheel));
      this.wheel.makeTranslation(g.rearX, g.wheelRadius, 0).multiply(spin);
      m.wheels.setMatrixAt(i * 2 + 1, this.out.multiplyMatrices(M, this.wheel));
      if (!moving && t.parkedRoll && stands < this.stands.instanceMatrix.count) this.stands.setMatrixAt(stands++, M);
      if (v.driven && !v.remote) {
        let who = v === riding ? avatar : this.riders.get(v);
        if (who === undefined) this.riders.set(v, (who = this.crowd.pick()));
        const sway = this.crowd.clip(who, t.clip);
        this.crowd.add(who, M, t.clip, sway ? this.clock / sway.duration : 0, distance);
      }
    }
    this.meshes.forEach((m, k) => {
      for (const mesh of [m.body, m.steering, m.wheels]) {
        const n = mesh === m.wheels ? counts[k] * 2 : counts[k];
        mesh.count = n;
        mesh.visible = n > 0;
        uploadFirst(mesh.instanceMatrix, n);
        uploadFirst(mesh.instanceColor, n);
      }
    });
    this.stands.count = stands;
    this.stands.visible = stands > 0;
    uploadFirst(this.stands.instanceMatrix, stands);
  }
}

export const riderClip = (v: Vehicle): Clip => TYPES[typeOf(v)].clip;
