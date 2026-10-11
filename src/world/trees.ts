import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured, stableRandom } from '../core/util';

const CHUNK = 250;

function treeGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 3.6, 6).translate(0, 1.8, 0);
  const crown = new THREE.IcosahedronGeometry(2.6, 0).scale(1, 1.15, 1).translate(0, 5.6, 0);
  const top = new THREE.IcosahedronGeometry(1.7, 0).translate(0.5, 7.4, -0.3);
  return mergeGeometries([coloured(trunk, 0x5b4636), coloured(crown, 0x5d7d3e), coloured(top, 0x6a8b45)]);
}

export function createTrees(trees: number[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const chunks = new Map<string, number[]>();
  for (let i = 0; i < trees.length; i += 2) {
    const key = `${Math.floor(trees[i] / CHUNK)},${Math.floor(trees[i + 1] / CHUNK)}`;
    let list = chunks.get(key);
    if (!list) chunks.set(key, (list = []));
    list.push(trees[i], trees[i + 1]);
  }

  const geometry = treeGeometry();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const colour = new THREE.Color();
  for (const list of chunks.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length / 2);
    for (let i = 0; i < list.length; i += 2) {
      const x = list[i], z = list[i + 1];
      const r = stableRandom(x, z);
      const s = 0.75 + r * 0.6;
      quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, r * Math.PI * 2);
      matrix.compose(position.set(x, 0, z), quat, scale.set(s, s * (0.9 + r * 0.25), s));
      mesh.setMatrixAt(i / 2, matrix);
      mesh.setColorAt(i / 2, colour.setHSL(0.24 + r * 0.06, 0.35, 0.42 + r * 0.12).multiplyScalar(2.2));
    }
    mesh.computeBoundingSphere();
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
