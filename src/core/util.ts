import * as THREE from 'three';

export function coloured(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
  return geo;
}

export const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number) =>
  coloured(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex);

export const stableRandom = (x: number, z: number) => Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;

export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface Pose {
  x: number;
  z: number;
  angle: number;
}

export function lerpPose(prev: Pose, x: number, z: number, angle: number, alpha: number): Pose {
  return { x: prev.x + (x - prev.x) * alpha, z: prev.z + (z - prev.z) * alpha, angle: prev.angle + wrapAngle(angle - prev.angle) * alpha };
}
