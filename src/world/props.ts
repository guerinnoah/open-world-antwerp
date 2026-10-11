import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, coloured, stableRandom } from '../core/util';
import type { CityData } from './cityData';
import { OLD_TOWN_RADIUS } from './roofs';

const CHUNK = 500;

const cyl = (r0: number, r1: number, h: number, y: number, hex: number, seg = 8) => coloured(new THREE.CylinderGeometry(r1, r0, h, seg).translate(0, y + h / 2, 0), hex);

const MODELS = {
  lamp: () => mergeGeometries([cyl(0.1, 0.07, 7.4, 0, 0x6c7075), cyl(0.38, 0.3, 0.18, 7.4, 0x55595e, 12), cyl(0.3, 0.3, 0.05, 7.35, 0xe8e2cf, 12)]),
  lantern: () => mergeGeometries([
    cyl(0.2, 0.14, 0.7, 0, 0x1f2124), cyl(0.07, 0.06, 2.9, 0.7, 0x1f2124),
    cyl(0.16, 0.24, 0.6, 3.6, 0xd9cfae, 4), cyl(0.28, 0.02, 0.32, 4.2, 0x1f2124, 4), cyl(0.06, 0.06, 0.12, 3.5, 0x1f2124),
  ]),
  bench: () => mergeGeometries([
    box(1.8, 0.07, 0.45, 0, 0.42, 0, 0x8a6a4a), box(1.8, 0.38, 0.06, 0, 0.55, -0.22, 0x8a6a4a),
    box(0.07, 0.42, 0.45, -0.75, 0, 0, 0x2b2d30), box(0.07, 0.42, 0.45, 0.75, 0, 0, 0x2b2d30),
  ]),
  bollard: () => mergeGeometries([
    cyl(0.11, 0.09, 0.85, 0, 0x4b2a22, 10), cyl(0.12, 0.12, 0.05, 0.62, 0x6b4034, 10),
    coloured(new THREE.SphereGeometry(0.09, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.85, 0), 0x4b2a22),
  ]),
  signal: () => mergeGeometries([ // lenses face -x, towards oncoming traffic
    cyl(0.07, 0.06, 3.2, 0, 0x5b5f63), box(0.24, 0.9, 0.3, 0, 2.3, 0, 0x1c1d1f),
    box(0.02, 0.16, 0.16, -0.13, 2.95, 0, 0xd8251f), box(0.02, 0.16, 0.16, -0.13, 2.67, 0, 0x6a4f12), box(0.02, 0.16, 0.16, -0.13, 2.39, 0, 0x184a26),
  ]),
  terrace: () => mergeGeometries([ // a chair either side along z; ~200 triangles, as there are a thousand
    cyl(0.36, 0.36, 0.03, 0.74, 0x2a2a2a, 10), cyl(0.03, 0.03, 0.74, 0, 0x2a2a2a, 5), cyl(0.22, 0.2, 0.03, 0, 0x2a2a2a, 6),
    ...[-1, 1].flatMap((s) => [
      box(0.42, 0.04, 0.42, 0, 0.44, s * 0.62, 0x8b6a45), box(0.42, 0.42, 0.04, 0, 0.48, s * 0.84, 0x8b6a45),
      ...[-0.18, 0.18].flatMap((dx) => [-0.18, 0.18].map((dz) => box(0.03, 0.44, 0.03, dx, 0, s * 0.62 + dz, 0x2a2a2a))),
    ]),
  ]),
  parasol: () => mergeGeometries([
    cyl(0.025, 0.025, 2.4, 0, 0x333333),
    coloured(new THREE.ConeGeometry(1.45, 0.45, 4, 1, true).rotateY(Math.PI / 4).translate(0, 2.42, 0), 0xffffff),
    coloured(new THREE.CylinderGeometry(1.45, 1.45, 0.16, 4, 1, true).rotateY(Math.PI / 4).translate(0, 2.13, 0), 0xffffff),
  ]),
  veloDock: () => mergeGeometries([box(0.1, 0.75, 0.12, 0, 0, 0, 0x7d8287), box(0.12, 0.16, 0.18, 0, 0.75, 0.02, 0xc8102e)]),
  veloTerminal: () => mergeGeometries([
    box(0.45, 2.1, 0.3, 0, 0, 0, 0xc8102e), box(0.36, 0.3, 0.02, 0, 1.35, -0.16, 0x0d1a24), box(0.36, 0.5, 0.02, 0, 0.6, -0.16, 0xf2f2f2),
  ]),
};

