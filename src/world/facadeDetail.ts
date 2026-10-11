import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, coloured } from '../core/util';
import { rand } from './buildings';
import type { Building } from './cityData';
import { bays, doorBay, facadeStyle, hasBalconies } from './facadeLayout';
import { planRoof } from './roofs';

const CHUNK = 200;
const VIEW = 170;
const DETAIL = 70;

type Kind = 'balcony' | 'awning';

const MODELS: Record<Kind, () => THREE.BufferGeometry> = {
  balcony: () => {
    const iron = 0x1c1d1f;
    const parts = [
      box(1, 0.12, 0.62, 0, 0, 0.31, 0xbdb4a2), box(0.08, 0.25, 0.45, -0.42, -0.25, 0.22, 0xa79f8f), box(0.08, 0.25, 0.45, 0.42, -0.25, 0.22, 0xa79f8f),
      box(1, 0.04, 0.04, 0, 1.0, 0.6, iron), box(1, 0.03, 0.03, 0, 0.18, 0.6, iron),
    ];
    for (const x of [-0.5, 0.5]) parts.push(box(0.04, 1.0, 0.6, x, 0.12, 0.3, iron));
    for (let x = -0.44; x <= 0.45; x += 0.12) parts.push(box(0.018, 0.86, 0.018, x, 0.14, 0.6, iron));
    return mergeGeometries(parts);
  },
  awning: () => {
    const parts: THREE.BufferGeometry[] = [];
    const stripes = 8;
    for (let i = 0; i < stripes; i++) {
      const x = -0.5 + (i + 0.5) / stripes;
      const hex = i % 2 ? 0xe9e4d8 : 0xffffff;
      const slope = new THREE.PlaneGeometry(1 / stripes, 1.45).rotateX(-Math.PI / 2 + 0.55).translate(x, -0.37, 0.62);
      parts.push(coloured(slope, hex), coloured(slope.clone().rotateY(Math.PI).translate(2 * x, 0, 1.24), hex));
      parts.push(box(1 / stripes, 0.28, 0.02, x, -1.03, 1.24, hex));
    }
    parts.push(box(0.02, 0.02, 1.3, -0.48, -0.75, 0.62, 0x2b2c2e), box(0.02, 0.02, 1.3, 0.48, -0.75, 0.62, 0x2b2c2e));
    return mergeGeometries(parts);
  },
};

const FAR_MODELS: Record<Kind, () => THREE.BufferGeometry> = {
  balcony: () => mergeGeometries([box(1, 0.12, 0.62, 0, 0, 0.31, 0xbdb4a2), box(1, 0.88, 0.03, 0, 0.12, 0.6, 0x26272a)]),
  awning: () => mergeGeometries([
    coloured(new THREE.PlaneGeometry(1, 1.45).rotateX(-Math.PI / 2 + 0.55).translate(0, -0.37, 0.62), 0xf2eee6),
    box(1, 0.28, 0.02, 0, -1.03, 1.24, 0xf2eee6),
  ]),
};

const AWNINGS = [0x1f4a2e, 0x6b1d24, 0x1d2d4f, 0x34373b, 0x9c4a2a, 0x2f5d50];

interface Placement {
  matrix: THREE.Matrix4;
  colour?: number;
}

export interface FacadeDetail {
  group: THREE.Group;
  update(camera: THREE.Vector3): void;
}

export function createFacadeDetail(buildings: Building[], viewScale: number): FacadeDetail {
  const placed: Record<Kind, Map<string, Placement[]>> = { balcony: new Map(), awning: new Map() };
  const add = (kind: Kind, x: number, z: number, p: Placement) => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    const list = placed[kind].get(key) ?? [];
    list.push(p);
    placed[kind].set(key, list);
  };

  for (const b of buildings) {
    if (b.hd || b.nw || b.mh || !b.sf?.length) continue;
    const seed = rand(b, 5);
    const style = facadeStyle(seed);
    const plan = planRoof(b);
    const top = plan ? plan.eaves : b.h;
    const ring = b.rings[0];
    const n = ring.length / 2;
    const cafe = b.sh === 2;
    const balconies = !b.sh && hasBalconies(seed) && top > style.groundH + style.floorH + 1;
    if (!cafe && !balconies) continue;
    const awningColour = AWNINGS[Math.floor(rand(b, 9) * AWNINGS.length)];

    for (const i of b.sf) {
      const x0 = ring[i * 2], z0 = ring[i * 2 + 1];
      const x1 = ring[((i + 1) % n) * 2], z1 = ring[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 2) continue;
      const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
      const turn = new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(uz, -ux));
      const { count, width } = bays(len, style.bayTarget);
      const door = doorBay(seed, count);
      for (let k = 0; k < count; k++) {
        const along = (k + 0.5) * width;
        const x = x0 + ux * along, z = z0 + uz * along;
        const place = (y: number, sx: number, sy: number) =>
          new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), turn, new THREE.Vector3(sx, sy, 1));
        if (cafe && k !== door) add('awning', x, z, { matrix: place(style.groundH - 0.98, width * 0.94, 0.75), colour: awningColour });
        if (balconies) add('balcony', x, z, { matrix: place(style.groundH + style.sill - 0.12, Math.min(width * 0.9, 2.2), 1) });
      }
    }
  }

  const group = new THREE.Group();
  group.name = 'facade-detail';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide });
  const chunks: { near: THREE.InstancedMesh; far: THREE.InstancedMesh; x: number; z: number }[] = [];
  const tint = new THREE.Color();
  const instanced = (geometry: THREE.BufferGeometry, list: Placement[], shadows: boolean) => {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((p, i) => {
      mesh.setMatrixAt(i, p.matrix);
      mesh.setColorAt(i, p.colour !== undefined ? tint.setHex(p.colour).multiplyScalar(1.6) : tint.setRGB(1, 1, 1));
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };
  for (const kind of Object.keys(MODELS) as Kind[]) {
    const nearGeometry = MODELS[kind](), farGeometry = FAR_MODELS[kind]();
    for (const [key, list] of placed[kind]) {
      const [cx, cz] = key.split(',').map((v) => (Number(v) + 0.5) * CHUNK);
      chunks.push({ near: instanced(nearGeometry, list, true), far: instanced(farGeometry, list, false), x: cx, z: cz });
    }
  }
  const half = CHUNK * 0.7;
  return {
    group,
    update(camera) {
      for (const c of chunks) {
        const d = Math.hypot(c.x - camera.x, c.z - camera.z);
        c.near.visible = d < DETAIL + half;
        c.far.visible = !c.near.visible && d < VIEW * viewScale + half;
      }
    },
  };
}
