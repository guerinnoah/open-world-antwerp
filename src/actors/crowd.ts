import * as THREE from 'three';
import { uploadFirst } from '../core/instancing';

// Baked Rocketbox avatars: one InstancedMesh each, skinned in the vertex shader from a texture of per-frame bone matrices.
export type Clip = 'walk' | 'run' | 'idle' | 'ride' | 'scoot' | 'punch' | 'moto' | 'moped';

interface ClipInfo {
  row: number;
  frames: number;
  stride: number;
  duration: number;
}

interface Manifest {
  name: string;
  gender: 'f' | 'm';
  weight: number;
  european: boolean;
  vertices: number;
  triangles: number;
  bones: number;
  height: number;
  saddle: number;
  clips: Record<Clip, ClipInfo>;
  layout: Record<'position' | 'normal' | 'uv' | 'skinIndex' | 'skinWeight' | 'index' | 'indexFar' | 'bones', [number, number]>;
}

interface Lod {
  mesh: THREE.InstancedMesh;
  anim: THREE.InstancedBufferAttribute;
  count: number;
}

interface Avatar {
  info: Manifest;
  near: Lod;
  far: Lod;
}

const FAR = 30;

/** GLSL: blends the vertex's 4 bones at frame rows iAnim.x and iAnim.y, mixed by iAnim.z. */
const SKINNING = `
uniform highp sampler2D tBones;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec3 iAnim;
// tBones: one row per animation frame, 3 texels per bone holding the rows of its 3×4 affine matrix.
mat4 boneAt(float bone, float row) {
  ivec2 c = ivec2(int(bone) * 3, int(row));
  vec4 r0 = texelFetch(tBones, c, 0);
  vec4 r1 = texelFetch(tBones, c + ivec2(1, 0), 0);
  vec4 r2 = texelFetch(tBones, c + ivec2(2, 0), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 skinAt(float row) {
  return skinWeight.x * boneAt(skinIndex.x, row) + skinWeight.y * boneAt(skinIndex.y, row)
       + skinWeight.z * boneAt(skinIndex.z, row) + skinWeight.w * boneAt(skinIndex.w, row);
}`;