const PARASOLS = [0xeee6d2, 0x1f4d36, 0x6b1f2a, 0x1f2d4a, 0x1d1d1d, 0xc9b48a].map((c) => new THREE.Color(c));

type Kind = keyof typeof MODELS;
type Item = [number, number, number, number?];
interface PropRef {
  kind: Kind;
  i: number;
}

export interface Breakable {
  x: number;
  z: number;
  angle: number; // Rapier angle (three.js rotation.y = -angle)
  size: number | [number, number]; // circle radius, or box [half-length, half-width] turned by angle (m)
  blocksPeople: boolean;
  tall: boolean;
  metal: boolean;
  keep: number; // share of a car's speed it keeps after ploughing through
  parts: PropRef[];
}

type Hit = Pick<Breakable, 'blocksPeople' | 'tall' | 'metal' | 'keep'>;

const HIT = {
  post: { blocksPeople: true, tall: true, metal: true, keep: 0.85 },
  bollard: { blocksPeople: true, tall: false, metal: true, keep: 0.85 },
  bench: { blocksPeople: false, tall: false, metal: false, keep: 0.92 },
  terrace: { blocksPeople: true, tall: false, metal: false, keep: 0.9 },
  velo: { blocksPeople: false, tall: false, metal: true, keep: 0.92 },
  terminal: { blocksPeople: false, tall: true, metal: true, keep: 0.9 },
} satisfies Record<string, Hit>;
const VIEW: Record<Kind, number> = {
  lamp: 400, lantern: 300, bench: 180, bollard: 150, signal: 300, terrace: 150, parasol: 260, veloDock: 100, veloTerminal: 160,
};
const chunkOf = (kind: Kind) => (kind.startsWith('velo') ? 150 : CHUNK);

export interface Props {
  group: THREE.Group;
  update(camera: THREE.Vector3): void;
  breakables: Breakable[];
  setBroken(b: Breakable, broken: boolean): void;
  loose(part: PropRef): THREE.InstancedMesh;
}

