import * as THREE from 'three';
import type { Crowd } from '../actors/crowd';
import { parkMiller } from '../core/util';
import { GROUP, RAPIER, WHEELS, groups, type Physics } from '../physics/physics';
import { rand } from './buildings';
import type { Building, SignStyle } from './cityData';
import type { Environment } from './environment';
import { bays, doorBay, facadeStyle } from './facadeLayout';
import { inRing } from './polyline';
import type { Door } from './signs';

type Place = Exclude<SignStyle, 'street'>;

/** m: [along the street, depth], shrunk to fit the building. */
const SIZE: Record<Place, [number, number]> = {
  cafe: [9, 11], restaurant: [10, 12], fastfood: [8, 9], bakery: [6, 8], jewelry: [6, 8], fashion: [9, 12], food: [12, 14],
  shop: [7, 10], pharmacy: [7, 9], bank: [8, 10], service: [6, 8], hotel: [10, 12], culture: [11, 14], club: [11, 14], public: [10, 12],
  plate: [6, 7],
};

const FRONT = 0.12; // m: inner face of the front wall
const ENTRY_X = 1.05, ENTRY_Z = 2.4; // m, entrance kept clear of furniture
const SPAWN_Z = 1.5; // m: where enter() puts the player

type V3 = [number, number, number];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

class Grow<T extends Float32Array | Uint32Array> {
  n = 0;
  constructor(public a: T) {}
  reserve(k: number) {
    if (this.n + k <= this.a.length) return;
    const b = new (this.a.constructor as new (n: number) => T)(Math.max(this.a.length * 2, this.n + k));
    b.set(this.a);
    this.a = b;
  }
}

/** Room space: x along the street wall (0 = the doorway), y up, z into the building. */
class Mesher {
  private pos = new Grow(new Float32Array(3 * 4096));
  private nor = new Grow(new Float32Array(3 * 4096));
  private col = new Grow(new Float32Array(3 * 4096));
  private uv = new Grow(new Float32Array(2 * 4096));
  private idx = new Grow(new Uint32Array(6 * 2048));
  private colour = new THREE.Color();
  private normalMatrix = new THREE.Matrix3();

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    const p = this.pos, n = this.nor, c = this.col, t = this.uv;
    p.a[p.n++] = x; p.a[p.n++] = y; p.a[p.n++] = z;
    n.a[n.n++] = nx; n.a[n.n++] = ny; n.a[n.n++] = nz;
    c.a[c.n++] = this.colour.r; c.a[c.n++] = this.colour.g; c.a[c.n++] = this.colour.b;
    t.a[t.n++] = u; t.a[t.n++] = v;
  }

  private reserve(vertices: number, indices: number) {
    this.pos.reserve(vertices * 3);
    this.nor.reserve(vertices * 3);
    this.col.reserve(vertices * 3);
    this.uv.reserve(vertices * 2);
    this.idx.reserve(indices);
  }

  quad(c: V3, e1: V3, e2: V3, n: V3, colour: number, uv = 0) {
    const p = [sub(sub(c, e1), e2), sub(add(c, e1), e2), add(add(c, e1), e2), add(sub(c, e1), e2)];
    const u = sub(p[1], p[0]), v = sub(p[2], p[0]);
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    if (cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] < 0) p.reverse();
    this.colour.setHex(colour);
    this.reserve(4, 6);
    const base = this.pos.n / 3;
    const [a, b] = Math.abs(n[1]) > 0.5 ? [0, 2] : Math.abs(n[0]) > 0.5 ? [2, 1] : [0, 1];
    for (const q of p) this.vertex(q[0], q[1], q[2], n[0], n[1], n[2], uv ? q[a] / uv : 0, uv ? q[b] / uv : 0);
    const i = this.idx;
    i.a[i.n++] = base; i.a[i.n++] = base + 1; i.a[i.n++] = base + 2;
    i.a[i.n++] = base; i.a[i.n++] = base + 2; i.a[i.n++] = base + 3;
  }

  box(x: number, z: number, y0: number, sx: number, sz: number, h: number, colour: number, bottom = false) {
    const c: V3 = [x, y0 + h / 2, z];
    const hx: V3 = [sx / 2, 0, 0], hy: V3 = [0, h / 2, 0], hz: V3 = [0, 0, sz / 2];
    this.quad(add(c, hy), hx, hz, [0, 1, 0], colour);
    if (bottom) this.quad(sub(c, hy), hx, hz, [0, -1, 0], colour);
    this.quad(add(c, hx), hy, hz, [1, 0, 0], colour);
    this.quad(sub(c, hx), hy, hz, [-1, 0, 0], colour);
    this.quad(add(c, hz), hx, hy, [0, 0, 1], colour);
    this.quad(sub(c, hz), hx, hy, [0, 0, -1], colour);
  }

  geometry(g: THREE.BufferGeometry, m: THREE.Matrix4, colour: number, uv = 0) {
    let t = templates.get(g);
    if (!t) {
      const index = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: g.getAttribute('position').count }, (_, i) => i);
      t = {
        p: g.getAttribute('position').array as Float32Array, n: g.getAttribute('normal').array as Float32Array,
        t: g.getAttribute('uv')?.array as Float32Array | undefined, i: Uint32Array.from(index),
      };
      templates.set(g, t);
    }
    this.colour.setHex(colour);
    const e = m.elements, q = this.normalMatrix.getNormalMatrix(m).elements;
    const count = t.p.length / 3;
    this.reserve(count, t.i.length);
    const base = this.pos.n / 3;
    for (let i = 0; i < t.p.length; i += 3) {
      const x = t.p[i], y = t.p[i + 1], z = t.p[i + 2];
      const a = t.n[i], b = t.n[i + 1], c = t.n[i + 2];
      const nx = q[0] * a + q[3] * b + q[6] * c, ny = q[1] * a + q[4] * b + q[7] * c, nz = q[2] * a + q[5] * b + q[8] * c;
      const l = Math.hypot(nx, ny, nz) || 1;
      const k = (i / 3) * 2, u = uv && t.t ? t.t[k] / uv : 0, v = uv && t.t ? t.t[k + 1] / uv : 0;
      this.vertex(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14], nx / l, ny / l, nz / l, u, v);
    }
    const idx = this.idx;
    for (let k = 0; k < t.i.length; k++) idx.a[idx.n++] = base + t.i[k];
  }

  build(world: THREE.Matrix4): THREE.BufferGeometry | null {
    if (!this.idx.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.a.slice(0, this.pos.n), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.a.slice(0, this.nor.n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.a.slice(0, this.col.n), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.a.slice(0, this.uv.n), 2));
    g.setIndex(new THREE.BufferAttribute(this.idx.a.slice(0, this.idx.n), 1));
    return g.applyMatrix4(world);
  }
}

