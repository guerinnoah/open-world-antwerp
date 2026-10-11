import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uploadFirst } from '../core/instancing';
import { coloured, wrapAngle } from '../core/util';
import { WHEEL_RADIUS, type Vehicle } from './vehicle';

const GLASS = 0x0e1216, BLACK = 0x18191b, CHROME = 0xc7cbcf, HEADLIGHT = 0xdfe6ea, TAIL = 0x7a0b10, AMBER = 0xc77a12;
const PLATE = 0xf2f2f0, PLATE_TEXT = 0x8c1c24; // Belgian plates: red letters on white
const TYRE = 0x1b1b1c, RIM = 0xb9bdc2;

type Pt = [number, number];

interface Profile {
  length: number;
  width: number;
  axles: [number, number];
  wheelRadius: number;
  sill: number;
  belt: number;
  roof: number;
  top: Pt[];
  windows: Pt[];
  pillars: number[];
  windscreen: [Pt, Pt];
  rearWindow: [Pt, Pt];
  doors: number[];
  roofRails?: boolean;
}

// Indexed by VehicleSpec.model: city (Clio/Polo), hatch (Golf), estate, sedan (A4/3-series), SUV (Tiguan), van (Transit).
const PROFILES: Profile[] = [
  {
    length: 3.95, width: 1.75, axles: [-1.25, 1.22], wheelRadius: 0.31, sill: 0.28, belt: 0.98, roof: 1.44,
    top: [[-1.975, 0.4], [-1.985, 0.88], [-1.9, 1.0], [-1.82, 1.36], [-1.6, 1.44], [0.05, 1.44], [0.3, 1.4], [0.9, 0.97], [1.55, 0.86], [1.9, 0.76], [1.975, 0.4]],
    windows: [[-1.62, 1.03], [-1.48, 1.34], [0.22, 1.36], [0.82, 1.02]],
    pillars: [-1.2, -0.38],
    windscreen: [[0.9, 0.97], [0.3, 1.4]], rearWindow: [[-1.9, 1.0], [-1.82, 1.36]],
    doors: [-0.42, 0.62],
  },
  {
    length: 4.25, width: 1.79, axles: [-1.33, 1.3], wheelRadius: 0.33, sill: 0.3, belt: 1.0, roof: 1.47,
    top: [[-2.125, 0.42], [-2.135, 0.92], [-2.05, 1.04], [-1.95, 1.39], [-1.72, 1.47], [0.05, 1.47], [0.32, 1.43], [0.98, 1.0], [1.7, 0.88], [2.06, 0.76], [2.125, 0.42]],
    windows: [[-1.78, 1.05], [-1.62, 1.37], [0.24, 1.39], [0.9, 1.04]],
    pillars: [-1.3, -0.42],
    windscreen: [[0.98, 1.0], [0.32, 1.43]], rearWindow: [[-2.05, 1.04], [-1.95, 1.39]],
    doors: [-0.46, 0.66],
  },
  {
    length: 4.75, width: 1.83, axles: [-1.45, 1.38], wheelRadius: 0.34, sill: 0.3, belt: 1.0, roof: 1.48,
    top: [[-2.375, 0.42], [-2.385, 0.94], [-2.32, 1.06], [-2.24, 1.4], [-2.05, 1.48], [0.1, 1.48], [0.38, 1.44], [1.08, 1.0], [1.88, 0.88], [2.3, 0.76], [2.375, 0.42]],
    windows: [[-2.12, 1.05], [-2.0, 1.38], [0.3, 1.4], [1.0, 1.04]],
    pillars: [-1.5, -0.42],
    windscreen: [[1.08, 1.0], [0.38, 1.44]], rearWindow: [[-2.32, 1.06], [-2.24, 1.4]],
    doors: [-0.46, 0.72], roofRails: true,
  },
  {
    length: 4.75, width: 1.83, axles: [-1.42, 1.4], wheelRadius: 0.34, sill: 0.3, belt: 0.98, roof: 1.44,
    top: [[-2.375, 0.42], [-2.385, 0.86], [-2.3, 0.96], [-1.85, 1.0], [-1.25, 1.4], [-0.55, 1.44], [0.15, 1.44], [0.42, 1.4], [1.1, 0.98], [1.9, 0.86], [2.3, 0.74], [2.375, 0.42]],
    windows: [[-1.62, 1.03], [-1.18, 1.37], [0.36, 1.37], [1.02, 1.02]],
    pillars: [-0.48],
    windscreen: [[1.1, 0.98], [0.42, 1.4]], rearWindow: [[-1.85, 1.0], [-1.25, 1.4]],
    doors: [-1.2, -0.5, 0.72],
  },
  {
    length: 4.5, width: 1.86, axles: [-1.36, 1.32], wheelRadius: 0.37, sill: 0.42, belt: 1.16, roof: 1.66,
    top: [[-2.25, 0.5], [-2.26, 1.06], [-2.18, 1.2], [-2.08, 1.56], [-1.86, 1.66], [0.05, 1.66], [0.36, 1.62], [1.02, 1.16], [1.8, 1.05], [2.18, 0.92], [2.25, 0.5]],
    windows: [[-1.92, 1.21], [-1.78, 1.56], [0.28, 1.58], [0.94, 1.2]],
    pillars: [-1.36, -0.44],
    windscreen: [[1.02, 1.16], [0.36, 1.62]], rearWindow: [[-2.18, 1.2], [-2.08, 1.56]],
    doors: [-0.48, 0.7], roofRails: true,
  },
  {
    length: 5.3, width: 2.05, axles: [-1.6, 1.75], wheelRadius: 0.36, sill: 0.4, belt: 1.25, roof: 2.25,
    top: [[-2.65, 0.48], [-2.66, 2.12], [-2.58, 2.25], [1.35, 2.25], [1.55, 2.12], [1.95, 1.3], [2.5, 1.12], [2.62, 0.95], [2.65, 0.48]],
    windows: [[0.98, 1.3], [0.98, 1.95], [1.5, 1.98], [1.88, 1.3]],
    pillars: [],
    windscreen: [[1.95, 1.3], [1.55, 2.12]], rearWindow: [[-2.66, 1.4], [-2.66, 1.4]],
    doors: [0.9],
  },
];

