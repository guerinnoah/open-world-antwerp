import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const FRONT = 0.12; // m: inner face of the front wall

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

/** Room space: x along the street wall (0 = the doorway), y up, z into the building. */
export class Mesher {
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
    const [a, b] = Math.abs(n[1]) > 0.5 ? [0, 2] : Math.abs(n[0]) > 0.5 ? [2, 1] : [0, 1];
    for (const q of p) this.vertex(q[0], q[1], q[2], n[0], n[1], n[2], uv ? q[a] / uv : 0, uv ? q[b] / uv : 0);
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

  geometry(g: THREE.BufferGeometry, m: THREE.Matrix4, colour: number, uv = 0) {
    let t = templates.get(g);
    if (!t) {
      const index = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: g.getAttribute('position').count }, (_, i) => i);
      t = {
        p: g.getAttribute('position').array as Float32Array, n: g.getAttribute('normal').array as Float32Array,
        t: g.getAttribute('uv')?.array as Float32Array | undefined, i: Uint32Array.from(index),
      };
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
      const k = (i / 3) * 2, u = uv && t.t ? t.t[k] / uv : 0, v = uv && t.t ? t.t[k + 1] / uv : 0;
      this.vertex(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14], nx / l, ny / l, nz / l, u, v);
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

const templates = new WeakMap<THREE.BufferGeometry, { p: Float32Array; n: Float32Array; t?: Float32Array; i: Uint32Array }>();

export const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
export const BALL = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('uv')); // indexed: 42 vertices, not 240
export const SHADE = new THREE.ConeGeometry(0.2, 0.18, 12, 1, true);
export const KNOT = new THREE.TorusKnotGeometry(0.16, 0.05, 48, 8);
export const CUBE = new THREE.BoxGeometry(1, 1, 1);
export const BEAM = new THREE.ConeGeometry(1, 1, 16, 1, true);
const euler = new THREE.Euler(0, 0, 0, 'YXZ'), place = new THREE.Vector3(), turn = new THREE.Quaternion(), size = new THREE.Vector3();
export const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(place.set(x, y, z), turn.setFromEuler(euler.set(rx, ry, rz)), size.set(sx, sy, sz));

const unitBox = new Mesher();
unitBox.box(0, 0, 0, 1, 1, 1, 0xffffff);
const ITEM_BOX = unitBox.build(new THREE.Matrix4())!;
const ITEM_ROUND = new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
ITEM_ROUND.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(ITEM_ROUND.getAttribute('position').count * 3).fill(1), 3));

/** Shelf goods as instances: merged, a big supermarket's thousands came to ~8 MB built in one frame. */
export class Items {
  private boxes: number[] = [];
  private rounds: number[] = [];

  /** Same footprint as Mesher.box. */
  box(x: number, z: number, y0: number, sx: number, sz: number, h: number, colour: number) {
    this.boxes.push(x, y0, z, sx, h, sz, colour);
  }

  round(x: number, z: number, y0: number, r: number, h: number, colour: number) {
    this.rounds.push(x, y0, z, r, h, r, colour);
  }

  build(world: THREE.Matrix4, material: THREE.Material): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    const colour = new THREE.Color(), matrix = new THREE.Matrix4();
    for (const [shape, list] of [[ITEM_BOX, this.boxes], [ITEM_ROUND, this.rounds]] as const) {
      const n = list.length / 7;
      if (!n) continue;
      const mesh = new THREE.InstancedMesh(shape, material, n);
      for (let j = 0; j < list.length; j += 7) {
        mesh.setMatrixAt(j / 7, matrix.makeScale(list[j + 3], list[j + 4], list[j + 5]).setPosition(list[j], list[j + 1], list[j + 2]));
        mesh.setColorAt(j / 7, colour.setHex(list[j + 6]));
      }
      mesh.matrix.copy(world);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      out.push(mesh);
    }
    return out;
  }
}