const templates = new WeakMap<THREE.BufferGeometry, { p: Float32Array; n: Float32Array; t?: Float32Array; i: Uint32Array }>();

const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(euler.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

type FloorKind = 'planks' | 'planksDark' | 'tiles' | 'checker' | 'marble' | 'carpet' | 'concrete';
type WallKind = 'plaster' | 'brick' | 'whiteBrick' | 'subway' | 'stripes';
type Surface = FloorKind | WallKind;

const REPEAT: Record<WallKind, number> = { plaster: 2.4, brick: 1.2, whiteBrick: 1.2, subway: 1.2, stripes: 1.6 }; // m per texture tile
const WALL_ROUGHNESS: Record<WallKind, number> = { plaster: 0.92, brick: 0.95, whiteBrick: 0.9, subway: 0.22, stripes: 0.8 };

const surfaces = new Map<string, THREE.CanvasTexture>();
function surfaceTexture(kind: Surface, tint = '#3a3d4a'): THREE.CanvasTexture {
  const key = kind + tint;
  const cached = surfaces.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d')!;
  const r = parkMiller(7);
  const shade = (base: number[], k: number) => `rgb(${base.map((v) => Math.round(v * k)).join(',')})`;
  if (kind === 'planks' || kind === 'planksDark') {
    const base = kind === 'planks' ? [176, 132, 86] : [92, 58, 34];
    for (let row = 0; row < 16; row++) {
      // Drawn twice, 512 px apart, so the last plank wraps onto the first: no seam.
      let x = 0;
      while (x < 512) {
        const len = 260 + r() * 300, tone = shade(base, 0.82 + r() * 0.3), grain = [0, 1, 2, 3].map(() => 4 + r() * 24);
        for (const o of [0, -512]) {
          g.fillStyle = tone;
          g.fillRect(x + o, row * 32, len, 32);
          g.globalAlpha = 0.08;
          g.fillStyle = '#000';
          for (const y of grain) g.fillRect(x + o, row * 32 + y, len, 1);
          g.globalAlpha = 1;
          g.fillStyle = shade(base, 0.45);
          g.fillRect(x + o, row * 32, 2, 32);
        }
        x += len;
      }
      g.fillStyle = shade(base, 0.4);
      g.fillRect(0, row * 32, 512, 2);
    }
  } else if (kind === 'tiles' || kind === 'checker') {
    const n = kind === 'tiles' ? 4 : 8, s = 512 / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const dark = kind === 'checker' && (i + j) % 2 === 1;
        g.fillStyle = dark ? shade([40, 40, 42], 0.9 + r() * 0.2) : shade([214, 212, 206], 0.94 + r() * 0.08);
        g.fillRect(i * s, j * s, s, s);
      }
    }
    g.fillStyle = kind === 'tiles' ? '#9a9892' : '#7a7a76';
    for (let i = 0; i <= n; i++) {
      g.fillRect(i * s - 1.5, 0, 3, 512);
      g.fillRect(0, i * s - 1.5, 512, 3);
    }
  } else if (kind === 'marble') {
    g.fillStyle = '#d6cfc1';
    g.fillRect(0, 0, 512, 512);
    g.lineWidth = 0.8;
    for (let k = 0; k < 12; k++) {
      g.strokeStyle = `rgba(120,108,96,${0.08 + r() * 0.14})`;
      g.beginPath();
      g.moveTo(r() * 512, r() * 512);
      g.bezierCurveTo(r() * 512, r() * 512, r() * 512, r() * 512, r() * 512, r() * 512);
      g.stroke();
    }
    g.fillStyle = 'rgba(90,80,70,0.35)';
    for (const p of [0, 256]) {
      g.fillRect(p, 0, 2, 512);
      g.fillRect(0, p, 512, 2);
    }
  } else if (kind === 'brick' || kind === 'whiteBrick' || kind === 'subway') {
    const per = kind === 'subway' ? 8 : 5, w = 512 / per, joint = kind === 'subway' ? 2 : 4;
    g.fillStyle = kind === 'brick' ? '#a59a8a' : kind === 'whiteBrick' ? '#c9c7c2' : '#b4b2ad';
    g.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 16; row++) {
      for (let i = -1; i <= per; i++) {
        const x = i * w + (row % 2) * (w / 2);
        const base = kind === 'brick' ? [[150, 70, 48], [128, 58, 40], [168, 92, 62], [112, 64, 50]][Math.floor(r() * 4)] : kind === 'whiteBrick' ? [240, 238, 234] : [246, 246, 243];
        g.fillStyle = shade(base, (kind === 'subway' ? 0.97 : 0.86) + r() * (kind === 'subway' ? 0.04 : 0.2));
        g.fillRect(x + joint / 2, row * 32 + joint / 2, w - joint, 32 - joint);
        if (kind !== 'subway') {
          g.fillStyle = 'rgba(0,0,0,0.06)';
          for (let s = 0; s < 14; s++) g.fillRect(x + r() * w, row * 32 + r() * 30, 2 + r() * 4, 1 + r() * 2);
        } else {
          g.fillStyle = 'rgba(255,255,255,0.5)';
          g.fillRect(x + joint, row * 32 + joint, w - 2 * joint, 3);
        }
      }
    }
  } else if (kind === 'stripes') {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? 'rgba(0,0,0,0.07)' : 'rgba(0,0,0,0)';
      g.fillRect(i * 64, 0, 64, 512);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(i * 64, 0, 1.5, 512);
    }
    g.fillStyle = 'rgba(0,0,0,0.045)';
    for (let i = 0; i < 8; i += 2) {
      for (let j = 0; j < 8; j++) {
        const x = i * 64 + 32, y = j * 64 + (i % 4 ? 32 : 0);
        g.beginPath();
        g.moveTo(x, y - 9);
        g.lineTo(x + 6, y);
        g.lineTo(x, y + 9);
        g.lineTo(x - 6, y);
        g.fill();
      }
    }
  } else if (kind === 'plaster') {
    g.fillStyle = '#f2f2f2';
    g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 70; k++) {
      const x = r() * 512, y = r() * 512, rad = 40 + r() * 90, tone = r() < 0.5 ? 'rgba(0,0,0,0.014)' : 'rgba(255,255,255,0.02)';
      for (const [ox, oy] of [[0, 0], [-512, 0], [512, 0], [0, -512], [0, 512]]) {
        const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        grad.addColorStop(0, tone);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
    }
    const img = g.getImageData(0, 0, 512, 512);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (r() - 0.5) * 6;
      for (let c = 0; c < 3; c++) img.data[i + c] += v;
    }
    g.putImageData(img, 0, 0);
  } else {
    g.fillStyle = kind === 'carpet' ? tint : '#8e8c88';
    g.fillRect(0, 0, 512, 512);
    const img = g.getImageData(0, 0, 512, 512);
    const amp = kind === 'carpet' ? 26 : 14;
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (r() - 0.5) * amp;
      for (let c = 0; c < 3; c++) img.data[i + c] += v;
    }
    g.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  surfaces.set(key, tex);
  return tex;
}

