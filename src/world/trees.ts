import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { coloured, stableRandom } from '../core/util';
import { TREE_KINDS } from './treeKinds';

const CHUNK = 250;
const STRIDE = 4; // [x, z, kind, girth]

function crown(r: number, detail: number, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, hex: number) {
  const geo = new THREE.IcosahedronGeometry(r, detail).scale(sx, sy, sz);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const s = 0.8 + stableRandom(x * 3.1 + y, z * 2.7 - y) * 0.4;
    pos.setXYZ(i, x * s, y * s, z * s);
  }
  geo.computeVertexNormals();
  return coloured(geo.translate(tx, ty, tz), hex);
}

function kindGeometry(kind: number, far: boolean): THREE.BufferGeometry {
  const detail = far ? 0 : 1, sides = far ? 4 : 6;
  const trunk = (r0: number, r1: number, h: number, hex: number) =>
    coloured(new THREE.CylinderGeometry(r0, r1, h, sides, 1, far).translate(0, h / 2, 0), hex);
  if (kind === 1) {
    const cone = (r: number, h: number, y: number, hex: number) => coloured(new THREE.ConeGeometry(r, h, far ? 5 : 7, 1, far).translate(0, y, 0), hex);
    return mergeGeometries([trunk(0.16, 0.26, 2.0, 0x4f4030), cone(1.9, 4.4, 3.6, 0x33502f), cone(1.2, 2.8, 5.8, 0x3c5c36)]);
  }
  if (kind === 2) {
    return mergeGeometries([trunk(0.22, 0.34, 4.2, 0x7d7362), crown(3.4, detail, 1.25, 0.95, 1.25, 0, 6.4, 0, 0x7f9a46), crown(2.2, detail, 1, 1, 1, 0.6, 8.2, -0.3, 0x8caa52)]);
  }
  if (kind === 3) {
    return mergeGeometries([trunk(0.1, 0.16, 2.0, 0x5b4636), crown(1.7, detail, 1.15, 0.95, 1.15, 0, 3.1, 0, 0x9ab86a), crown(1.05, detail, 1, 1, 1, 0.3, 4.0, -0.2, 0xa6c478)]);
  }
  return mergeGeometries([trunk(0.16, 0.24, 3.6, 0x5b4636), crown(2.6, detail, 1, 1.15, 1, 0, 5.6, 0, 0x6f9a3e), crown(1.7, detail, 1, 1, 1, 0.5, 7.4, -0.3, 0x7cab49)]);
}

/** Each tree picks its LOD by distance in the shader, so chunks straddling `near` draw both. */
function lodMaterial(far: boolean, near: number, time: { value: number }) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    // Gently: the shadow pass doesn't sway.
    const sway = far ? '' : `
float sway = smoothstep(1.8, 5.5, position.y) * 0.16;
float wt = uTime * 1.15 + instanceMatrix[3].x * 0.07 + instanceMatrix[3].z * 0.05;
transformed.x += (sin(wt) + 0.3 * sin(wt * 2.7)) * sway;
transformed.z += cos(wt * 0.8) * sway * 0.55;`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>${sway}
float treeFar = step(${near.toFixed(1)}, distance(instanceMatrix[3].xz, cameraPosition.xz));
transformed *= ${far ? 'treeFar' : '1.0 - treeFar'};`);
  };
  material.customProgramCacheKey = () => (far ? 'tree-far' : 'tree-near');
  return material;
}

export function createTrees(trees: number[], near: number) {
  const group = new THREE.Group();
  group.name = 'trees';
  const geometries = TREE_KINDS.map((_, k) => [kindGeometry(k, false), kindGeometry(k, true)]);
  const time = { value: 0 };
  const nearMaterial = lodMaterial(false, near, time), farMaterial = lodMaterial(true, near, time);

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
  const point = new THREE.Vector2();
  const lods: { near: THREE.InstancedMesh[]; box: THREE.Box2 }[] = [];
  for (const byKind of chunks.values()) {
    const lod = { near: [] as THREE.InstancedMesh[], box: new THREE.Box2() };
    for (let k = 0; k < geometries.length; k++) {
      const list = byKind[k];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geometries[k][0], nearMaterial, list.length / 3);
      for (let i = 0; i < list.length; i += 3) {
        const x = list[i], z = list[i + 1], girth = list[i + 2];
        lod.box.expandByPoint(point.set(x, z));
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
      const far = new THREE.InstancedMesh(geometries[k][1], farMaterial, mesh.count);
      far.instanceMatrix = mesh.instanceMatrix;
      far.instanceColor = mesh.instanceColor;
      far.receiveShadow = true;
      lod.near.push(mesh);
      group.add(mesh, far);
    }
    lods.push(lod);
  }
  return {
    group,
    update({ x, z }: THREE.Vector3) {
      for (const c of lods) {
        const show = c.box.distanceToPoint(point.set(x, z)) < near;
        for (const m of c.near) m.visible = show;
      }
    },
  };
}
