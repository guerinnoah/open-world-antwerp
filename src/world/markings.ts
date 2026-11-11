import * as THREE from 'three';
import type { RoadGraph } from './cityData';
import { freeAfterUpload } from '../core/instancing';
import { FlatBuilder } from './ground';
import { cumulative, pointAt } from './polyline';

const KEEP_CLEAR = 8;

export function createMarkings(drive: RoadGraph, crossings: number[][]): THREE.Mesh {
  const paint = new FlatBuilder();
  for (const e of drive.edges) {
    if (e.len < KEEP_CLEAR * 2 + 3) continue;
    const cum = cumulative(e.p);
    const from = KEEP_CLEAR, to = e.len - KEEP_CLEAR;
    if (!e.o || e.w >= 9) {
      for (let s = from; s + 3 <= to; s += 12) stripe(paint, e.p, cum, s, s + 3, 0.14, 0);
    }
    if (e.s >= 13) {
      for (const side of [-1, 1]) stripe(paint, e.p, cum, from, to, 0.12, side * (e.w / 2 - 0.35));
    }
  }
  for (const c of crossings) {
    const cum = cumulative(c);
    const len = cum[cum.length - 1];
    for (let s = 0.5; s < len - 0.25; s += 1) {
      const p = pointAt(c, cum, s);
      paint.rect(p.x, p.z, -p.dz, p.dx, 3, 0.5);
    }
  }
  const geometry = paint.geometry();
  freeAfterUpload(geometry);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.6, depthWrite: false }),
  );
  mesh.name = 'markings';
  mesh.renderOrder = 120; // after every ground layer (ground.ts: 100 + i)
  mesh.receiveShadow = true;
  return mesh;
}

function stripe(paint: FlatBuilder, p: number[], cum: number[], a: number, b: number, width: number, offset: number) {
  const pts: number[] = [];
  const steps = Math.max(1, Math.ceil((b - a) / 4));
  for (let i = 0; i <= steps; i++) {
    const q = pointAt(p, cum, a + ((b - a) * i) / steps);
    pts.push(q.x - q.dz * offset, q.z + q.dx * offset);
  }
  paint.ribbon(pts, width, 0);
}
