import * as THREE from 'three';
import { freeAfterUpload } from '../core/instancing';
import type { AreaKind, CityData, RoadKind } from './cityData';
import type { GroundTexture, Textures } from './textures';
import { triangulate } from './triangulate';

interface Layer {
  key: AreaKind | RoadKind | 'tram' | 'base';
  texture?: GroundTexture;
  scale?: number;
  tint: number;
  roughness?: number;
  metalness?: number;
}

// Flat at y = 0, drawn back-to-front in this order. Only base and water write depth (pushed back with polygon
// offset), so the layers on top never z-fight but buildings still occlude them.
const LAYERS: Layer[] = [
  { key: 'base', texture: 'pavement', scale: 3, tint: 0xd4d0c8 },
  { key: 'water', tint: 0x23414c }, // under roads, so bridges over the docks stay visible
  { key: 'green', texture: 'grass', scale: 4, tint: 0xc8d4b0 },
  { key: 'plaza', texture: 'cobble', scale: 4, tint: 0xf2ece2 },
  { key: 'foot', texture: 'pavers', scale: 2.5, tint: 0xd8cfc6 },
  { key: 'cycle', texture: 'asphalt', scale: 5, tint: 0xd06a52 },
  { key: 'service', texture: 'asphalt', scale: 5, tint: 0xc4c4c4 },
  { key: 'pedestrian', texture: 'cobble', scale: 4, tint: 0xf2ece2 },
  { key: 'minor', texture: 'asphalt', scale: 5, tint: 0xa8a8a8 },
  { key: 'major', texture: 'asphalt', scale: 5, tint: 0x9a9a9a },
  { key: 'tram', tint: 0x8a8a8a, roughness: 0.35, metalness: 0.8 },
];

export class FlatBuilder {
  pos: number[] = [];
  idx: number[] = [];

  polygon(rings: number[][]) {
    const { flat, tris } = triangulate(rings);
    const v = this.pos.length / 3;
    for (let i = 0; i < flat.length; i += 2) this.pos.push(flat[i], 0, flat[i + 1]);
    for (const t of tris) this.idx.push(v + t);
  }

  ribbon(p: number[], width: number, offset = 0) {
    const n = p.length / 2;
    if (n < 2) return;
    const half = width / 2;
    const v = this.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const prev = Math.max(i - 1, 0), next = Math.min(i + 1, n - 1);
      let dx = p[next * 2] - p[prev * 2], dz = p[next * 2 + 1] - p[prev * 2 + 1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      let scale = 1;
      if (i > 0 && i < n - 1) {
        const ax = p[i * 2] - p[prev * 2], az = p[i * 2 + 1] - p[prev * 2 + 1];
        const al = Math.hypot(ax, az) || 1;
        const cos = (ax / al) * dx + (az / al) * dz;
        scale = Math.min(1 / Math.max(cos, 0.3), 3);
      }
      const nx = -dz, nz = dx;
      const cx = p[i * 2] + nx * offset, cz = p[i * 2 + 1] + nz * offset;
      this.pos.push(cx + nx * half * scale, 0, cz + nz * half * scale, cx - nx * half * scale, 0, cz - nz * half * scale);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = v + i * 2;
      this.tri(a, a + 1, a + 3);
      this.tri(a, a + 3, a + 2);
    }
    if (offset === 0) {
      this.disc(p[0], p[1], half);
      this.disc(p[(n - 1) * 2], p[(n - 1) * 2 + 1], half);
    }
  }

  disc(x: number, z: number, r: number, segments = 8) {
    const v = this.pos.length / 3;
    this.pos.push(x, 0, z);
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      this.pos.push(x + Math.cos(a) * r, 0, z + Math.sin(a) * r);
    }
    for (let i = 0; i < segments; i++) this.tri(v, v + 1 + i, v + 1 + ((i + 1) % segments));
  }

  rect(x: number, z: number, dx: number, dz: number, length: number, width: number) {
    const v = this.pos.length / 3;
    const lx = (dx * length) / 2, lz = (dz * length) / 2, wx = (-dz * width) / 2, wz = (dx * width) / 2;
    this.pos.push(x - lx - wx, 0, z - lz - wz, x + lx - wx, 0, z + lz - wz, x + lx + wx, 0, z + lz + wz, x - lx + wx, 0, z - lz + wz);
    this.tri(v, v + 1, v + 2);
    this.tri(v, v + 2, v + 3);
  }

  private tri(a: number, b: number, c: number) {
    const p = this.pos;
    const up = (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) - (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]);
    if (up >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  geometry(scale = 1): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const n = this.pos.length / 3;
    const uv = new Float32Array(n * 2), normal = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = this.pos[i * 3] / scale;
      uv[i * 2 + 1] = -this.pos[i * 3 + 2] / scale;
      normal[i * 3 + 1] = 1;
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export interface Ground {
  group: THREE.Group;
  update(time: number): void;
}

export function createGround(city: CityData, textures: Textures): Ground {
  const builders = new Map<string, FlatBuilder>(LAYERS.map((l) => [l.key, new FlatBuilder()]));
  const { minX, minZ, maxX, maxZ } = city.bounds;
  const margin = 2000;
  builders.get('base')!.polygon([[minX - margin, minZ - margin, maxX + margin, minZ - margin, maxX + margin, maxZ + margin, minX - margin, maxZ + margin]]);
  for (const a of city.areas) builders.get(a.k)!.polygon(a.rings);
  for (const r of city.roads) builders.get(r.k)!.ribbon(r.p, r.w);
  // Metre-gauge trams: a rail 0.5 m either side of the centreline.
  for (const t of city.trams) for (const side of [0.5, -0.5]) builders.get('tram')!.ribbon(t, 0.12, side);

  const group = new THREE.Group();
  group.name = 'ground';
  let water: THREE.MeshStandardMaterial | null = null;
  LAYERS.forEach((layer, i) => {
    const builder = builders.get(layer.key)!;
    if (!builder.idx.length) return;
    const tex = layer.texture && textures.ground[layer.texture];
    const writesDepth = layer.key === 'water' || layer.key === 'base';
    const material = new THREE.MeshStandardMaterial({
      color: layer.tint,
      ...(tex ? { map: tex.map, normalMap: tex.normalMap } : {}),
      roughness: layer.roughness ?? 0.95,
      metalness: layer.metalness ?? 0,
      depthWrite: writesDepth,
      polygonOffset: writesDepth,
      // Base pushed back further than water: at the same offset the river turns into streaky bands.
      polygonOffsetFactor: layer.key === 'base' ? 2 : 1,
      polygonOffsetUnits: layer.key === 'base' ? 4 : 1,
    });
    if (layer.key === 'water') {
      Object.assign(material, { roughness: 0.06, normalMap: textures.water, normalScale: new THREE.Vector2(0.35, 0.35) });
      // Ripples fade out with distance, where they'd break up into streaky bands.
      material.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <normal_fragment_maps>',
          `vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
          mapN.xy *= normalScale * (1.0 - smoothstep(40.0, 200.0, length(vViewPosition)));
          normal = normalize(tbn * mapN);`,
        );
      };
      water = material;
    }
    const geometry = builder.geometry(layer.key === 'water' ? 18 : layer.scale);
    freeAfterUpload(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -100 + i;
    mesh.receiveShadow = true;
    mesh.name = layer.key;
    group.add(mesh);
  });

  return {
    group,
    update(time) {
      if (water?.normalMap) water.normalMap.offset.set(time * 0.006, time * 0.004);
    },
  };
}
