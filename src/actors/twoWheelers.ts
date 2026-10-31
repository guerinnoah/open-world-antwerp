import * as THREE from 'three';
import { lerpPose } from '../core/util';
import type { Vehicle } from './vehicle';

// Frame (m): x forward, y up, z rider's right, origin on the ground between the wheels.
export type V3 = [number, number, number];

export function rod(a: V3, b: V3, r: number, seg: number): THREE.BufferGeometry {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, va.distanceTo(vb), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

export function block(c: V3, size: V3, rz = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(...size);
  if (rz) g.rotateZ(rz);
  return g.translate(...c);
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const turn = new THREE.Quaternion(), lean = new THREE.Quaternion(), at = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);

/** `heading`: Rapier angle; `roll`: rad, + = right. */
export function pose(out: THREE.Matrix4, x: number, y: number, z: number, heading: number, roll: number): THREE.Matrix4 {
  turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -heading).multiply(lean.setFromAxisAngle(X_AXIS, roll));
  return out.compose(at.set(x, y, z), turn, ONE);
}

export function ridePose(out: THREE.Matrix4, v: Vehicle, alpha: number, roll: number): THREE.Matrix4 {
  const p = lerpPose(v.prev, v.x, v.z, v.angle, alpha);
  return pose(out, p.x, -Math.min(v.sink, 1.2), p.z, p.angle, roll);
}

export function closest<T extends { x: number; z: number }>(items: Iterable<T>, x: number, z: number, range: number): T | null {
  let best: T | null = null;
  for (const p of items) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < range) {
      range = d;
      best = p;
    }
  }
  return best;
}