const FLOOR_ROUGHNESS: Record<FloorKind, number> = { planks: 0.5, planksDark: 0.45, tiles: 0.3, checker: 0.35, marble: 0.12, carpet: 0.95, concrete: 0.35 };

const MAX_LAMPS = 12, MAX_BLOCKS = 40;
const COOL = 0xf1f4ff, DAY = 0xdbe6ff;

interface Lamp {
  x: number;
  y: number;
  z: number;
  power: number; // cd
  colour: THREE.Color;
  range: number; // m
}

/** Interior materials only, so entering never recompiles the city's shaders. */
const LIGHT_VERTEX = /* glsl */ `
uniform mat4 uRoom;
varying vec3 vInWorld;
varying vec3 vInRoom;
varying vec3 vInRoomN;
`;
const LIGHT_FRAGMENT = /* glsl */ `
uniform vec4 uLamp[${MAX_LAMPS}];
uniform vec3 uLampColour[${MAX_LAMPS}];
uniform int uLamps;
uniform vec4 uBlock[${MAX_BLOCKS}];
uniform int uBlocks;
uniform vec4 uBox;
uniform vec3 uAmbient;
uniform float uSun;
varying vec3 vInWorld;
varying vec3 vInRoom;
varying vec3 vInRoomN;
float inPlane(float d, float facing, float r, float k) { return 1.0 - k * (1.0 - clamp(facing, 0.0, 1.0)) * (1.0 - smoothstep(0.0, r, d)); }
float inOcclusion(vec3 p, vec3 n) {
  float ao = inPlane(p.y, n.y, 0.45, 0.5) * inPlane(uBox.w - p.y, -n.y, 0.7, 0.35)
    * inPlane(p.x - uBox.x, n.x, 0.6, 0.4) * inPlane(uBox.y - p.x, -n.x, 0.6, 0.4)
    * inPlane(p.z - ${FRONT.toFixed(3)}, n.z, 0.6, 0.4) * inPlane(uBox.z - p.z, -n.z, 0.6, 0.4);
  if (n.y > 0.7 && p.y < 0.04) {
    for (int i = 0; i < ${MAX_BLOCKS}; i++) {
      if (i >= uBlocks) break;
      vec2 q = abs(p.xz - uBlock[i].xy) - uBlock[i].zw;
      ao *= 1.0 - 0.4 * (1.0 - smoothstep(-0.1, 0.4, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)));
    }
  }
  return ao;
}
`;

function lit<M extends THREE.MeshStandardMaterial>(material: M, uniforms: Record<string, THREE.IUniform>): M {
  material.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n${LIGHT_VERTEX}`).replace('#include <project_vertex>', `#include <project_vertex>
      vec4 inWorld = modelMatrix * vec4(transformed, 1.0);
      vInWorld = inWorld.xyz;
      vInRoom = (uRoom * inWorld).xyz;
      vInRoomN = mat3(uRoom) * mat3(modelMatrix) * objectNormal;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${LIGHT_FRAGMENT}`).replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      vec3 inN = normalize(vInRoomN);
      float inAO = inOcclusion(vInRoom, inN);
      reflectedLight.directDiffuse *= uSun;
      reflectedLight.directSpecular *= uSun;
      for (int i = 0; i < ${MAX_LAMPS}; i++) {
        if (i >= uLamps) break;
        vec3 toLamp = uLamp[i].xyz - vInWorld;
        float dist = length(toLamp);
        directLight.direction = normalize(mat3(viewMatrix) * toLamp);
        directLight.color = uLampColour[i] * getDistanceAttenuation(dist, uLamp[i].w, 2.0);
        RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
      }
      reflectedLight.directDiffuse *= mix(1.0, inAO, 0.6);`).replace('#include <lights_fragment_end>', `
      irradiance = uAmbient * inAO * (1.0 - 0.3 * inN.y);
      iblIrradiance *= 0.3 * inAO;
      radiance *= 0.5 * inAO;
      #include <lights_fragment_end>`);
  };
  material.customProgramCacheKey = () => 'interior';
  return material;
}

function mergeLamps(lamps: Lamp[], max: number): Lamp[] {
  const out = lamps.map((l) => ({ ...l, colour: l.colour.clone() }));
  while (out.length > max) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const d = Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y, out[i].z - out[j].z);
        if (d < bd) [bi, bj, bd] = [i, j, d];
      }
    }
    const a = out[bi], b = out.splice(bj, 1)[0], w = b.power / (a.power + b.power);
    a.x += (b.x - a.x) * w;
    a.y += (b.y - a.y) * w;
    a.z += (b.z - a.z) * w;
    a.colour.lerp(b.colour, w);
    a.power += b.power;
    a.range = Math.max(a.range, b.range) + bd / 2;
  }
  return out;
}