function warp(p: Profile, x: number, y: number): number {
  const half = p.length / 2;
  const plan = 1 - 0.09 * Math.pow(Math.min(Math.abs(x) / half, 1), 6);
  const t = Math.max(0, (y - p.belt) / (p.roof - p.belt));
  const tumble = 1 - 0.16 * Math.pow(Math.min(t, 1.2), 1.4);
  return plan * tumble;
}

function warpGeometry(g: THREE.BufferGeometry, p: Profile) {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) * warp(p, pos.getX(i), pos.getY(i)));
  g.computeVertexNormals();
  return g;
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, hex: number) {
  return coloured(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, 2, 1, 2).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), hex);
}

function panel(pts: number[][], hex: number): THREE.BufferGeometry {
  const [a, b, c, d] = pts;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d, ...a, ...c, ...b, ...a, ...d, ...c], 3));
  return coloured(g, hex);
}

function topAt(p: Profile, x: number): number {
  for (let i = 0; i < p.top.length - 1; i++) {
    const [x0, y0] = p.top[i], [x1, y1] = p.top[i + 1];
    if ((x >= x0 && x <= x1) || (x >= x1 && x <= x0)) return x1 === x0 ? Math.max(y0, y1) : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return p.sill;
}

function buildModel(p: Profile) {
  const half = p.length / 2, hw = p.width / 2;
  const arch = p.wheelRadius + 0.08;

  const shape = new THREE.Shape();
  shape.moveTo(-half + 0.1, p.sill);
  for (const x of p.axles) {
    shape.lineTo(x - arch, p.sill);
    shape.absarc(x, p.sill, arch, Math.PI, 0, true);
  }
  shape.lineTo(half - 0.1, p.sill);
  for (const [x, y] of [...p.top].reverse()) shape.lineTo(x, y);
  const bevel = 0.12;
  const body = new THREE.ExtrudeGeometry(shape, {
    depth: p.width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelOffset: -bevel, bevelThickness: bevel,
    bevelSegments: 3, curveSegments: 10,
  });
  body.translate(0, 0, -(p.width - bevel * 2) / 2);
  const paint = [coloured(warpGeometry(body, p), 0xffffff)];
  const trim: THREE.BufferGeometry[] = [];
  const side = (fn: (s: number) => THREE.BufferGeometry) => {
    for (const s of [-1, 1]) trim.push(warpGeometry(fn(s), p));
  };

  const win = new THREE.Shape(p.windows.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const s of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(win, { depth: 0.01, bevelEnabled: false });
    g.translate(0, 0, s > 0 ? hw + 0.002 : -hw - 0.012);
    trim.push(warpGeometry(coloured(g, GLASS), p));
    for (const x of p.pillars) paint.push(warpGeometry(box(x - 0.07, x + 0.07, p.belt, p.roof - 0.06, s * (hw + 0.004), s * (hw + 0.016), 0xffffff), p));
  }
  for (const [[x0, y0], [x1, y1]] of [p.windscreen, p.rearWindow]) {
    if (x0 === x1 && y0 === y1) continue;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = (y1 - y0) / len * (x1 > x0 ? -1 : 1), ny = Math.abs(x1 - x0) / len;
    const o = 0.012, w = hw - 0.14, i0 = 0.06, i1 = 0.04;
    const a: Pt = [x0 + (x1 - x0) * (i0 / len) + nx * o, y0 + (y1 - y0) * (i0 / len) + ny * o];
    const b: Pt = [x1 - (x1 - x0) * (i1 / len) + nx * o, y1 - (y1 - y0) * (i1 / len) + ny * o];
    trim.push(warpGeometry(panel([[a[0], a[1], -w], [a[0], a[1], w], [b[0], b[1], w], [b[0], b[1], -w]], GLASS), p));
  }

  const frontY = topAt(p, half - 0.15), rearY = topAt(p, -half + 0.12);
  side((s) => box(half - 0.2, half + 0.005, frontY - 0.17, frontY - 0.04, s * (hw - 0.52), s * (hw - 0.14), HEADLIGHT));
  side((s) => box(half - 0.13, half + 0.008, frontY - 0.15, frontY - 0.06, s * (hw - 0.36), s * (hw - 0.28), CHROME));
  side((s) => box(-half - 0.006, -half + 0.22, rearY - 0.2, rearY - 0.06, s * (hw - 0.42), s * (hw + 0.003), TAIL));
  side((s) => box(-half - 0.008, -half + 0.05, rearY - 0.2, rearY - 0.15, s * (hw - 0.4), s * (hw - 0.3), AMBER));
  trim.push(warpGeometry(box(half - 0.06, half + 0.006, frontY - 0.3, frontY - 0.05, -(hw - 0.56), hw - 0.56, BLACK), p));
  trim.push(warpGeometry(box(half - 0.3, half + 0.004, p.sill + 0.02, p.sill + 0.16, -(hw - 0.12), hw - 0.12, BLACK), p));
  trim.push(warpGeometry(box(-half - 0.004, -half + 0.3, p.sill + 0.02, p.sill + 0.18, -(hw - 0.12), hw - 0.12, BLACK), p));
  side((s) => box(p.axles[0] + arch, p.axles[1] - arch, p.sill, p.sill + 0.1, s * (hw - 0.02), s * (hw + 0.01), BLACK));
  for (const [x, y] of [[half + 0.01, p.sill + 0.22], [-half - 0.01, rearY - 0.38]] as Pt[]) {
    trim.push(box(x - 0.012, x + 0.012, y - 0.06, y + 0.06, -0.26, 0.26, PLATE));
    trim.push(box(x - 0.016, x + 0.016, y - 0.025, y + 0.025, -0.17, 0.15, PLATE_TEXT));
  }
  for (const x of p.doors) {
    side((s) => box(x - 0.008, x + 0.008, p.sill + 0.12, p.belt - 0.02, s * (hw - 0.004), s * (hw + 0.004), BLACK));
    side((s) => box(x - 0.2, x - 0.06, p.belt - 0.13, p.belt - 0.1, s * (hw + 0.002), s * (hw + 0.02), CHROME));
  }
  const mirrorX = p.windows[p.windows.length - 1][0] - 0.12;
  for (const s of [-1, 1]) {
    trim.push(box(mirrorX - 0.05, mirrorX + 0.05, p.belt, p.belt + 0.05, s * hw, s * (hw + 0.12), BLACK));
    paint.push(box(mirrorX - 0.1, mirrorX + 0.04, p.belt + 0.03, p.belt + 0.15, s * (hw + 0.06), s * (hw + 0.2), 0xffffff));
  }
  if (p.roofRails) side((s) => box(-half + 0.55, half - 1.75, p.roof, p.roof + 0.05, s * (hw - 0.22), s * (hw - 0.16), BLACK));

  for (const x of p.axles) trim.push(coloured(new THREE.CylinderGeometry(arch - 0.02, arch - 0.02, p.width - 0.3, 16).rotateX(Math.PI / 2).translate(x, p.sill, 0), BLACK));

  return {
    paint: mergeGeometries(paint),
    trim: mergeGeometries(trim),
    wheels: p.axles.flatMap((x) => [-1, 1].map((s) => new THREE.Vector3(x, p.wheelRadius, s * (hw - 0.16)))),
    wheelScale: p.wheelRadius / WHEEL_RADIUS,
  };
}

function wheelGeometry(): THREE.BufferGeometry {
  const tyre = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.23, 16, 1, true).rotateX(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.21, 0.21, 0.24, 12).rotateX(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6).rotateX(Math.PI / 2);
  const walls = [-1, 1].map((s) => new THREE.CylinderGeometry(WHEEL_RADIUS - 0.02, 0.21, 0.02, 16, 1, true).rotateX((s * Math.PI) / 2).translate(0, 0, s * 0.115));
  const spokes = [0, 1, 2, 3, 4].map((i) => new THREE.BoxGeometry(0.06, 0.38, 0.245).rotateZ((i / 5) * Math.PI));
  return mergeGeometries([
    coloured(tyre, TYRE), ...walls.map((g) => coloured(g, TYRE)), coloured(rim, 0x55595e),
    ...spokes.map((g) => coloured(g, RIM)), coloured(hub, CHROME),
  ]);
}

