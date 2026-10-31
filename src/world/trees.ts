import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured, stableRandom } from '../core/util';
import { TREE_KINDS } from './treeKinds';

const CHUNK = 250;
const STRIDE = 4; // [x, z, kind, girth]

function crown(r: number, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, hex: number) {
  const geo = new THREE.IcosahedronGeometry(r, 1).scale(sx, sy, sz);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = 0.8 + stableRandom(x * 3.1 + y, z * 2.7 - y) * 0.4;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  geo.computeVertexNormals();
  return coloured(geo.translate(tx, ty, tz), hex);
}

function kindGeometry(kind: number): THREE.BufferGeometry {
  if (kind === 1) {
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.0, 6).translate(0, 1.0, 0);
    const lower = new THREE.ConeGeometry(1.9, 4.4, 7).translate(0, 3.6, 0);
    const upper = new THREE.ConeGeometry(1.2, 2.8, 7).translate(0, 5.8, 0);
    return mergeGeometries([coloured(trunk, 0x4f4030), coloured(lower, 0x33502f), coloured(upper, 0x3c5c36)]);
  }
  if (kind === 2) {
    const trunk = new THREE.CylinderGeometry(0.22, 0.34, 4.2, 6).translate(0, 2.1, 0);
    return mergeGeometries([coloured(trunk, 0x7d7362), crown(3.4, 1.25, 0.95, 1.25, 0, 6.4, 0, 0x7f9a46), crown(2.2, 1, 1, 1, 0.6, 8.2, -0.3, 0x8caa52)]);
  }
  if (kind === 3) {
    const trunk = new THREE.CylinderGeometry(0.1, 0.16, 2.0, 6).translate(0, 1.0, 0);
    return mergeGeometries([coloured(trunk, 0x5b4636), crown(1.7, 1.15, 0.95, 1.15, 0, 3.1, 0, 0x9ab86a), crown(1.05, 1, 1, 1, 0.3, 4.0, -0.2, 0xa6c478)]);
  }
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 3.6, 6).translate(0, 1.8, 0);
  return mergeGeometries([coloured(trunk, 0x5b4636), crown(2.6, 1, 1.15, 1, 0, 5.6, 0, 0x6f9a3e), crown(1.7, 1, 1, 1, 0.5, 7.4, -0.3, 0x7cab49)]);
}

export function createTrees(trees: number[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const geometries = TREE_KINDS.map((_, k) => kindGeometry(k));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

  // Gently: the shadow pass doesn't sway.
  const time = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float sway = smoothstep(1.8, 5.5, position.y) * 0.16;
float wt = uTime * 1.15 + instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
transformed.x += (sin(wt) + 0.3 * sin(wt * 2.7)) * sway;
transformed.z += cos(wt * 0.8) * sway * 0.55;`);
  };

  const chunks = new Map<string, number[][]>();
  for (let i = 0; i < trees.length; i += STRIDE) {
    const x = trees[i], z = trees[i + 1], kind = trees[i + 2] || 0, girth = trees[i + 3] || 0;
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let byKind = chunks.get(key);
    if (!byKind) chunks.set(key, (byKind = TREE_KINDS.map(() => [])));
    byKind[kind].push(x, z, girth);
  }

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();
  for (const byKind of chunks.values()) {
    for (let k = 0; k < geometries.length; k++) {
      const list = byKind[k];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geometries[k], material, list.length / 3);
      for (let i = 0; i < list.length; i += 3) {
        const x = list[i], z = list[i + 1], girth = list[i + 2];
        const r = stableRandom(x, z);
        const r2 = stableRandom(z + 2.3, x - 5.1);
        // girth: cm, 0 = unknown
        const s = Math.min(Math.max(0.5 + (girth || 90) / 200, 0.55), 1.7) * (0.9 + r * 0.2);
        quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r * Math.PI * 2);
        matrix.compose(position.set(x, 0, z), quat, scale.set(s, s * (0.92 + r * 0.2), s));
        mesh.setMatrixAt(i / 3, matrix);
        // Near-neutral so trunks stay brown.
        const b = 0.8 + r * 0.35;
        mesh.setColorAt(i / 3, colour.setRGB(b * (0.96 + r2 * 0.08), b * (0.99 + r * 0.03), b * (0.95 + (1 - r2) * 0.06)));
      }
      mesh.computeBoundingSphere();
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.onBeforeRender = () => { time.value = performance.now() / 1000; };
      group.add(mesh);
    }
  }
  return group;
}