interface Fit {
  x0: number;
  x1: number;
  depth: number;
  height: number;
}

interface Person {
  avatar: number;
  matrix: THREE.Matrix4;
  phase: number;
}

interface Room {
  door: Door;
  fit: Fit;
  meshes: THREE.Mesh[];
  colliders: RAPIER.Collider[];
  people: Person[];
  owned: { dispose(): void }[];
  outside: { x: number; z: number };
}

interface Kit {
  fit: Fit;
  solid: Mesher;
  shiny: Mesher;
  glow: Mesher;
  glass: Mesher;
  floor: Mesher;
  wall: Mesher;
  back: Mesher;
  ceiling: Mesher;
  blocks: [number, number, number, number][];
  people: [number, number, number, number][];
  lamps: Lamp[];
  r: () => number;
}

export class Interiors {
  readonly group = new THREE.Group();
  room: Room | null = null;
  private grid = new Map<string, Door[]>();
  private buildingGrid = new Map<string, Building[]>();
  private fits = new Map<Door, Fit | null>();
  private time = 0;
  readonly light = {
    uRoom: { value: new THREE.Matrix4() },
    uLamp: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
    uLampColour: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Color()) },
    uLamps: { value: 0 },
    uBlock: { value: Array.from({ length: MAX_BLOCKS }, () => new THREE.Vector4()) },
    uBlocks: { value: 0 },
    uBox: { value: new THREE.Vector4() },
    uAmbient: { value: new THREE.Color() },
    uSun: { value: 0.12 },
  };
  readonly materials = {
    solid: lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }), this.light),
    shiny: lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.55 }), this.light),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0xdfe8ee, transparent: true, opacity: 0.12, roughness: 0.03, depthWrite: false }),
  };

  constructor(doors: Door[], buildings: Building[], private physics: Physics, private environment: Environment, private crowd: Crowd) {
    this.group.name = 'interiors';
    for (const b of buildings) {
      if (b.nc || (b.mh ?? 0) > 2.5) continue; // no walls down at street level
      const r = b.rings[0];
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        x0 = Math.min(x0, r[i]);
        x1 = Math.max(x1, r[i]);
        z0 = Math.min(z0, r[i + 1]);
        z1 = Math.max(z1, r[i + 1]);
      }
      for (let i = Math.floor(x0 / 50); i <= Math.floor(x1 / 50); i++) {
        for (let j = Math.floor(z0 / 50); j <= Math.floor(z1 / 50); j++) this.buildingGrid.set(`${i},${j}`, [...(this.buildingGrid.get(`${i},${j}`) ?? []), b]);
      }
    }
    for (const d of doors) {
      const key = `${Math.floor(d.x / 20)},${Math.floor(d.z / 20)}`;
      this.grid.set(key, [...(this.grid.get(key) ?? []), d]);
    }
  }

  get inside(): boolean {
    return !!this.room;
  }

  doorAt(x: number, z: number): Door | null {
    let best: Door | null = null, bestD = Infinity;
    const gx = Math.floor(x / 20), gz = Math.floor(z / 20);
    for (let i = gx - 1; i <= gx + 1; i++) {
      for (let j = gz - 1; j <= gz + 1; j++) {
        for (const d of this.grid.get(`${i},${j}`) ?? []) {
          const dx = x - d.x, dz = z - d.z;
          const out = dx * d.nx + dz * d.nz, side = dx * d.ux + dz * d.uz;
          if (out < 0 || out > 1.9 || Math.abs(side) > 1.1) continue;
          const dist = Math.hypot(out, side);
          if (dist < bestD && this.fitFor(d)) {
            bestD = dist;
            best = d;
          }
        }
      }
    }
    return best;
  }

  atExit(x: number, z: number): boolean {
    if (!this.room) return false;
    const [lx, lz] = toLocal(this.room.door, x, z);
    return lz < 1.9 && Math.abs(lx) < 1.3;
  }

  enter(door: Door, fromX: number, fromZ: number, avoidAvatar: number): { x: number; z: number; heading: number } | null {
    const fit = this.fitFor(door);
    if (!fit) return null;
    if (this.room) this.leave();
    const vx = -door.nx, vz = -door.nz;
    const world = new THREE.Matrix4().makeBasis(new THREE.Vector3(door.ux, 0, door.uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(vx, 0, vz));
    world.setPosition(door.x, 0, door.z);
    let seed = Math.floor(Math.abs(door.x * 73.1 + door.z * 19.7) * 100) % 2147483646 + 1;
    const kit: Kit = {
      fit, solid: new Mesher(), shiny: new Mesher(), glow: new Mesher(), glass: new Mesher(), floor: new Mesher(),
      wall: new Mesher(), back: new Mesher(), ceiling: new Mesher(), blocks: [], people: [], lamps: [],
      r: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646,
    };
    const look = shell(kit, door);
    furnish(kit, door);

    const meshes: THREE.Mesh[] = [];
    const owned: { dispose(): void }[] = [];
    const surface = (kind: Surface, roughness: number, vertexColors: boolean) => {
      const m = lit(new THREE.MeshStandardMaterial({ map: surfaceTexture(kind, look.carpet), roughness, vertexColors }), this.light);
      owned.push(m);
      return m;
    };
    for (const [mesher, material] of [
      [kit.floor, surface(look.floor, FLOOR_ROUGHNESS[look.floor], false)], [kit.wall, surface(look.finish, WALL_ROUGHNESS[look.finish], true)],
      [kit.back, look.back ? surface(look.back, WALL_ROUGHNESS[look.back], true) : null], [kit.ceiling, surface('plaster', 0.95, true)],
      [kit.solid, this.materials.solid], [kit.shiny, this.materials.shiny], [kit.glow, this.materials.glow], [kit.glass, this.materials.glass],
    ] as const) {
      const g = material && mesher.build(world);
      if (g) meshes.push(new THREE.Mesh(g, material));
    }
    const name = nameBoard(door, fit, world);
    meshes.push(name);
    owned.push(name.material, name.material.map!);
    for (const m of meshes) {
      m.matrixAutoUpdate = false;
      this.group.add(m);
    }

    const corners = [toWorld(door, fit.x0, FRONT), toWorld(door, fit.x1, FRONT), toWorld(door, fit.x1, fit.depth), toWorld(door, fit.x0, fit.depth)];
    const colliders = [
      this.physics.world.createCollider(
        RAPIER.ColliderDesc.polyline(new Float32Array(corners.flat()), new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0]))
          .setCollisionGroups(groups(GROUP.STATIC, WHEELS | GROUP.PED)),
      ),
    ];
    const angle = Math.atan2(door.uz, door.ux);
    for (const [x, z, sx, sz] of kit.blocks) {
      const [wx, wz] = toWorld(door, x, z);
      colliders.push(this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(sx / 2, sz / 2).setTranslation(wx, wz).setRotation(angle).setCollisionGroups(groups(GROUP.STATIC, GROUP.PED)),
      ));
    }
    const people: Person[] = [];
    const count = this.crowd.avatarCount;
    let next = Math.floor(kit.r() * count);
    for (const [x, z, fx, fz] of kit.people) {
      const [wx, wz] = toWorld(door, x, z);
      colliders.push(this.physics.world.createCollider(
        RAPIER.ColliderDesc.ball(0.25).setTranslation(wx, wz).setCollisionGroups(groups(GROUP.STATIC, GROUP.PED)),
      ));
      const heading = Math.atan2(door.uz * fx + vz * fz, door.ux * fx + vx * fz);
      if (next % count === avoidAvatar && count > 1) next++;
      const avatar = next++ % count;
      people.push({
        avatar, phase: kit.r(),
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(wx, 0, wz), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -heading), new THREE.Vector3(1, 1, 1)),
      });
    }
    const u = this.light;
    u.uRoom.value.copy(world).invert();
    u.uBox.value.set(fit.x0, fit.x1, fit.depth, fit.height);
    u.uAmbient.value.setHex(look.ambient[0]).multiplyScalar(look.ambient[1]);
    const lamps = mergeLamps(kit.lamps, MAX_LAMPS);
    lamps.forEach((l, i) => {
      const [wx, wz] = toWorld(door, l.x, l.z);
      u.uLamp.value[i].set(wx, l.y, wz, l.range);
      u.uLampColour.value[i].copy(l.colour).multiplyScalar(l.power);
    });
    u.uLamps.value = lamps.length;
    const blocks = [...kit.blocks].sort((a, b) => b[2] * b[3] - a[2] * a[3]).slice(0, MAX_BLOCKS);
    blocks.forEach(([x, z, sx, sz], i) => u.uBlock.value[i].set(x, z, sx / 2, sz / 2));
    u.uBlocks.value = blocks.length;
    this.room = { door, fit, meshes, colliders, people, owned, outside: { x: fromX, z: fromZ } };
    this.environment.setIndoor(true);
    const [x, z] = toWorld(door, 0, SPAWN_Z);
    return { x, z, heading: Math.atan2(vz, vx) };
  }

  leave(): { x: number; z: number; heading: number } {
    const room = this.room!;
    for (const m of room.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    for (const o of room.owned) o.dispose();
    for (const c of room.colliders) this.physics.world.removeCollider(c, false);
    this.room = null;
    this.environment.setIndoor(false);
    const d = room.door;
    return { x: room.outside.x, z: room.outside.z, heading: Math.atan2(d.nz, d.nx) };
  }

  render(dt: number, camera: THREE.Vector3) {
    this.time += dt;
    if (!this.room) return;
    for (const p of this.room.people) {
      const info = this.crowd.clip(p.avatar, 'idle');
      const d = Math.hypot(p.matrix.elements[12] - camera.x, p.matrix.elements[14] - camera.z);
      this.crowd.add(p.avatar, p.matrix, 'idle', this.time / info.duration + p.phase, d);
    }
  }

  free(x: number, z: number, dx: number, dz: number): number {
    const room = this.room;
    if (!room) return Infinity;
    const { door, fit } = room;
    const m = 0.4;
    const [lx, lz] = toLocal(door, x, z);
    const ldx = dx * door.ux + dz * door.uz, ldz = -(dx * door.nx + dz * door.nz);
    let t = Infinity;
    if (ldx > 1e-6) t = Math.min(t, (fit.x1 - m - lx) / ldx);
    if (ldx < -1e-6) t = Math.min(t, (fit.x0 + m - lx) / ldx);
    if (ldz > 1e-6) t = Math.min(t, (fit.depth - m - lz) / ldz);
    if (ldz < -1e-6) t = Math.min(t, (FRONT + m - lz) / ldz);
    return Math.max(0, t);
  }

  confine(p: THREE.Vector3) {
    const room = this.room;
    if (!room) return;
    const { door, fit } = room;
    const m = 0.4;
    const [lx, lz] = toLocal(door, p.x, p.z);
    const [x, z] = toWorld(door, Math.min(Math.max(lx, fit.x0 + m), fit.x1 - m), Math.min(Math.max(lz, FRONT + m), fit.depth - m));
    p.set(x, Math.min(Math.max(p.y, 0.5), fit.height - 0.3), z);
  }

  private fitFor(door: Door): Fit | null {
    if (this.fits.has(door)) return this.fits.get(door)!;
    const neighbours = new Set<Building>();
    for (let i = Math.floor(door.x / 50) - 1; i <= Math.floor(door.x / 50) + 1; i++) {
      for (let j = Math.floor(door.z / 50) - 1; j <= Math.floor(door.z / 50) + 1; j++) {
        for (const b of this.buildingGrid.get(`${i},${j}`) ?? []) if (b !== door.building) neighbours.add(b);
      }
    }
    const fit = fitRoom(door, [...neighbours]);
    this.fits.set(door, fit);
    return fit;
  }
}

