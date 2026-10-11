import earcut from 'earcut';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured } from '../../core/util';

export const GOLD = 0xd2a640;

// Local frame, y up: every primitive stands on its y; boxes are w along x, h up, d along z.
export class Kit {
  private parts: THREE.BufferGeometry[] = [];
  private matrix = new THREE.Matrix4();

  group(x: number, y: number, z: number, rotY: number, fn: () => void): this {
    const saved = this.matrix.clone();
    this.matrix.multiply(new THREE.Matrix4().makeTranslation(x, y, z)).multiply(new THREE.Matrix4().makeRotationY(rotY));
    fn();
    this.matrix.copy(saved);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, colour: number, rotY = 0): this {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(rotY);
    g.translate(x, y + h / 2, z);
    return this.add(g, colour);
  }

  cylinder(rBottom: number, rTop: number, h: number, x: number, y: number, z: number, colour: number, segments = 16, rotY = 0): this {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, rTop === 0);
    g.rotateY(rotY + (segments === 4 ? Math.PI / 4 : 0));
    g.translate(x, y + h / 2, z);
    return this.add(g, colour);
  }

  cone(r: number, h: number, x: number, y: number, z: number, colour: number, segments = 8, rotY = 0): this {
    return this.cylinder(r, 0, h, x, y, z, colour, segments, rotY);
  }

  gable(w: number, d: number, h: number, x: number, y: number, z: number, colour: number, ridge: 'x' | 'z'): this {
    const [l, s] = ridge === 'x' ? [w, d] : [d, w];
    const shape = new THREE.Shape([new THREE.Vector2(-s / 2, 0), new THREE.Vector2(s / 2, 0), new THREE.Vector2(0, h)]);
    const g = new THREE.ExtrudeGeometry(shape, { depth: l, bevelEnabled: false });
    g.translate(0, 0, -l / 2);
    if (ridge === 'x') g.rotateY(Math.PI / 2);
    g.translate(x, y, z);
    return this.add(g, colour);
  }

  hip(w: number, d: number, h: number, x: number, y: number, z: number, colour: number): this {
    const alongX = w >= d;
    const ridge = Math.abs(w - d) / 2;
    const [rx, rz] = alongX ? [ridge, 0] : [0, ridge];
    const p = [
      [-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2], [-rx, h, -rz], [rx, h, rz],
    ].map(([a, b, c]) => new THREE.Vector3(a + x, b + y, c + z));
    const tris = alongX
      ? [[0, 4, 5], [0, 5, 1], [1, 5, 2], [2, 5, 4], [2, 4, 3], [3, 4, 0]]
      : [[0, 4, 1], [1, 4, 5], [1, 5, 2], [2, 5, 3], [3, 5, 4], [3, 4, 0]];
    return this.triangles(tris.map((t) => t.map((i) => p[i])), colour);
  }

  extrude(ring: number[], y0: number, y1: number, colour: number): this {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], -ring[i + 1]));
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: y1 - y0, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y0, 0);
    return this.add(g, colour);
  }

  panel(w: number, h: number, x: number, y: number, z: number, colour: number, rotY = 0, depth = 0.15): this {
    return this.box(w, h, depth, x, y, z, colour, rotY);
  }

  triangles(tris: THREE.Vector3[][], colour: number): this {
    const pos: number[] = [];
    for (const t of tris) for (const v of t) pos.push(v.x, v.y, v.z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return this.add(g, colour);
  }

  facade(outline: [number, number][], colour: number, thickness: number): this {
    const idx = earcut(outline.flat(), undefined, 2);
    const tris: THREE.Vector3[][] = [];
    const t = thickness / 2;
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]].map((k) => outline[k]);
      tris.push([new THREE.Vector3(a[0], a[1], t), new THREE.Vector3(b[0], b[1], t), new THREE.Vector3(c[0], c[1], t)]);
      tris.push([new THREE.Vector3(a[0], a[1], -t), new THREE.Vector3(c[0], c[1], -t), new THREE.Vector3(b[0], b[1], -t)]);
    }
    for (const tri of tris) {
      const n = new THREE.Vector3().subVectors(tri[1], tri[0]).cross(new THREE.Vector3().subVectors(tri[2], tri[0]));
      if ((tri[0].z > 0) !== (n.z > 0)) [tri[1], tri[2]] = [tri[2], tri[1]];
    }
    return this.triangles(tris, colour);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts);
    g.computeBoundingSphere();
    return g;
  }

  private add(g: THREE.BufferGeometry, colour: number): this {
    this.parts.push(coloured(g, colour).applyMatrix4(this.matrix));
    return this;
  }
}

export function alongRing(
  ring: number[], spacing: number, fn: (x: number, z: number, rotY: number, nx: number, nz: number) => void, minEdge = 0,
) {
  let area = 0;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) area += ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1];
  const sign = area > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = ring[i * 2], z0 = ring[i * 2 + 1], dx = ring[j * 2] - x0, dz = ring[j * 2 + 1] - z0;
    const len = Math.hypot(dx, dz);
    if (len < Math.max(minEdge, 0.01)) continue;
    const nx = (sign * dz) / len, nz = (-sign * dx) / len;
    const count = Math.max(1, Math.floor(len / spacing));
    for (let k = 0; k < count; k++) {
      const t = (k + 0.5) / count;
      fn(x0 + dx * t, z0 + dz * t, Math.atan2(nx, nz), nx, nz);
    }
  }
}

export function roundArch(w: number, spring: number, top: number, steps = 8): [number, number][] {
  const out: [number, number][] = [[-w / 2, 0], [w / 2, 0], [w / 2, spring]];
  for (let i = 1; i < steps; i++) {
    const t = (i / steps) * Math.PI;
    out.push([(Math.cos(t) * w) / 2, spring + Math.sin(t) * (top - spring)]);
  }
  out.push([-w / 2, spring]);
  return out;
}