function skinned<T extends THREE.Material>(material: T, bones: THREE.DataTexture): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tBones = { value: bones };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SKINNING}`)
      .replace('#include <skinbase_vertex>', 'mat4 crowdSkin = iAnim.z <= 0.0 ? skinAt(iAnim.x) : skinAt(iAnim.x) * (1.0 - iAnim.z) + skinAt(iAnim.y) * iAnim.z;')
      .replace('#include <skinnormal_vertex>', 'objectNormal = normalize(mat3(crowdSkin) * objectNormal);')
      .replace('#include <skinning_vertex>', 'transformed = (crowdSkin * vec4(transformed, 1.0)).xyz;');
    // The depth shader has no normals: compute the skin there too.
    if (!shader.vertexShader.includes('crowdSkin = ')) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nmat4 crowdSkin = skinAt(iAnim.x) * (1.0 - iAnim.z) + skinAt(iAnim.y) * iAnim.z;',
      );
    }
  };
  material.customProgramCacheKey = () => `crowd-${material.type}`;
  return material;
}

export class Crowd {
  readonly group = new THREE.Group();
  private avatars: Avatar[] = [];

  private constructor() {
    this.group.name = 'crowd';
  }

  static async load(capacity: number, limit = Infinity): Promise<Crowd> {
    const crowd = new Crowd();
    const manifest = (await (await fetch('/people/people.json')).json()) as Manifest[];
    // Fewer avatars keep the city's mix: each dropped one's share goes to a kept one of the same sex and background.
    const picked = manifest.slice(0, limit);
    for (const m of manifest.slice(limit)) {
      const heir = picked.find((p) => p.gender === m.gender && p.european === m.european) ?? picked.find((p) => p.european === m.european);
      if (heir) heir.weight += m.weight;
    }
    const loader = new THREE.TextureLoader();
    await Promise.all(
      picked.map(async (info) => {
        const [bin, atlas] = await Promise.all([
          fetch(`/people/${info.name}.bin`).then((r) => r.arrayBuffer()),
          loader.loadAsync(`/people/${info.name}.webp`),
        ]);
        crowd.avatars.push(crowd.build(info, bin, atlas, capacity));
      }),
    );
    // Stable order regardless of which download finished first.
    crowd.avatars.sort((a, b) => a.info.name.localeCompare(b.info.name));
    return crowd;
  }

  private build(info: Manifest, bin: ArrayBuffer, atlas: THREE.Texture, capacity: number): Avatar {
    const view = <T>(Type: new (b: ArrayBuffer, o: number, n: number) => T, key: keyof Manifest['layout'], bytes: number) =>
      new Type(bin, info.layout[key][0], info.layout[key][1] / bytes);
    const shared = {
      position: new THREE.BufferAttribute(view(Float32Array, 'position', 4), 3),
      normal: new THREE.BufferAttribute(view(Float32Array, 'normal', 4), 3),
      uv: new THREE.BufferAttribute(view(Float32Array, 'uv', 4), 2),
      skinIndex: new THREE.BufferAttribute(view(Uint8Array, 'skinIndex', 1), 4),
      skinWeight: new THREE.BufferAttribute(view(Uint8Array, 'skinWeight', 1), 4, true),
    };
    const geometryFor = (key: 'index' | 'indexFar') => {
      const g = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(shared)) g.setAttribute(name, a);
      g.setIndex(new THREE.BufferAttribute(view(Uint16Array, key, 2), 1));
      return g;
    };

    const rows = Object.values(info.clips).reduce((n, c) => Math.max(n, c.row + c.frames), 0);
    const bones = new THREE.DataTexture(view(Uint16Array, 'bones', 2), info.bones * 3, rows, THREE.RGBAFormat, THREE.HalfFloatType);
    bones.needsUpdate = true;
    atlas.colorSpace = THREE.SRGBColorSpace;
    atlas.anisotropy = 4;

    const material = skinned(new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, roughness: 0.82, side: THREE.DoubleSide }), bones);
    const depth = skinned(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 }), bones);
    const lod = (key: 'index' | 'indexFar', shadows: boolean): Lod => {
      const geometry = geometryFor(key);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      geometry.setAttribute('iAnim', anim);
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.customDepthMaterial = depth;
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.name = `${info.name}-${key}`;
      this.group.add(mesh);
      return { mesh, anim, count: 0 };
    };
    return { info, near: lod('index', true), far: lod('indexFar', false) };
  }

  get avatarCount() {
    return this.avatars.length;
  }

  get names(): string[] {
    return this.avatars.map((a) => a.info.name);
  }

  /** A random avatar, as likely as its share of the city's population. */
  pick(): number {
    let x = Math.random() * this.avatars.reduce((sum, a) => sum + a.info.weight, 0);
    const i = this.avatars.findIndex((a) => (x -= a.info.weight) < 0);
    return i < 0 ? this.avatars.length - 1 : i;
  }

  private avatar(i: number): Avatar {
    return this.avatars[i % this.avatars.length];
  }

  clip(avatar: number, clip: Clip): ClipInfo {
    return this.avatar(avatar).info.clips[clip];
  }

  add(avatar: number, matrix: THREE.Matrix4, clip: Clip, phase: number, distance = 0) {
    const a = this.avatar(avatar);
    const l = distance > FAR ? a.far : a.near;
    if (l.count >= l.anim.count) return;
    const c = a.info.clips[clip];
    const f = (((phase % 1) + 1) % 1) * c.frames;
    const i0 = Math.floor(f) % c.frames;
    l.mesh.setMatrixAt(l.count, matrix);
    l.anim.setXYZ(l.count, c.row + i0, c.row + ((i0 + 1) % c.frames), f - Math.floor(f));
    l.count++;
  }

  /** Uploads this frame's people: call once, after every add() (bikes, scooters and motorbikes add their riders). */
  finish() {
    for (const a of this.avatars) {
      for (const l of [a.near, a.far]) {
        l.mesh.count = l.count;
        uploadFirst(l.mesh.instanceMatrix, l.count);
        uploadFirst(l.anim, l.count);
        l.count = 0;
      }
    }
  }

  saddle(avatar: number): number {
    return this.avatar(avatar).info.saddle;
  }

  indexOf(name: string): number {
    return Math.max(0, this.avatars.findIndex((a) => a.info.name === name));
  }
}

export function clipForSpeed(speed: number): Clip {
  return speed < 0.25 ? 'idle' : speed < 2.8 ? 'walk' : 'run';
}

export function phaseStep(info: ClipInfo, speed: number, dt: number): number {
  return info.stride > 0 ? (speed * dt) / info.stride : dt / info.duration;
}