function toLocal(d: Door, x: number, z: number): [number, number] {
  const dx = x - d.x, dz = z - d.z;
  return [dx * d.ux + dz * d.uz, -(dx * d.nx + dz * d.nz)];
}

function toWorld(d: Door, x: number, z: number): [number, number] {
  return [d.x + d.ux * x - d.nx * z, d.z + d.uz * x - d.nz * z];
}

function segmentHitsRect(ax: number, az: number, bx: number, bz: number, x0: number, x1: number, z0: number, z1: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function fitRoom(door: Door, neighbours: Building[]): Fit | null {
  if (door.style === 'street') return null;
  const b = door.building;
  const height = Math.min(door.groundH - 0.1, b.h - 0.5, 4.3);
  if (height < 2.9) return null;
  const walls: number[][] = [];
  const addWalls = (ring: number[], skip = -1) => {
    const l: number[] = [];
    for (let i = 0; i < ring.length; i += 2) l.push(...toLocal(door, ring[i], ring[i + 1]));
    for (let i = 0; i < l.length; i += 2) if (i / 2 !== skip) walls.push([l[i], l[i + 1], l[(i + 2) % l.length], l[(i + 3) % l.length]]);
  };
  b.rings.forEach((ring, r) => addWalls(ring, r === 0 ? door.edge : -1));
  for (const n of neighbours) addWalls(n.rings[0]);
  const outer = b.rings[0];
  const [wantW, wantD] = SIZE[door.style];
  const fits = (left: number, right: number, depth: number) => {
    const m = 0.08;
    if (walls.some(([ax, az, bx, bz]) => segmentHitsRect(ax, az, bx, bz, -left - m, right + m, 0.04, depth + m))) return false;
    return inRing(outer, ...toWorld(door, (right - left) / 2, depth / 2));
  };
  const maxLeft = door.along - 0.25, maxRight = door.length - door.along - 0.25;
  const sizes = [0.9, 1.3, 1.8, 2.4, 3, 3.6, 4.5, 5.5, 6.5, 8];
  let best: Fit | null = null, bestScore = 0;
  for (const l of sizes) {
    for (const r of sizes) {
      const left = Math.min(l, maxLeft), right = Math.min(r, maxRight);
      if (left < 0.9 || right < 0.9 || left + right < 3.4 || left + right > wantW + 0.01) continue;
      if ((left < l && l > sizes[0]) || (right < r && r > sizes[0])) {
        // Clipped by the wall's end: only try the clipped size once.
        if (sizes[sizes.indexOf(l) - 1] >= maxLeft || sizes[sizes.indexOf(r) - 1] >= maxRight) continue;
      }
      for (let depth = wantD; depth >= 4; depth -= 0.5) {
        const area = (left + right) * depth * (depth >= 5 ? 1 : 0.6);
        if (area <= bestScore) break;
        if (fits(left, right, depth)) {
          best = { x0: -left, x1: right, depth, height };
          bestScore = area;
          break;
        }
      }
    }
  }
  return best;
}

interface ShellLook {
  floor: FloorKind;
  carpet?: string;
  finish: WallKind;
  back?: WallKind;
  wall: number;
  backWall?: number;
  wainscot?: number;
  ceiling: number;
  beams?: number;
  cornice?: boolean;
  ambient: [number, number]; // colour, irradiance
}

const SHELLS: Record<Place, ShellLook> = {
  cafe: { floor: 'planksDark', finish: 'plaster', back: 'brick', wall: 0xd6bf92, backWall: 0xffffff, wainscot: 0x3d2716, ceiling: 0xd8c7a4, beams: 0x4a3020, ambient: [0xffc890, 0.75] },
  restaurant: { floor: 'planks', finish: 'stripes', back: 'brick', wall: 0xe8dcc6, backWall: 0xf2e6dc, wainscot: 0x5d3f27, ceiling: 0xf3eee4, cornice: true, ambient: [0xffd8b0, 0.9] },
  fastfood: { floor: 'checker', finish: 'subway', wall: 0xffffff, wainscot: 0xb5372a, ceiling: 0xf4f4f2, ambient: [0xfff2e6, 1.25] },
  bakery: { floor: 'checker', finish: 'plaster', back: 'subway', wall: 0xeee1c6, backWall: 0xf6efe0, wainscot: 0xf2f0ea, ceiling: 0xf2ece0, ambient: [0xffe6c8, 1.1] },
  jewelry: { floor: 'carpet', carpet: '#5a2e3c', finish: 'stripes', wall: 0x7a6a72, wainscot: 0x2a2427, ceiling: 0x4a4246, cornice: true, ambient: [0xffe4c8, 1.0] },
  fashion: { floor: 'planks', finish: 'plaster', back: 'whiteBrick', wall: 0xf3f1ec, backWall: 0xffffff, ceiling: 0xf5f5f3, ambient: [0xfff4ea, 1.05] },
  food: { floor: 'tiles', finish: 'plaster', wall: 0xf0efeb, ceiling: 0xf4f4f2, ambient: [0xf2f5ff, 1.3] },
  shop: { floor: 'planks', finish: 'plaster', back: 'whiteBrick', wall: 0xece6dc, backWall: 0xf4efe6, ceiling: 0xf2f0ec, ambient: [0xfff2e4, 1.05] },
  pharmacy: { floor: 'tiles', finish: 'plaster', wall: 0xf4f6f4, ceiling: 0xf6f7f6, ambient: [0xf2f6ff, 1.3] },
  bank: { floor: 'marble', finish: 'plaster', wall: 0xe8e6e0, wainscot: 0x2f3b4e, ceiling: 0xf2f2f0, cornice: true, ambient: [0xf6f4f0, 1.05] },
  service: { floor: 'checker', finish: 'plaster', wall: 0xf1ece6, ceiling: 0xf4f2ef, ambient: [0xfaf6f0, 1.05] },
  hotel: { floor: 'marble', finish: 'stripes', wall: 0xe7dcc6, wainscot: 0x4a2f1d, ceiling: 0xf0e9dc, cornice: true, ambient: [0xffdcb4, 0.85] },
  culture: { floor: 'concrete', finish: 'plaster', wall: 0xf4f3f0, ceiling: 0xf6f6f4, ambient: [0xf8f6f2, 1.0] },
  club: { floor: 'carpet', carpet: '#17151c', finish: 'brick', wall: 0x3a3044, ceiling: 0x0c0b10, ambient: [0x6a50a0, 0.3] },
  public: { floor: 'planks', finish: 'plaster', wall: 0xe9e4d8, wainscot: 0x6b5236, ceiling: 0xf0ede6, cornice: true, ambient: [0xffe4c4, 0.9] },
  plate: { floor: 'carpet', carpet: '#4a5260', finish: 'plaster', wall: 0xf1f1ef, ceiling: 0xf6f6f5, ambient: [0xf4f6fa, 1.1] },
};

function shell(k: Kit, door: Door): ShellLook {
  const { x0, x1, depth: d, height: h } = k.fit;
  const look = SHELLS[door.style as Place];
  const cx = (x0 + x1) / 2, hw = (x1 - x0) / 2, cz = (FRONT + d) / 2, hd = (d - FRONT) / 2;
  const rep = REPEAT[look.finish];
  k.floor.quad([cx, 0.012, cz], [hw, 0, 0], [0, 0, hd], [0, 1, 0], 0xffffff, 2);
  k.ceiling.quad([cx, h, cz], [hw, 0, 0], [0, 0, hd], [0, -1, 0], look.ceiling, REPEAT.plaster);
  (look.back ? k.back : k.wall).quad([cx, h / 2, d], [hw, 0, 0], [0, h / 2, 0], [0, 0, -1], look.backWall ?? look.wall, look.back ? REPEAT[look.back] : rep);
  k.wall.quad([x0, h / 2, cz], [0, h / 2, 0], [0, 0, hd], [1, 0, 0], look.wall, rep);
  k.wall.quad([x1, h / 2, cz], [0, h / 2, 0], [0, 0, hd], [-1, 0, 0], look.wall, rep);
  const low = look.wainscot ?? 0x5a5550;
  const lh = look.wainscot ? 1.05 : 0.09;
  const band = (t: number, y: number, bh: number, colour = low, front = false) => {
    k.solid.box(cx, d - t / 2, y, x1 - x0, t, bh, colour);
    k.solid.box(x0 + t / 2, cz, y, t, d - FRONT, bh, colour);
    k.solid.box(x1 - t / 2, cz, y, t, d - FRONT, bh, colour);
    if (front) k.solid.box(cx, FRONT + t / 2, y, x1 - x0, t, bh, colour);
  };
  band(0.03, 0, lh);
  if (look.wainscot) {
    band(0.06, lh, 0.05);
    const m = 0.035, ph = lh - 0.3, col = new THREE.Color(low).multiplyScalar(0.75).getHex();
    const panels = (a0: number, a1: number, put: (s: number, w: number) => void) => {
      const n = Math.max(1, Math.round((a1 - a0) / 0.9)), w = (a1 - a0) / n;
      for (let i = 0; i < n; i++) put(a0 + (i + 0.5) * w, w - 0.16);
    };
    panels(x0, x1, (s, w) => {
      for (const y of [0.15, 0.15 + ph]) k.solid.box(s, d - 0.03 - m / 2, y, w, m, m, col);
      for (const e of [-1, 1]) k.solid.box(s + e * (w / 2 - m / 2), d - 0.03 - m / 2, 0.15, m, m, ph, col);
    });
    for (const [x, sgn] of [[x0, 1], [x1, -1]] as const) {
      panels(FRONT, d, (s, w) => {
        for (const y of [0.15, 0.15 + ph]) k.solid.box(x + sgn * (0.03 + m / 2), s, y, m, w, m, col);
        for (const e of [-1, 1]) k.solid.box(x + sgn * (0.03 + m / 2), s + e * (w / 2 - m / 2), 0.15, m, m, ph, col);
      });
    }
  }
  if (look.cornice) {
    band(0.07, h - 0.09, 0.09, look.ceiling, true);
    band(0.035, h - 0.15, 0.06, look.ceiling, true);
  }
  if (look.beams) {
    for (let z = FRONT + 0.7; z < d - 0.3; z += 1.1) k.solid.box(cx, z, h - 0.2, x1 - x0, 0.16, 0.2, look.beams);
  }

  // Same window bays as the building shader draws.
  const b = door.building;
  const seed = rand(b, 5);
  const style = facadeStyle(seed);
  const { count, width } = bays(door.length, style.bayTarget);
  const shop = !!b.sh && (b.sf ?? []).includes(door.edge);
  const shopDoor = doorBay(seed, count);
  const holes: { x0: number; x1: number; y0: number; y1: number }[] = [{ x0: -0.6, x1: 0.6, y0: 0, y1: 2.42 }];
  for (let i = 0; i < count; i++) {
    const c = (i + 0.5) * width - door.along;
    const [half, y0, y1] = shop
      ? i === shopDoor ? [0.55, 0, Math.min(2.5, door.groundH - 1.1)] : [width * 0.44, 0.5, door.groundH - 1.1]
      : [(style.winW * width) / 2, 0.9, Math.min(h - 0.5, 0.9 + style.winH * style.floorH)];
    const lo = Math.max(c - half, x0 + 0.2), hi = Math.min(c + half, x1 - 0.2);
    if (hi - lo > 0.4 && y1 - y0 > 0.5) holes.push({ x0: lo, x1: hi, y0, y1: Math.min(y1, h - 0.3) });
  }
  const xs = [...new Set([x0, x1, ...holes.flatMap((o) => [o.x0, o.x1])])].filter((x) => x >= x0 && x <= x1).sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], c = xs[i + 1], mid = (a + c) / 2;
    const spans = holes.filter((o) => o.x0 <= mid && mid <= o.x1).map((o) => [o.y0, o.y1]).sort((p, q) => p[0] - q[0]);
    let y = 0;
    const wall = (ya: number, yb: number) => {
      if (yb - ya > 0.005) k.wall.quad([mid, (ya + yb) / 2, FRONT], [(c - a) / 2, 0, 0], [0, (yb - ya) / 2, 0], [0, 0, 1], look.wall, rep);
    };
    for (const [ya, yb] of spans) {
      wall(y, ya);
      y = Math.max(y, yb);
    }
    wall(y, h);
  }
  for (const o of holes) {
    const overlaps = holes.some((q) => q !== o && q.x0 < o.x1 && o.x0 < q.x1);
    const w = o.x1 - o.x0, ym = (o.y0 + o.y1) / 2, hh = (o.y1 - o.y0) / 2;
    if (!overlaps) {
      k.solid.quad([o.x0, ym, FRONT / 2 - 0.03], [0, hh, 0], [0, 0, FRONT / 2 + 0.03], [1, 0, 0], look.wall);
      k.solid.quad([o.x1, ym, FRONT / 2 - 0.03], [0, hh, 0], [0, 0, FRONT / 2 + 0.03], [-1, 0, 0], look.wall);
      k.solid.quad([(o.x0 + o.x1) / 2, o.y1, FRONT / 2 - 0.03], [w / 2, 0, 0], [0, 0, FRONT / 2 + 0.03], [0, -1, 0], look.wall);
    }
    for (const x of [o.x0, o.x1]) k.solid.box(x, FRONT + 0.02, o.y0, 0.07, 0.04, o.y1 - o.y0, 0x232426);
    k.solid.box((o.x0 + o.x1) / 2, FRONT + 0.02, o.y1 - 0.035, w + 0.07, 0.04, 0.07, 0x232426);
    if (o.y0 > 0 && (o.x0 > 0.6 || o.x1 < -0.6)) {
      k.solid.box((o.x0 + o.x1) / 2, FRONT / 2 + 0.06, o.y0 - 0.05, w + 0.12, FRONT + 0.22, 0.05, 0xb9b2a5);
      k.glass.quad([(o.x0 + o.x1) / 2, ym, 0.0], [w / 2, 0, 0], [0, hh, 0], [0, 0, 1], 0xffffff);
      const rh = Math.min(o.y0 - 0.2, 0.6), rw = Math.min(w * 0.8, 1.6);
      if (rh > 0.25 && w > 0.7) {
        const rx = (o.x0 + o.x1) / 2;
        for (let s = -rw / 2 + 0.025; s < rw / 2; s += 0.055) k.solid.box(rx + s, FRONT + 0.07, 0.12, 0.035, 0.07, rh, 0xe6e4df);
        k.shiny.geometry(CYL, at(rx + rw / 2 + 0.05, 0.17, FRONT + 0.07, 0.018, 0.1, 0.018), 0xb8b8b8);
      }
    }
    lamp(k, (o.x0 + o.x1) / 2, ym + 0.3, -0.9, (o.x1 - o.x0) * (o.y1 - o.y0) * 2.4, DAY, 9);
  }
  k.shiny.box(0, -0.04, 1.03, 0.75, 0.04, 0.04, 0x9a9da0);
  k.solid.box(0, FRONT + 0.45, 0, 1.3, 0.7, 0.022, 0x2a2624);
  return look;
}