export class VehicleRenderer {
  readonly group = new THREE.Group();
  private models: { paint: THREE.InstancedMesh; trim: THREE.InstancedMesh; wheels: THREE.Vector3[]; wheelScale: number }[] = [];
  private wheels: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private wheelMatrix = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private spin = new THREE.Matrix4();
  private scaleMatrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private pos = new THREE.Vector3();
  private scale = new THREE.Vector3(1, 1, 1);
  private colour = new THREE.Color();

  constructor(capacity: number, private viewDistance = 350) {
    const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.24, metalness: 0.5 });
    const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.25 });
    for (const profile of PROFILES) {
      const m = buildModel(profile);
      const paint = new THREE.InstancedMesh(m.paint, paintMat, capacity);
      const trim = new THREE.InstancedMesh(m.trim, trimMat, capacity);
      paint.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      this.models.push({ paint, trim, wheels: m.wheels, wheelScale: m.wheelScale });
      this.add(paint);
      this.add(trim);
    }
    this.wheels = new THREE.InstancedMesh(
      wheelGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35 }), capacity * 4,
    );
    this.add(this.wheels);
  }

  private add(mesh: THREE.InstancedMesh) {
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false; // instances span the whole map: culled by distance instead
    mesh.count = 0;
    this.group.add(mesh);
  }

  update(vehicles: Vehicle[], camera: THREE.Vector3, alpha: number) {
    const counts = this.models.map(() => 0);
    let wheels = 0;
    const max2 = this.viewDistance ** 2;
    for (const v of vehicles) {
      if (v.spec.model < 0) continue;
      const x = v.prev.x + (v.x - v.prev.x) * alpha;
      const z = v.prev.z + (v.z - v.prev.z) * alpha;
      const d2 = (x - camera.x) ** 2 + (z - camera.z) ** 2;
      if (d2 > max2) continue;
      const angle = v.prev.angle + wrapAngle(v.angle - v.prev.angle) * alpha;

      const model = this.models[v.spec.model];
      const i = counts[v.spec.model]++;
      this.euler.set(v.roll, -angle, v.pitch - Math.min(v.sink, 1) * 0.5);
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.pos.set(x, -v.sink, z), this.quat, this.scale);
      model.paint.setMatrixAt(i, this.matrix);
      model.trim.setMatrixAt(i, this.matrix);
      model.paint.setColorAt(i, this.colour.setHex(v.colour));

      if (d2 > 120 * 120) continue;
      this.scaleMatrix.makeScale(model.wheelScale, model.wheelScale, 1);
      for (const w of model.wheels) {
        this.local.makeRotationY(w.x > 0 ? -v.steerSmoothed * 0.55 : 0).multiply(this.spin.makeRotationZ(-v.wheelSpin)).multiply(this.scaleMatrix);
        this.local.setPosition(w);
        this.wheelMatrix.multiplyMatrices(this.matrix, this.local);
        this.wheels.setMatrixAt(wheels++, this.wheelMatrix);
      }
    }
    this.models.forEach(({ paint, trim }, m) => {
      paint.count = trim.count = counts[m];
      uploadFirst(paint.instanceMatrix, counts[m]);
      uploadFirst(trim.instanceMatrix, counts[m]);
      uploadFirst(paint.instanceColor, counts[m]);
    });
    this.wheels.count = wheels;
    uploadFirst(this.wheels.instanceMatrix, wheels);
  }
}