export function createProps(city: CityData, viewScale = 1): Props {
  const items: Record<Kind, Item[]> = {
    lamp: [], lantern: [], bench: [], bollard: [], signal: [], terrace: [], parasol: [], veloDock: [], veloTerminal: [],
  };
  const breakables: Breakable[] = [];
  const place = (kind: Kind, item: Item): PropRef => ({ kind, i: items[kind].push(item) - 1 });
  const add = (kind: Kind, x: number, z: number, angle: number, size: Breakable['size'], hit: Hit) =>
    breakables.push({ x, z, angle, size, ...hit, parts: [place(kind, [x, z, angle])] });
  const { lamps, benches, bollards, signals } = city.props;
  for (let i = 0; i < lamps.length; i += 2) {
    add(Math.hypot(lamps[i], lamps[i + 1]) < OLD_TOWN_RADIUS ? 'lantern' : 'lamp', lamps[i], lamps[i + 1], 0, 0.14, HIT.post);
  }
  for (let i = 0; i < benches.length; i += 2) {
    const [x, z] = [benches[i], benches[i + 1]];
    add('bench', x, z, stableRandom(x, z) * Math.PI * 2, [0.9, 0.25], HIT.bench);
  }
  for (let i = 0; i < bollards.length; i += 2) add('bollard', bollards[i], bollards[i + 1], 0, 0.12, HIT.bollard);
  for (let i = 0; i < signals.length; i += 3) add('signal', signals[i], signals[i + 1], signals[i + 2], 0.1, HIT.post);
  const terraces = city.terraces ?? [];
  for (let i = 0; i < terraces.length; i += 4) {
    const [x, z, angle, c] = terraces.slice(i, i + 4);
    breakables.push({ x, z, angle, size: 0.8, ...HIT.terrace, parts: [place('terrace', [x, z, angle]), place('parasol', [x, z, angle, c])] });
  }
  const velo = city.velo ?? [];
  for (let i = 0; i < velo.length; i += 4) {
    const [x, z, angle, docks] = velo.slice(i, i + 4);
    const ux = Math.cos(angle), uz = Math.sin(angle);
    let pair!: Breakable;
    for (let k = 0; k < docks; k++) {
      const s = (k - (docks - 1) / 2) * 0.75;
      const [dx, dz] = [x + ux * s, z + uz * s];
      if (k % 2 === 0) breakables.push((pair = { x: dx, z: dz, angle, size: 0.7, ...HIT.velo, parts: [] }));
      else [pair.x, pair.z] = [(pair.x + dx) / 2, (pair.z + dz) / 2];
      pair.parts.push(place('veloDock', [dx + uz * 0.75, dz - ux * 0.75, angle]));
    }
    const s = (docks / 2) * 0.75 + 0.6;
    add('veloTerminal', x + ux * s + uz * 0.75, z + uz * s - ux * 0.75, angle, 0.3, HIT.terminal);
  }

  const group = new THREE.Group();
  group.name = 'props';
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  // Double-sided: parasols are open shells, seen from below.
  const canvas = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  const geometries = {} as Record<Kind, THREE.BufferGeometry>;
  const instanced = (kind: Kind, count: number) => {
    const mesh = new THREE.InstancedMesh(geometries[kind], kind === 'parasol' ? canvas : material, count);
    mesh.castShadow = kind !== 'bollard' && kind !== 'terrace' && kind !== 'veloDock';
    mesh.receiveShadow = true;
    return mesh;
  };
  const tint = (c: number) => PARASOLS[c % PARASOLS.length];
  const chunks: { mesh: THREE.InstancedMesh; x: number; z: number; view: number }[] = [];
  const slots = {} as Record<Kind, { mesh: THREE.InstancedMesh; index: number }[]>;
  const matrix = new THREE.Matrix4(), quat = new THREE.Quaternion(), position = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const pose = ([x, z, angle]: Item) => matrix.compose(position.set(x, 0, z), quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -angle), one);
  for (const kind of Object.keys(MODELS) as Kind[]) {
    geometries[kind] = MODELS[kind]();
    slots[kind] = [];
    const size = chunkOf(kind);
    const byChunk = new Map<string, number[]>();
    items[kind].forEach(([x, z], i) => {
      const key = `${Math.floor(x / size)},${Math.floor(z / size)}`;
      byChunk.set(key, [...(byChunk.get(key) ?? []), i]);
    });
    for (const [key, list] of byChunk) {
      const mesh = instanced(kind, list.length);
      list.forEach((i, index) => {
        const c = items[kind][i][3];
        mesh.setMatrixAt(index, pose(items[kind][i]));
        if (c !== undefined) mesh.setColorAt(index, tint(c));
        slots[kind][i] = { mesh, index };
      });
      mesh.computeBoundingSphere();
      group.add(mesh);
      const [cx, cz] = key.split(',').map((v) => (Number(v) + 0.5) * size);
      chunks.push({ mesh, x: cx, z: cz, view: VIEW[kind] * viewScale + size * 0.7 });
    }
  }
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    group,
    update(camera) {
      for (const c of chunks) c.mesh.visible = Math.hypot(c.x - camera.x, c.z - camera.z) < c.view;
    },
    breakables,
    setBroken(b, broken) {
      for (const { kind, i } of b.parts) {
        const { mesh, index } = slots[kind][i];
        mesh.setMatrixAt(index, broken ? hidden : pose(items[kind][i]));
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
    loose({ kind, i }) {
      const mesh = instanced(kind, 1);
      const [x, z, angle, c] = items[kind][i];
      if (c !== undefined) mesh.setColorAt(0, tint(c));
      mesh.position.set(x, 0, z);
      mesh.rotation.y = -angle;
      return mesh;
    },
  };
}
