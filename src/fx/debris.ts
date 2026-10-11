import * as THREE from 'three';

const GRAVITY = 9.81;
const MAX_PIECES = 48;
const FORGET = 250;
const LIFETIME = 90;
const BOUNCE = 0.25;
const FRICTION = 0.6;

interface Hull {
  centre: THREE.Vector3;
  points: Float32Array;
  k2: number;
}

interface Piece {
  object: THREE.Object3D;
  mesh: THREE.InstancedMesh;
  hull: Hull;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  still: number;
  tag: number;
}

type WallCast = (x: number, z: number, dx: number, dz: number, max: number) => { dist: number; nx: number; nz: number } | null;

const hulls = new WeakMap<THREE.BufferGeometry, Hull>();
function hullOf(geometry: THREE.BufferGeometry): Hull {
  let hull = hulls.get(geometry);
  if (hull) return hull;
  geometry.computeBoundingBox();
  const centre = geometry.boundingBox!.getCenter(new THREE.Vector3());
  const half = geometry.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const position = geometry.getAttribute('position');
  const seen = new Set<string>();
  const points: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i) - centre.x, y = position.getY(i) - centre.y, z = position.getZ(i) - centre.z;
    const key = `${Math.round(x * 50)},${Math.round(y * 50)},${Math.round(z * 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(x, y, z);
  }
  hull = { centre, points: new Float32Array(points), k2: (2 / 9) * half.lengthSq() };
  hulls.set(geometry, hull);
  return hull;
}

export class Debris {
  readonly group = new THREE.Group();
  private pieces: Piece[] = [];
  private rotation = new THREE.Matrix4();
  private turn = new THREE.Quaternion();
  private axis = new THREE.Vector3();

  constructor(private wall: WallCast) {
    this.group.name = 'debris';
  }

  launch(mesh: THREE.InstancedMesh, vel: THREE.Vector3, spin: THREE.Vector3, tag: number) {
    const hull = hullOf(mesh.geometry);
    const object = new THREE.Object3D();
    object.quaternion.copy(mesh.quaternion);
    object.position.copy(hull.centre).applyQuaternion(mesh.quaternion).add(mesh.position);
    mesh.position.copy(hull.centre).negate();
    mesh.quaternion.identity();
    object.add(mesh);
    this.group.add(object);
    this.pieces.push({ object, mesh, hull, vel: vel.clone(), spin: spin.clone(), age: 0, still: 0, tag });
    while (this.pieces.length > MAX_PIECES) this.drop(0);
  }

  clear(tag: number) {
    for (let i = this.pieces.length - 1; i >= 0; i--) if (this.pieces[i].tag === tag) this.drop(i);
  }

  update(dt: number, x: number, z: number) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      const at = p.object.position;
      p.age += dt;
      if (p.age > LIFETIME || Math.hypot(at.x - x, at.z - z) > FORGET) {
        this.drop(i);
        continue;
      }
      if (p.still > 0.5) continue;
      const steps = Math.min(Math.ceil(dt * 120), 4);
      for (let s = 0; s < steps; s++) this.step(p, dt / steps);
    }
  }

  private drop(i: number) {
    const p = this.pieces[i];
    this.group.remove(p.object);
    p.mesh.dispose();
    this.pieces.splice(i, 1);
  }

  private step(p: Piece, dt: number) {
    const { object, vel, spin, hull } = p;
    const pos = object.position;
    vel.y -= GRAVITY * dt;

    const speed = Math.hypot(vel.x, vel.z);
    const wall = speed > 0.3 ? this.wall(pos.x, pos.z, vel.x, vel.z, speed * dt + 0.4) : null;
    const into = wall ? vel.x * wall.nx + vel.z * wall.nz : 0;
    if (wall && into < 0) {
      vel.x -= (1 + BOUNCE) * into * wall.nx;
      vel.z -= (1 + BOUNCE) * into * wall.nz;
      spin.multiplyScalar(0.5);
    }

    pos.addScaledVector(vel, dt);
    const w = spin.length();
    if (w > 1e-4) object.quaternion.premultiply(this.turn.setFromAxisAngle(this.axis.copy(spin).divideScalar(w), w * dt));

    const e = this.rotation.makeRotationFromQuaternion(object.quaternion).elements;
    const pts = hull.points;
    let lowest = Infinity;
    for (let i = 0; i < pts.length; i += 3) lowest = Math.min(lowest, e[1] * pts[i] + e[5] * pts[i + 1] + e[9] * pts[i + 2]);
    if (pos.y + lowest > 0) {
      p.still = 0;
      return;
    }
    pos.y = -lowest;
    const push = (rx: number, ry: number, rz: number, jx: number, jy: number, jz: number) => {
      vel.x += jx;
      vel.y += jy;
      vel.z += jz;
      spin.x += (ry * jz - rz * jy) / hull.k2;
      spin.y += (rz * jx - rx * jz) / hull.k2;
      spin.z += (rx * jy - ry * jx) / hull.k2;
    };
    const hard = vel.y < -2;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < pts.length; i += 3) {
        const ry = e[1] * pts[i] + e[5] * pts[i + 1] + e[9] * pts[i + 2];
        if (ry - lowest > 0.02) continue;
        const rx = e[0] * pts[i] + e[4] * pts[i + 1] + e[8] * pts[i + 2];
        const rz = e[2] * pts[i] + e[6] * pts[i + 1] + e[10] * pts[i + 2];
        const cx = vel.x + spin.y * rz - spin.z * ry;
        const cy = vel.y + spin.z * rx - spin.x * rz;
        const cz = vel.z + spin.x * ry - spin.y * rx;
        if (cy >= 0) continue;
        const jn = (-(hard && pass === 0 ? 1 + BOUNCE : 1) * cy) / (1 + (rx * rx + rz * rz) / hull.k2);
        push(rx, ry, rz, 0, jn, 0);
        const slide = Math.hypot(cx, cz);
        if (slide < 1e-3) continue;
        const tx = -cx / slide, tz = -cz / slide;
        const ax = ry * tz, ay = rz * tx - rx * tz, az = -ry * tx;
        const jt = Math.min(slide / (1 + (ax * ax + ay * ay + az * az) / hull.k2), FRICTION * jn);
        push(rx, ry, rz, tx * jt, 0, tz * jt);
      }
    }
    spin.multiplyScalar(Math.exp(-2 * dt));
    p.still = vel.lengthSq() < 0.05 && spin.lengthSq() < 0.1 ? p.still + dt : 0;
  }
}