function fitFont(g: CanvasRenderingContext2D, font: string, text: string, width: number, size: number) {
  for (; size > 12; size -= 2) {
    g.font = font.replace('{s}', String(size));
    if (g.measureText(text).width < width) break;
  }
}

function nameBoard(door: Door, fit: Fit, world: THREE.Matrix4) {
  const w = Math.min(fit.x1 - fit.x0 - 1, 3.6), h = (w * 160) / 1024;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 160;
  const g = canvas.getContext('2d')!;
  g.fillStyle = door.look.bg;
  g.fillRect(0, 0, 1024, 160);
  g.fillStyle = door.look.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  fitFont(g, door.look.font, door.name, 1024 * 0.94, 96);
  g.fillText(door.name, 512, 84);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map }));
  mesh.matrix.copy(world).multiply(at((fit.x0 + fit.x1) / 2, fit.height - 0.45 - h / 2, fit.depth - 0.03, 1, 1, 1, Math.PI));
  return mesh;
}

/** Always past the spawned player (radius 0.35). */
const entryZ = (depth: number) => Math.max(SPAWN_Z + 0.4, Math.min(ENTRY_Z, depth - 2.2));

const inEntry = (k: Kit, x: number, z: number, sx: number, sz: number) => Math.abs(x) - sx / 2 < ENTRY_X && z - sz / 2 < entryZ(k.fit.depth);

