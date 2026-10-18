import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured, stableRandom } from '../core/util';
import { TREE_KINDS } from './treeKinds';

const CHUNK = 250;
const STRIDE = 4; // [x, z, kind, girth]

// One crown shape per TREE_KINDS index, with colours baked into vertex colours (the per-instance colour only jitters
// brightness). Trees are scaled per-tree from the real trunk girth, so old planes tower over fresh street saplings.
function kindGeometry(kind: number): THREE.BufferGeometry {
  if (kind === 1) { // conifer: a narrow dark cone over a short trunk
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 2.0, 6).translate(0, 1.0, 0);
    const lower = new THREE.ConeGeometry(1.9, 4.4, 7).translate(0, 3.6, 0);
    const upper = new THREE.ConeGeometry(1.2, 2.8, 7).translate(0, 5.8, 0);
    return mergeGeometries([coloured(trunk, 0x4f4030), coloured(lower, 0x33502f), coloured(upper, 0x3c5c36)]);
  }
  if (kind === 2) { // plane: tall pale trunk, broad spreading crown
    const trunk = new THREE.CylinderGeometry(0.22, 0.34, 4.2, 6).translate(0, 2.1, 0);
    const crown = new THREE.IcosahedronGeometry(3.4, 0).scale(1.25, 0.95, 1.25).translate(0, 6.4, 0);
    const top = new THREE.IcosahedronGeometry(2.2, 0).translate(0.6, 8.2, -0.3);
    return mergeGeometries([coloured(trunk, 0x7d7362), coloured(crown, 0x7f9a46), coloured(top, 0x8caa52)]);
  }
  if (kind === 3) { // blossom: small ornamental, light airy crown
    const trunk = new THREE.CylinderGeometry(0.1, 0.16, 2.0, 6).translate(0, 1.0, 0);
    const crown = new THREE.IcosahedronGeometry(1.7, 0).scale(1.15, 0.95, 1.15).translate(0, 3.1, 0);
    const top = new THREE.IcosahedronGeometry(1.05, 0).translate(0.3, 4.0, -0.2);
    return mergeGeometries([coloured(trunk, 0x5b4636), coloured(crown, 0x9ab86a), coloured(top, 0xa6c478)]);
  }
  // broadleaf (default): rounded medium crown
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 3.6, 6).translate(0, 1.8, 0);
  const crown = new THREE.IcosahedronGeometry(2.6, 0).scale(1, 1.15, 1).translate(0, 5.6, 0);
  const top = new THREE.IcosahedronGeometry(1.7, 0).translate(0.5, 7.4, -0.3);
  return mergeGeometries([coloured(trunk, 0x5b4636), coloured(crown, 0x6f9a3e), coloured(top, 0x7cab49)]);
}

export function createTrees(trees: number[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const geometries = TREE_KINDS.map((_, k) => kindGeometry(k));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });

  // Group by chunk, then by kind: one InstancedMesh per (chunk, kind) keeps draw calls and culling local.
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
        // Girth (cm) → overall scale; unknown girth (0) falls back to an average street tree.
        const s = Math.min(Math.max(0.5 + (girth || 90) / 200, 0.55), 1.7) * (0.9 + r * 0.2);
        quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r * Math.PI * 2);
        matrix.compose(position.set(x, 0, z), quat, scale.set(s, s * (0.92 + r * 0.2), s));
        mesh.setMatrixAt(i / 3, matrix);
        mesh.setColorAt(i / 3, colour.setRGB(0.85 + r * 0.3, 0.85 + r * 0.3, 0.85 + r * 0.3)); // brightness jitter only
      }
      mesh.computeBoundingSphere();
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