function person(k: Kit, x: number, z: number, fx: number, fz: number) {
  const { x0, x1, depth } = k.fit;
  if (x < x0 + 0.35 || x > x1 - 0.35 || z < FRONT + 0.35 || z > depth - 0.3 || inEntry(k, x, z, 0.5, 0.5)) return;
  if (k.blocks.some(([bx, bz, sx, sz]) => Math.abs(bx - x) < sx / 2 + 0.22 && Math.abs(bz - z) < sz / 2 + 0.22)) return;
  k.people.push([x, z, fx, fz]);
}

function lamp(k: Kit, x: number, y: number, z: number, power: number, colour: number, range: number) {
  k.lamps.push({ x, y, z, power, colour: new THREE.Color(colour), range });
}

function furnish(k: Kit, door: Door) {
  const { x0, x1, depth: d, height: h } = k.fit;
  const span = x1 - x0, cx = (x0 + x1) / 2, cz = d - 1.5, len = Math.min(2.4, span - 1.6);
  if (len > 0.8 && !inEntry(k, cx, cz, len, 0.6)) {
    k.solid.box(cx, cz, 0, len, 0.6, 1.01, new THREE.Color(door.look.bg).getHex());
    k.shiny.box(cx, cz - 0.03, 1.01, len + 0.06, 0.7, 0.04, 0x3a3f45);
    k.blocks.push([cx, cz, len, 0.6]);
    person(k, cx, d - 0.85, 0, -1);
    person(k, cx + 0.3, cz - 0.95, 0, 1);
  }
  // Lamps sit just above the ceiling so they never light it.
  for (let z = FRONT + 1.5; z < d - 0.4; z += 2) {
    const sx = Math.min(span - 1.5, 2.5);
    k.glow.box(cx, z, h - 0.03, sx, 0.3, 0.03, 0xf4f2ec, true);
    lamp(k, cx, h + 0.05, z, 2 + 6 * Math.sqrt(sx * 0.3), COOL, 8);
  }
}
