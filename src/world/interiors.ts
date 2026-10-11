import * as THREE from 'three';
import type { Clip, Crowd } from '../actors/crowd';
import { GROUP, RAPIER, WHEELS, groups, type Physics } from '../physics/physics';
import { rand } from './buildings';
import type { Building, SignStyle } from './cityData';
import type { Environment } from './environment';
import { bays, doorBay, facadeStyle } from './facadeLayout';
import { inRing } from './polyline';
import type { Door } from './signs';

type Place = Exclude<SignStyle, 'street'>;

/** Room wanted per kind of place: [width along the street, depth] (m), shrunk to fit the building. */
const SIZE: Record<Place, [number, number]> = {
  cafe: [9, 11], restaurant: [10, 12], fastfood: [8, 9], bakery: [6, 8], jewelry: [6, 8], fashion: [9, 12], food: [12, 14],
  shop: [7, 10], pharmacy: [7, 9], bank: [8, 10], service: [6, 8], hotel: [10, 12], culture: [11, 14], club: [11, 14], public: [10, 12],
  plate: [6, 7],
};

const FRONT = 0.12; // m into the building: inner face of the front wall, just behind the facade
const ENTRY_X = 1.05, ENTRY_Z = 2.4; // entrance kept clear of furniture: |x| < ENTRY_X, z < ENTRY_Z
const SPAWN_Z = 1.5; // m: enter() puts the player here, on the doorway's axis

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

/** Collects triangles in room space: x along the street wall (0 = the doorway), y up, z into the building. */
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

  geometry(g: THREE.BufferGeometry, m: THREE.Matrix4, colour: number) {
    let t = templates.get(g);
    if (!t) {
      const index = g.index ? (g.index.array as ArrayLike<number>) : Array.from({ length: g.getAttribute('position').count }, (_, i) => i);
      t = { p: g.getAttribute('position').array as Float32Array, n: g.getAttribute('normal').array as Float32Array, i: Uint32Array.from(index) };
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
      this.vertex(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14], nx / l, ny / l, nz / l, 0, 0);
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

const templates = new WeakMap<THREE.BufferGeometry, { p: Float32Array; n: Float32Array; i: Uint32Array }>();

const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const BALL = new THREE.IcosahedronGeometry(1, 1);
const SHADE = new THREE.ConeGeometry(0.2, 0.18, 12, 1, true);
const KNOT = new THREE.TorusKnotGeometry(0.16, 0.05, 48, 8);
const CUBE = new THREE.BoxGeometry(1, 1, 1);
const BEAM = new THREE.ConeGeometry(1, 1, 16, 1, true);
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
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shade = (base: number[], k: number) => `rgb(${base.map((v) => Math.round(v * k)).join(',')})`;
  if (kind === 'planks' || kind === 'planksDark') {
    const base = kind === 'planks' ? [176, 132, 86] : [92, 58, 34];
    for (let row = 0; row < 16; row++) {
      // Drawn from x = 0 and again shifted back 512 px, so the last plank wraps onto the first: no seam at the repeat.
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
    // 16 courses per repeat: 7.5 cm at REPEAT 1.2 m; 5 bricks (24 cm) or 8 tiles (15 cm) a course.
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
const WARM = 0xffc690, SOFT = 0xffe2c0, COOL = 0xf1f4ff, DAY = 0xdbe6ff;

interface Lamp {
  x: number;
  y: number;
  z: number;
  power: number; // cd
  colour: THREE.Color;
  range: number; // m
  shaded: boolean;
}

/** Room-local lighting for the interior materials only, so entering never recompiles the city's shaders. */
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
        float shaded = uLamp[i].w < 0.0 ? smoothstep(-0.25, 0.45, toLamp.y / dist) : 1.0; // w < 0: lampshade, lights downwards
        directLight.direction = normalize(mat3(viewMatrix) * toLamp);
        directLight.color = uLampColour[i] * shaded * getDistanceAttenuation(dist, abs(uLamp[i].w), 2.0);
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

/** Fewer lamps than fixtures: merge the closest pair until they fit the shader's budget. */
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
    a.shaded &&= b.shaded;
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
  clip: Clip;
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

interface Board {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  wall: Wall;
  glow: boolean;
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

interface Kit {
  fit: Fit;
  solid: Mesher;
  shiny: Mesher;
  glow: Mesher;
  glass: Mesher;
  beam: Mesher;
  floor: Mesher;
  wall: Mesher;
  back: Mesher;
  ceiling: Mesher;
  blocks: [number, number, number, number][];
  people: [number, number, number, number, boolean][];
  lamps: Lamp[];
  boards: Board[];
  r: () => number;
}

export class Interiors {
  readonly group = new THREE.Group();
  room: Room | null = null;
  private grid = new Map<string, Door[]>();
  private buildingGrid = new Map<string, Building[]>();
  private fits = new Map<Door, Fit | null>();
  private time = 0;
  private light = {
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
  private materials = {
    solid: lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72 }), this.light),
    shiny: lit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.16, metalness: 0.55 }), this.light),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0xdfe8ee, transparent: true, opacity: 0.12, roughness: 0.03, depthWrite: false }),
    beam: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
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
      fit, solid: new Mesher(), shiny: new Mesher(), glow: new Mesher(), glass: new Mesher(), beam: new Mesher(), floor: new Mesher(),
      wall: new Mesher(), back: new Mesher(), ceiling: new Mesher(), blocks: [], people: [], lamps: [], boards: [],
      r: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646,
    };
    const look = shell(kit, door);
    furnish(kit, door.style as Place, door);

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
      [kit.beam, this.materials.beam],
    ] as const) {
      const g = material && mesher.build(world);
      if (g) meshes.push(new THREE.Mesh(g, material));
    }
    for (const b of [...kit.boards, nameBoard(door, fit)]) {
      const m = board(b, world, this.light);
      meshes.push(m);
      owned.push(m.material, m.material.map!);
    }
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
    // Everyone a different avatar while there are enough, never the player's own.
    const count = this.crowd.avatarCount;
    let next = Math.floor(kit.r() * count);
    for (const [x, z, fx, fz, sitting] of kit.people) {
      // The seated clip is baked on a moped: hips 0.3 m behind its origin; sat 5 cm high so hands rest on a table, not in it.
      const [wx, wz] = toWorld(door, sitting ? x + fx * 0.3 : x, sitting ? z + fz * 0.3 : z);
      if (!sitting) {
        colliders.push(this.physics.world.createCollider(
          RAPIER.ColliderDesc.ball(0.25).setTranslation(wx, wz).setCollisionGroups(groups(GROUP.STATIC, GROUP.PED)),
        ));
      }
      const heading = Math.atan2(door.uz * fx + vz * fz, door.ux * fx + vx * fz);
      if (next % count === avoidAvatar && count > 1) next++;
      const avatar = next++ % count;
      people.push({
        avatar, phase: kit.r(), clip: sitting ? 'moped' : 'idle',
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(wx, sitting ? SEAT - 0.74 : 0, wz), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -heading), new THREE.Vector3(1, 1, 1)),
      });
    }
    const u = this.light;
    u.uRoom.value.copy(world).invert();
    u.uBox.value.set(fit.x0, fit.x1, fit.depth, fit.height);
    u.uAmbient.value.setHex(look.ambient[0]).multiplyScalar(look.ambient[1]);
    const lamps = mergeLamps(kit.lamps, MAX_LAMPS);
    lamps.forEach((l, i) => {
      const [wx, wz] = toWorld(door, l.x, l.z);
      u.uLamp.value[i].set(wx, l.y, wz, l.shaded ? -l.range : l.range);
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
      const info = this.crowd.clip(p.avatar, p.clip);
      const d = Math.hypot(p.matrix.elements[12] - camera.x, p.matrix.elements[14] - camera.z);
      this.crowd.add(p.avatar, p.matrix, p.clip, this.time / info.duration + p.phase, d);
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
        const area = (left + right) * depth * (depth >= 5 ? 1 : 0.6); // shallow rooms count for less
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
  back?: WallKind; // feature wall behind the counter
  wall: number;
  backWall?: number;
  wainscot?: number;
  ceiling: number;
  beams?: number;
  cornice?: boolean;
  ambient: [number, number]; // indoor bounce light: colour, irradiance
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

  // Openings in the front wall: the door, and the facade's windows (same bays as the building shader draws).
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
    if (o.y0 > 0 && (o.x0 > 0.6 || o.x1 < -0.6)) { // a window bay over the doorway gets no sill
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

type Wall = 'back' | 'left' | 'right';

function fitFont(g: CanvasRenderingContext2D, font: string, text: string, width: number, size: number) {
  for (; size > 12; size -= 2) {
    g.font = font.replace('{s}', String(size));
    if (g.measureText(text).width < width) break;
  }
}

function nameBoard(door: Door, fit: Fit): Board {
  const w = Math.min(fit.x1 - fit.x0 - 1, 3.6), h = (w * 160) / 1024;
  return {
    x: (fit.x0 + fit.x1) / 2, y: fit.height - 0.45 - h / 2, z: fit.depth - 0.03, w, h, wall: 'back', glow: true,
    draw: (g, W, H) => {
      g.fillStyle = door.look.bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = door.look.fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitFont(g, door.look.font, door.name, W * 0.94, Math.round(H * 0.6));
      g.fillText(door.name, W / 2, H * 0.525);
    },
  };
}

function board(b: Board, world: THREE.Matrix4, light: Record<string, THREE.IUniform>) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.round((1024 * b.h) / b.w);
  b.draw(canvas.getContext('2d')!, canvas.width, canvas.height);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const material = b.glow ? new THREE.MeshBasicMaterial({ map }) : lit(new THREE.MeshStandardMaterial({ map, roughness: 0.9 }), light);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), material);
  mesh.matrix.copy(world).multiply(at(b.x, b.y, b.z, 1, 1, 1, wallYaw(b.wall)));
  return mesh;
}

function label(k: Kit, x: number, y: number, z: number, w: number, h: number, text: string, bg: string, fg: string) {
  k.boards.push({
    x, y, z, w, h, wall: 'back', glow: false,
    draw: (g, W, H) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitFont(g, "700 {s}px 'Helvetica Neue', Arial, sans-serif", text, W * 0.9, Math.round(H * 0.55));
      g.fillText(text, W / 2, H * 0.53);
    },
  });
}

const AISLES = ['Groenten & fruit', 'Brood', 'Zuivel', 'Dranken', 'Snoep & koek', 'Diepvries', 'Pasta & rijst', 'Huishouden'];

function menu(k: Kit, x: number, y: number, z: number, w: number, h: number, wall: Wall, title: string, items: [string, string][], glow = false, accent = '#e8b030') {
  if (!glow) {
    const fx = wall === 'back' ? 0 : wall === 'left' ? 1 : -1;
    k.solid.box(x - fx * 0.012, z, y - h / 2 - 0.04, wall === 'back' ? w + 0.08 : 0.025, wall === 'back' ? 0.025 : w + 0.08, h + 0.08, 0x4a3020);
    x += fx * 0.004;
  }
  k.boards.push({
    x, y, z: wall === 'back' ? z - 0.016 : z, w, h, wall, glow,
    draw: (g, W, H) => {
      g.fillStyle = glow ? '#141414' : '#1f2622';
      g.fillRect(0, 0, W, H);
      const chalk = "600 {s}px 'Chalkboard SE', 'Comic Sans MS', 'Segoe Print', cursive", sans = "700 {s}px 'Helvetica Neue', Arial, sans-serif";
      if (!glow) {
        g.globalAlpha = 0.06;
        g.fillStyle = '#fff';
        for (let i = 0; i < 60; i++) g.fillRect(k.r() * W, k.r() * H, 40 + k.r() * 160, 6 + k.r() * 20);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = accent;
        g.fillRect(0, 0, W, H * 0.2);
      }
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = !glow ? '#f4f1e6' : new THREE.Color(accent).getHSL({ h: 0, s: 0, l: 0 }).l > 0.55 ? '#141414' : '#ffffff';
      fitFont(g, glow ? sans : chalk, title, W * 0.8, Math.round(H * 0.13));
      g.fillText(title, W / 2, H * 0.1);
      const cols = W / H > 2.5 ? 2 : 1, rows = Math.ceil(items.length / cols), cw = W / cols;
      const row = (H * 0.76) / rows, size = Math.round(Math.min(row * 0.62, cw * 0.075));
      items.forEach(([name, price], i) => {
        const x = cw * Math.floor(i / rows), y = H * 0.24 + row * ((i % rows) + 0.5);
        g.font = (glow ? sans : chalk).replace('{s}', String(size));
        g.textAlign = 'left';
        g.fillStyle = glow ? '#ffffff' : '#ece8dc';
        g.fillText(name, x + cw * 0.07, y);
        g.textAlign = 'right';
        g.fillStyle = glow ? accent : '#f2d27a';
        g.fillText(price, x + cw * 0.93, y);
      });
    },
  });
}

const PAINT = [0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0xe67e22, 0x8e44ad, 0xecf0f1, 0x34495e, 0xd35400, 0x16a085, 0xf5b7b1, 0x5d6d7e];
const CLOTHES = [0x1f2633, 0x2c2c2c, 0x8a7f6e, 0xd8d2c4, 0x5b6b7a, 0x7a2e2e, 0x34513c, 0xb08d57, 0xe9e4da, 0x3c3f58];
const BOOKS = [0x7a2e2e, 0x2e4a7a, 0x2f5d3a, 0x8a6d3b, 0x3b3b3b, 0xb59a6a, 0x5a3a5e, 0x9c4f2e];

const pick = (k: Kit, list: number[]) => list[Math.floor(k.r() * list.length)];

/** How deep the clear entrance reaches: ENTRY_Z, less in a shallow room, but always past the player's spawn (radius 0.35). */
const entryZ = (depth: number) => Math.max(SPAWN_Z + 0.4, Math.min(ENTRY_Z, depth - 2.2));

/** Whether an sx by sz footprint centred on (x, z) reaches into the clear entrance. */
const inEntry = (k: Kit, x: number, z: number, sx: number, sz: number) => Math.abs(x) - sx / 2 < ENTRY_X && z - sz / 2 < entryZ(k.fit.depth);

function free(k: Kit, x: number, z: number, sx: number, sz: number, margin: number): boolean {
  const { x0, x1, depth } = k.fit;
  if (x - sx / 2 < x0 + margin || x + sx / 2 > x1 - margin || z - sz / 2 < FRONT + margin || z + sz / 2 > depth - margin) return false;
  if (inEntry(k, x, z, sx, sz)) return false;
  return !k.blocks.some(([bx, bz, bsx, bsz]) => Math.abs(bx - x) < (bsx + sx) / 2 + 0.3 && Math.abs(bz - z) < (bsz + sz) / 2 + 0.3);
}

type Goods = 'grocery' | 'general' | 'pharmacy' | 'books';

const PACKS: Record<Exclude<Goods, 'books'>, number[]> = {
  grocery: [0xf2efe6, 0xe8dcc0, 0xc0392b, 0x1f5fa8, 0xf1c40f, 0x2e7d32, 0x6d4c41, 0x212121, 0xe67e22, 0x8e244d, 0x9e9e9e, 0xffffff, 0x0d47a1],
  general: [0xece6da, 0x8a7f6e, 0x34495e, 0xb08d57, 0x7a2e2e, 0x5b6b7a, 0xd8d2c4, 0x2f5d3a, 0x1f1f1f],
  pharmacy: [0xf6f6f4, 0xf6f6f4, 0xe8f0ea, 0x2e8b57, 0x3b6fb5, 0xd9e4f2, 0xc0392b],
};
const PRODUCT = new THREE.CylinderGeometry(1, 1, 1, 8);

function shelving(k: Kit, x: number, z: number, length: number, alongZ: boolean, faces: number, levels: number[], goods: Goods, density: number, frame = 0xd9d9d6) {
  const depth = faces === 0 ? 0.9 : 0.45;
  const [sx, sz] = alongZ ? [depth, length] : [length, depth];
  const top = levels[levels.length - 1] + 0.42;
  block(k, x, z, 0, sx, sz, 0.1, 0x3a3a3a);
  k.solid.box(x + (alongZ && faces ? -faces * (depth / 2 - 0.02) : 0), z + (!alongZ && faces ? -faces * (depth / 2 - 0.02) : 0), 0.1,
    alongZ ? 0.04 : length, alongZ ? length : 0.04, top - 0.1, frame);
  for (const e of [-1, 1]) {
    k.solid.box(x + (alongZ ? 0 : (e * (length - 0.04)) / 2), z + (alongZ ? (e * (length - 0.04)) / 2 : 0), 0, alongZ ? depth : 0.04, alongZ ? 0.04 : depth, top, frame);
  }
  const half = faces === 0 ? depth / 2 : depth;
  for (const side of faces === 0 ? [-1, 1] : [faces]) {
    const off = faces === 0 ? side * depth * 0.25 : 0;
    const put = (along: number, y: number, w: number, d: number, h: number, colour: number, round: boolean) => {
      const o = off + side * (half / 2 - d / 2 - 0.03);
      const [px, pz] = alongZ ? [x + o, z + along] : [x + along, z + o];
      if (round) k.solid.geometry(PRODUCT, at(px, y + h / 2, pz, w / 2, h, w / 2), colour);
      else k.solid.box(px, pz, y, alongZ ? d : w, alongZ ? w : d, h, colour);
    };
    for (const y of levels) {
      k.solid.box(x + (alongZ ? off : 0), z + (alongZ ? 0 : off), y - 0.025, alongZ ? half : length - 0.06, alongZ ? length - 0.06 : half, 0.025, frame);
      if (goods !== 'books') {
        const edge = off + side * (half / 2 + 0.006);
        k.solid.box(x + (alongZ ? edge : 0), z + (alongZ ? 0 : edge), y - 0.05, alongZ ? 0.012 : length - 0.06, alongZ ? length - 0.06 : 0.012, 0.045, goods === 'pharmacy' ? 0xe4ece6 : 0xf4f1e2);
        for (let s = -length / 2 + 0.2; s < length / 2 - 0.2; s += 0.35) {
          if (k.r() > 0.12) continue;
          k.solid.box(x + (alongZ ? edge + side * 0.006 : s), z + (alongZ ? s : edge + side * 0.006), y - 0.06, alongZ ? 0.006 : 0.09, alongZ ? 0.09 : 0.006, 0.065, pick(k, [0xf1c40f, 0xe67e22, 0xc0392b]));
        }
      }
      const room = Math.min(0.36, (levels[1] ?? y + 0.45) - levels[0] - 0.06);
      for (let s = -length / 2 + 0.06; s < length / 2 - 0.1;) {
        if (goods === 'books') {
          const w = 0.025 + k.r() * 0.04, h = room * (0.62 + k.r() * 0.35);
          if (k.r() < density) put(s + w / 2, y, w, 0.2 + k.r() * 0.05, h, pick(k, BOOKS), false);
          s += w + 0.004;
          continue;
        }
        const shape = goods === 'pharmacy' ? 0 : k.r();
        const round = shape > 0.55;
        const w = round ? 0.06 + k.r() * 0.03 : 0.05 + k.r() * 0.1;
        const h = Math.min(room, round ? (shape > 0.8 ? 0.11 : 0.2 + k.r() * 0.1) : 0.08 + k.r() * 0.2);
        const d = round ? w : Math.min(half - 0.08, 0.06 + k.r() * 0.14);
        const colour = pick(k, PACKS[goods]);
        const n = 2 + Math.floor(k.r() * 5);
        const gap = k.r() > density;
        for (let i = 0; i < n && s < length / 2 - 0.1; i++) {
          if (!gap) put(s + w / 2, y, w, d, h, colour, round);
          s += w + 0.008;
        }
        s += 0.02;
      }
    }
  }
}

function person(k: Kit, x: number, z: number, fx: number, fz: number) {
  const { x0, x1, depth } = k.fit;
  if (x < x0 + 0.35 || x > x1 - 0.35 || z < FRONT + 0.35 || z > depth - 0.3 || inEntry(k, x, z, 0.5, 0.5)) return;
  if (k.blocks.some(([bx, bz, sx, sz]) => Math.abs(bx - x) < sx / 2 + 0.22 && Math.abs(bz - z) < sz / 2 + 0.22)) return;
  if (k.people.some(([px, pz]) => Math.hypot(px - x, pz - z) < 0.6)) return;
  k.people.push([x, z, fx, fz, false]);
}

function sit(k: Kit, x: number, z: number, fx: number, fz: number, odds: number) {
  if (k.r() < odds) k.people.push([x, z, fx, fz, true]);
}

function block(k: Kit, x: number, z: number, y0: number, sx: number, sz: number, h: number, colour: number) {
  k.solid.box(x, z, y0, sx, sz, h, colour);
  k.blocks.push([x, z, sx, sz]);
}

function lamp(k: Kit, x: number, y: number, z: number, power: number, colour: number, range: number, shaded = false) {
  k.lamps.push({ x, y, z, power, colour: new THREE.Color(colour), range, shaded });
}

function pendant(k: Kit, x: number, z: number, power = 4) {
  const h = k.fit.height;
  k.solid.box(x, z, h - 0.75, 0.012, 0.012, 0.75, 0x1a1a1a);
  k.solid.geometry(SHADE, at(x, h - 0.82, z, 1, 1, 1), 0x1e2a24);
  k.glow.geometry(BALL, at(x, h - 0.88, z, 0.08, 0.08, 0.08), 0xffd9a0);
  lamp(k, x, h - 0.9, z, power, WARM, 6, true);
}

/** Lamps for flush ceiling fittings sit just above the ceiling, so they never light it. */
function ceilingLight(k: Kit, x: number, z: number, sx: number, sz: number, colour = COOL) {
  k.glow.box(x, z, k.fit.height - 0.03, sx, sz, 0.03, 0xf4f2ec, true);
  lamp(k, x, k.fit.height + 0.05, z, 2 + 6 * Math.sqrt(sx * sz), colour, 8);
}

function spot(k: Kit, x: number, z: number, r: number, colour: number, power = 2.2) {
  k.glow.geometry(CYL, at(x, k.fit.height - 0.02, z, r, 0.02, r), colour);
  lamp(k, x, k.fit.height + 0.05, z, power, colour, 5);
}

const SEAT = 0.48; // m: top of a chair's seat

function chair(k: Kit, x: number, z: number, faceX: number, faceZ: number, colour: number) {
  k.solid.box(x, z, SEAT - 0.04, 0.42, 0.42, 0.04, colour);
  k.solid.box(x - faceX * 0.19, z - faceZ * 0.19, 0.48, faceX ? 0.04 : 0.42, faceZ ? 0.04 : 0.42, 0.45, colour);
  for (const dx of [-0.17, 0.17]) for (const dz of [-0.17, 0.17]) k.solid.box(x + dx, z + dz, 0, 0.03, 0.03, 0.44, 0x2a2a2a);
}

function table(k: Kit, x: number, z: number, round: boolean, top: number, chairs: number) {
  if (round) {
    k.solid.geometry(CYL, at(x, 0.75, z, 0.36, 0.035, 0.36), top);
    k.solid.geometry(CYL, at(x, 0.37, z, 0.035, 0.74, 0.035), 0x222222);
    k.solid.geometry(CYL, at(x, 0.015, z, 0.22, 0.03, 0.22), 0x222222);
  } else {
    k.solid.box(x, z, 0.72, 0.8, 0.8, 0.04, top);
    for (const dx of [-0.35, 0.35]) for (const dz of [-0.35, 0.35]) k.solid.box(x + dx, z + dz, 0, 0.04, 0.04, 0.72, 0x2a2a2a);
  }
  chair(k, x - 0.62, z, 1, 0, chairs);
  chair(k, x + 0.62, z, -1, 0, chairs);
  k.blocks.push([x, z, 1.6, 0.8]);
}

function seatTable(k: Kit, x: number, z: number, odds: number) {
  sit(k, x - 0.62, z, 1, 0, odds);
  sit(k, x + 0.62, z, -1, 0, odds);
}

function bottles(k: Kit, x0: number, x1: number, y: number, z: number) {
  for (let x = x0; x < x1; x += 0.09 + k.r() * 0.05) {
    const hgt = 0.22 + k.r() * 0.12;
    k.shiny.geometry(CYL, at(x, y + hgt / 2, z, 0.035, hgt, 0.035), pick(k, [0x2f5d3a, 0x5a3a1e, 0xc9d6d0, 0x7a2e2e, 0x8a6d3b, 0x1f2e2a]));
  }
}

function plant(k: Kit, x: number, z: number, big = true) {
  const s = big ? 1 : 0.6;
  k.solid.geometry(CYL, at(x, 0.25 * s, z, 0.22 * s, 0.5 * s, 0.22 * s), 0x8a8580);
  k.solid.geometry(BALL, at(x, 0.95 * s, z, 0.42 * s, 0.6 * s, 0.42 * s), 0x2f5a2c);
  k.blocks.push([x, z, 0.5 * s, 0.5 * s]);
}

function counter(k: Kit, x: number, z: number, length: number, front: number, top: number, h: number, depth: number) {
  block(k, x, z, 0, length, depth, h - 0.04, front);
  k.shiny.box(x, z - 0.03, h - 0.04, length + 0.06, depth + 0.1, 0.04, top);
}

function till(k: Kit, x: number, z: number, y: number) {
  k.solid.box(x, z, y, 0.32, 0.22, 0.08, 0x2a2a2a);
  k.solid.box(x, z + 0.05, y + 0.08, 0.04, 0.04, 0.18, 0x2a2a2a);
  k.glow.box(x, z + 0.04, y + 0.22, 0.3, 0.02, 0.2, 0x7fa7c9);
}

function picture(k: Kit, x: number, z: number, y: number, w: number, h: number, wall: Wall, frame: number) {
  const along = wall === 'back';
  const nx = wall === 'left' ? 1 : wall === 'right' ? -1 : 0, nz = along ? -1 : 0;
  k.solid.box(x, z, y - h / 2, along ? w + 0.1 : 0.04, along ? 0.04 : w + 0.1, h + 0.1, frame);
  k.solid.quad([x + nx * 0.025, y, z + nz * 0.025], along ? [w / 2, 0, 0] : [0, 0, w / 2], [0, h / 2, 0], [nx, 0, nz], pick(k, [0xe9e1d0, 0x2b2b2b, 0x9c3b2b, 0x2e4a7a, 0xd9b44a]));
  for (let i = 0; i < 3; i++) {
    const hw = w * (0.08 + k.r() * 0.18), hh = h * (0.08 + k.r() * 0.18);
    const off = 0.004 * (i + 1);
    k.solid.quad([x + nx * (0.025 + off) + (along ? (k.r() - 0.5) * (w - 2 * hw) : 0), y + (k.r() - 0.5) * (h - 2 * hh), z + nz * (0.025 + off) + (along ? 0 : (k.r() - 0.5) * (w - 2 * hw))],
      along ? [hw, 0, 0] : [0, 0, hw], [0, hh, 0], [nx, 0, nz], pick(k, PAINT));
  }
}

/** Room coordinates of a point `out` m in front of a wall, `s` m along it. */
const onWall = (k: Kit, wall: Wall, s: number, out: number): [number, number] =>
  wall === 'back' ? [s, k.fit.depth - out] : wall === 'left' ? [k.fit.x0 + out, s] : [k.fit.x1 - out, s];

function wallBox(m: Mesher, k: Kit, wall: Wall, s: number, out: number, y: number, w: number, t: number, h: number, colour: number) {
  const [x, z] = onWall(k, wall, s, out);
  m.box(x, z, y, wall === 'back' ? w : t, wall === 'back' ? t : w, h, colour);
}

const wallYaw = (wall: Wall) => (wall === 'back' ? Math.PI : wall === 'left' ? Math.PI / 2 : -Math.PI / 2);

function clock(k: Kit, wall: Wall, s: number, y: number) {
  const ry = wallYaw(wall);
  const [x, z] = onWall(k, wall, s, 0.03), [fx, fz] = onWall(k, wall, s, 0.052);
  k.solid.geometry(CYL, at(x, y, z, 0.17, 0.04, 0.17, ry, Math.PI / 2), 0x1e1e1e);
  k.solid.geometry(CYL, at(fx, y, fz, 0.15, 0.004, 0.15, ry, Math.PI / 2), 0xf4f2ec);
  const t = k.r() * 12;
  for (const [len, a, w] of [[0.085, (t / 12) * Math.PI * 2, 0.014], [0.125, (t % 1) * Math.PI * 2, 0.008]]) {
    const [hx, hz] = onWall(k, wall, s, 0.058);
    k.solid.geometry(CUBE, at(hx, y, hz, 1, 1, 1, ry, 0, -a).multiply(at(0, len / 2 - 0.015, 0, w, len, 0.004)), 0x161616);
  }
}

function staffDoor(k: Kit, wall: Wall, s: number, colour: number) {
  wallBox(k.solid, k, wall, s, 0.03, 0, 1.04, 0.06, 2.17, 0xe8e4dc);
  wallBox(k.solid, k, wall, s, 0.045, 0, 0.9, 0.04, 2.1, colour);
  wallBox(k.shiny, k, wall, s + (wall === 'right' ? -0.34 : 0.34), 0.08, 1.0, 0.13, 0.03, 0.025, 0xb8b8b8);
  wallBox(k.solid, k, wall, s, 0.068, 1.55, 0.24, 0.006, 0.08, 0xf4f4f2);
  wallBox(k.solid, k, wall, s, 0.072, 1.575, 0.16, 0.004, 0.03, 0x2a2a2a);
}

function beer(k: Kit, x: number, z: number, y: number) {
  k.solid.box(x, z, y, 0.1, 0.1, 0.004, pick(k, [0xf2efe6, 0xc0392b, 0x1f5fa8]));
  if (k.r() < 0.6) {
    k.solid.geometry(CYL, at(x, y + 0.008, z, 0.028, 0.008, 0.028), 0xd8dde0);
    k.shiny.geometry(CYL, at(x, y + 0.04, z, 0.006, 0.06, 0.006), 0xd8dde0);
    k.solid.geometry(BALL, at(x, y + 0.11, z, 0.043, 0.045, 0.043), pick(k, [0x9a4f1c, 0xb8761f, 0x5a2a12]));
    k.solid.geometry(CYL, at(x, y + 0.156, z, 0.036, 0.014, 0.036), 0xf6f0e0);
  } else {
    k.solid.geometry(CYL, at(x, y + 0.075, z, 0.032, 0.15, 0.032), pick(k, [0xd9a034, 0xe0b048, 0x3a1c0e]));
    k.solid.geometry(CYL, at(x, y + 0.16, z, 0.034, 0.02, 0.034), 0xf6f0e0);
  }
}

function taps(k: Kit, x: number, z: number, y: number, n: number) {
  const w = 0.16 * n + 0.1;
  k.shiny.box(x, z - 0.06, y, w + 0.06, 0.16, 0.015, 0x6a6d70);
  for (const e of [-1, 1]) k.shiny.box(x + (e * w) / 2, z + 0.04, y, 0.05, 0.05, 0.44, 0xc8ccd0);
  k.shiny.box(x, z + 0.04, y + 0.36, w + 0.05, 0.08, 0.08, 0xc8ccd0);
  for (let i = 0; i < n; i++) {
    const tx = x - w / 2 + 0.13 + i * 0.16;
    k.shiny.box(tx, z - 0.03, y + 0.3, 0.025, 0.08, 0.06, 0xc8ccd0);
    k.solid.box(tx, z + 0.04, y + 0.44, 0.032, 0.032, 0.17, pick(k, [0x1a1a1a, 0xc0392b, 0x1f3f7a, 0xd9a034]));
  }
}

function candle(k: Kit, x: number, z: number, y: number) {
  k.glass.geometry(CYL, at(x, y + 0.04, z, 0.04, 0.08, 0.04), 0xffffff);
  k.solid.geometry(CYL, at(x, y + 0.025, z, 0.03, 0.05, 0.03), 0xf2e8d0);
  k.glow.geometry(BALL, at(x, y + 0.065, z, 0.008, 0.016, 0.008), 0xffc060);
}

function setting(k: Kit, x: number, z: number, y: number, kind: 'cafe' | 'restaurant' | 'fastfood') {
  if (kind === 'cafe') {
    if (k.r() < 0.6) beer(k, x + 0.14, z + 0.08, y);
    if (k.r() < 0.4) beer(k, x - 0.13, z - 0.1, y);
    if (k.r() < 0.5) candle(k, x, z, y);
  } else if (kind === 'restaurant') {
    k.solid.box(x, z, y - 0.215, 0.92, 0.92, 0.25, 0xf6f4ee);
    for (const s of [-1, 1]) {
      k.solid.geometry(CYL, at(x + s * 0.24, y + 0.041, z, 0.12, 0.012, 0.12), 0xffffff);
      k.shiny.box(x + s * 0.24, z + 0.16, y + 0.035, 0.18, 0.015, 0.004, 0xb8b8b8);
      k.solid.box(x + s * 0.24, z - 0.17, y + 0.035, 0.1, 0.1, 0.02, pick(k, [0x7a2e2e, 0x2f3b4e, 0xe9e4da]));
      k.glass.geometry(BALL, at(x + s * 0.12, y + 0.16, z + 0.2, 0.035, 0.045, 0.035), 0xffffff);
      k.shiny.geometry(CYL, at(x + s * 0.12, y + 0.07, z + 0.2, 0.004, 0.1, 0.004), 0xd8dde0);
    }
    candle(k, x, z, y + 0.035);
  } else {
    for (const s of k.r() < 0.5 ? [-1, 1] : [k.r() < 0.5 ? -1 : 1]) {
      k.solid.box(x + s * 0.2, z, y, 0.34, 0.26, 0.012, pick(k, [0x8a2a22, 0x2a2a2a, 0x2e5d8a]));
      k.solid.geometry(CYL, at(x + s * 0.27, y + 0.08, z + 0.05, 0.035, 0.15, 0.035), pick(k, [0xc0392b, 0xf2efe6]));
      k.solid.box(x + s * 0.15, z - 0.04, y + 0.012, 0.09, 0.05, 0.09, 0xc0392b);
      k.solid.box(x + s * 0.15, z - 0.04, y + 0.1, 0.07, 0.035, 0.04, 0xf1c40f);
    }
  }
}

function stanchions(k: Kit, posts: [number, number][], belt: number) {
  for (const [x, z] of posts) {
    k.shiny.geometry(CYL, at(x, 0.015, z, 0.15, 0.03, 0.15), 0xc9a04a);
    k.shiny.geometry(CYL, at(x, 0.48, z, 0.022, 0.96, 0.022), 0xc9a04a);
  }
  for (let i = 0; i + 1 < posts.length; i++) {
    const [ax, az] = posts[i], [bx, bz] = posts[i + 1], len = Math.hypot(bx - ax, bz - az);
    k.solid.geometry(CUBE, at((ax + bx) / 2, 0.88, (az + bz) / 2, len, 0.05, 0.008, -Math.atan2(bz - az, bx - ax)), belt);
  }
}

function deskLamp(k: Kit, x: number, z: number, y: number) {
  k.shiny.box(x, z, y, 0.18, 0.12, 0.02, 0xc9a04a);
  k.shiny.geometry(CYL, at(x, y + 0.17, z, 0.01, 0.32, 0.01), 0xc9a04a);
  k.solid.geometry(CYL, at(x, y + 0.34, z, 0.07, 0.24, 0.07, Math.PI / 2, Math.PI / 2), 0x1f5a3a);
  k.glow.box(x, z, y + 0.295, 0.2, 0.08, 0.008, 0xffe0a0);
  lamp(k, x, y + 0.28, z, 1.2, WARM, 3.5, true);
}

function furnish(k: Kit, style: Place, door: Door) {
  const { x0, x1, depth: d, height: h } = k.fit;
  const span = x1 - x0, cx = (x0 + x1) / 2;
  const back = d - 0.45;

  switch (style) {
    case 'cafe':
    case 'restaurant':
    case 'fastfood': {
      const cafe = style === 'cafe', fast = style === 'fastfood';
      const barZ = d - 1.55, barL = Math.min(span - 1.2, 6);
      counter(k, cx, barZ, barL, cafe ? 0x3a2414 : fast ? 0xb5372a : 0x5d3f27, cafe ? 0x1b120c : 0x2a2a2a, 1.08, 0.6);
      if (fast) {
        menu(k, cx, h - 1.45, d - 0.03, Math.min(barL, 3.2), 0.72, 'back', 'MENU', [['Friet klein', '3,20'], ['Friet groot', '4,10'], ['Bicky burger', '4,80'],
          ['Frikandel', '3,10'], ['Stoofvleessaus', '1,90'], ['Cola', '2,50']], true, door.look.bg);
        for (let x = cx - barL / 2 + 0.4; x < cx + barL / 2 - 0.3; x += 1.2) till(k, x, barZ, 1.08);
      } else {
        for (const y of [1.25, 1.7, 2.15]) {
          if (y > h - 1.4) continue;
          k.solid.box(cx, d - 0.15, y - 0.03, barL, 0.28, 0.03, 0x2a1a0e);
          bottles(k, cx - barL / 2 + 0.1, cx + barL / 2 - 0.1, y, d - 0.15);
        }
        taps(k, cx + Math.min(0.9, barL / 4), barZ + 0.05, 1.08, cafe ? 4 : 2);
        for (let x = cx - barL / 2 + 0.35; x < cx - 0.2; x += 0.55 + k.r() * 0.6) beer(k, x, barZ - 0.2, 1.08);
        if (barZ - 1.0 > entryZ(d) + 0.6) {
          const [title, items]: [string, [string, string][]] = cafe
            ? ['BIEREN', [['De Koninck', '2,90'], ['Duvel', '4,20'], ['Westmalle Tripel', '4,50'], ['Rochefort 8', '4,80'], ['Seef', '3,60'], ['Jenever', '3,20'], ['Koffie', '2,60']]]
            : ['MENU', [['Stoofvlees met friet', '19,50'], ['Mosselen natuur', '26,00'], ['Garnaalkroketten', '16,50'], ['Vol-au-vent', '18,00'], ['Waterzooi', '21,00'], ['Dame blanche', '8,50']]];
          menu(k, x0 + 0.03, 1.78, barZ - 1.0, 0.95, 0.75, 'left', title, items);
        }
        for (let z = 2.3; z < barZ - 2.1; z += 1.9) picture(k, x1 - 0.02, z, 1.8, 0.5, 0.62, 'right', pick(k, [0x2a1a0e, 0xb08d57, 0x1a1a1a]));
        if (h > 3) clock(k, 'left', barZ + 0.55, Math.min(2.3, h - 0.55));
        if (d > 4.5) staffDoor(k, 'right', d - 0.68, cafe ? 0x3d2716 : 0x5d3f27);
      }
      person(k, cx + (k.r() - 0.5) * (barL - 1), d - 0.85, 0, -1);
      if (!fast) {
        for (let x = cx - barL / 2 + 0.4; x < cx + barL / 2 - 0.2; x += 0.75) {
          if (inEntry(k, x, barZ - 0.65, 0.36, 0.36)) continue;
          k.solid.geometry(CYL, at(x, 0.74, barZ - 0.65, 0.17, 0.06, 0.17), cafe ? 0x5a1e1e : 0x2a2a2a);
          k.solid.geometry(CYL, at(x, 0.37, barZ - 0.65, 0.03, 0.74, 0.03), 0x1e1e1e);
          k.blocks.push([x, barZ - 0.65, 0.36, 0.36]);
        }
      }
      for (let i = 0, n = 1 + Math.floor(k.r() * 2); i < n; i++) person(k, cx + (k.r() - 0.5) * (barL - 1), barZ - 1.15, 0, 1);
      const top = cafe ? 0x4a2f1c : style === 'restaurant' ? 0xf2efe8 : 0xdedad2;
      for (let z = FRONT + 1.3; z < barZ - 1.9; z += 1.9) {
        for (let x = x0 + 1.05; x < x1 - 0.9; x += 2.0) {
          if (!free(k, x, z, 1.7, 0.9, 0.15)) continue;
          table(k, x, z, cafe, top, cafe ? 0x3a2a1c : fast ? 0xb5372a : 0x5d3f27);
          setting(k, x, z, cafe ? 0.768 : 0.76, cafe ? 'cafe' : fast ? 'fastfood' : 'restaurant');
          seatTable(k, x, z, fast ? 0.3 : 0.45);
          if (!fast) pendant(k, x, z);
        }
      }
      if (fast) {
        for (let x = cx - barL / 2 + 0.6; x < cx + barL / 2; x += 1.4) ceilingLight(k, x, barZ - 0.6, 0.9, 0.3);
        for (let z = FRONT + 1.5; z < barZ - 1; z += 2.4) ceilingLight(k, cx, z, Math.min(span - 1, 3), 0.25);
      } else {
        for (const x of [cx - barL / 2 + 0.4, cx + barL / 2 - 0.4]) pendant(k, x, barZ);
      }
      if (span > 6) plant(k, x0 + 0.45, FRONT + 0.5);
      break;
    }
    case 'food': {
      const z0 = 3.0, z1 = d - 1.9, brand = new THREE.Color(door.look.bg).getHex();
      let aisle = Math.floor(k.r() * AISLES.length);
      const len = z1 - z0;
      const levels = [0.15, 0.55, 0.95, 1.35, 1.7];
      if (len > 1.5) {
        for (let x = x0 + 1.9; x < x1 - 1.1; x += 2.3) {
          if (Math.abs(x) < 0.9) continue;
          shelving(k, x, (z0 + z1) / 2, len, true, 0, levels, 'grocery', 0.94);
          ceilingLight(k, x - 1.15, (z0 + z1) / 2, 0.15, len);
          for (const e of [-0.4, 0.4]) k.solid.box(x - 1.15 + e, z0 + 0.4, h - 0.62, 0.008, 0.008, 0.62, 0x9a9a9a);
          k.solid.box(x - 1.15, z0 + 0.4, h - 0.86, 1.0, 0.03, 0.26, brand);
          label(k, x - 1.15, h - 0.73, z0 + 0.38, 0.96, 0.22, AISLES[aisle++ % AISLES.length], door.look.bg, door.look.fg);
        }
        shelving(k, x0 + 0.25, (2.6 + z1) / 2, z1 - 2.6, true, 1, levels, 'grocery', 0.94);
        shelving(k, x1 - 0.25, (2.6 + z1) / 2, z1 - 2.6, true, -1, levels, 'grocery', 0.94);
      }
      const fl = span - 0.8;
      block(k, cx, back - 0.05, 0, fl, 0.8, 0.25, 0xe9e9e6);
      k.solid.box(cx, back - 0.05, 2.0, fl, 0.8, 0.2, 0xe9e9e6);
      k.glow.quad([cx, 1.12, d - 0.1], [fl / 2, 0, 0], [0, 0.88, 0], [0, 0, -1], 0xdde8f2);
      for (const y of [0.3, 0.75, 1.2, 1.65]) {
        k.shiny.box(cx, d - 0.45, y - 0.02, fl, 0.6, 0.02, 0xb0b4b8);
        for (let x = cx - fl / 2 + 0.06; x < cx + fl / 2 - 0.05; x += 0.085) {
          if (k.r() < 0.85) k.solid.geometry(CYL, at(x, y + 0.13, d - 0.62, 0.032, 0.26, 0.032), pick(k, [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0xecf0f1, 0x2c2c2c]));
        }
      }
      k.glass.quad([cx, 1.12, back - 0.46], [fl / 2, 0, 0], [0, 0.88, 0], [0, 0, -1], 0xffffff);
      const side = x1 > 3.2 ? 1 : x0 < -3.2 ? -1 : 0;
      if (side) {
        block(k, side * 2.3, 1.75, 0, 0.7, 1.5, 0.88, 0x3a3f45);
        k.solid.box(side * 2.3, 1.75, 0.88, 0.55, 1.4, 0.03, 0x1a1a1a);
        till(k, side * 2.3 + side * 0.2, 2.3, 0.91);
        person(k, side * 2.95, 2.1, -side, 0);
        person(k, side * 1.65, 1.5, 0, 1);
      }
      for (let i = 0; i < 3; i++) {
        const aisle = Math.floor(k.r() * Math.max(1, span / 2.3));
        person(k, aisle === 0 ? x0 + 0.96 : x0 + 0.75 + 2.3 * aisle, z0 + 0.3 + k.r() * Math.max(0.3, len - 0.6), k.r() < 0.5 ? 1 : -1, 0);
      }
      for (let z = FRONT + 1.2; z < 2.8; z += 1.3) ceilingLight(k, 0, z, 1.6, 0.18);
      for (let i = 0; i < 6; i++) {
        k.solid.box(-1.4, FRONT + 0.6, i * 0.075, 0.45, 0.33, 0.065, i % 2 ? 0xc0392b : 0xb03326);
      }
      k.solid.box(-1.4, FRONT + 0.6, 0.45, 0.03, 0.3, 0.06, 0x1a1a1a);
      break;
    }
    case 'fashion': {
      const rail = (x: number, z0: number, z1: number) => {
        const len = z1 - z0, zc = (z0 + z1) / 2;
        for (const z of [z0 + 0.05, z1 - 0.05]) k.shiny.geometry(CYL, at(x, 0.8, z, 0.018, 1.6, 0.018), 0xb8b8b8);
        k.shiny.box(x, zc, 1.58, 0.03, len, 0.03, 0xc8c8c8);
        for (let z = z0 + 0.12; z < z1 - 0.1; z += 0.07 + k.r() * 0.05) {
          const long = 0.55 + k.r() * 0.4, c = pick(k, CLOTHES);
          k.solid.box(x, z, 1.47 - long, 0.46, 0.03, long, c);
          k.solid.box(x, z, 1.47, 0.34, 0.03, 0.06, c);
          k.shiny.box(x, z, 1.53, 0.02, 0.01, 0.06, 0x9a9a9a);
        }
        k.blocks.push([x, zc, 0.6, len]);
      };
      if (d - 1.3 > 3) {
        rail(x0 + 0.4, 2.6, d - 1.3);
        rail(x1 - 0.4, 2.6, d - 1.3);
        // The middle rails start further in: only where that still leaves a rail.
        if (span > 6.5 && d - 2.2 > 3.6) for (const x of [-1.6, 1.6]) if (x > x0 + 1.8 && x < x1 - 1.8) rail(x, 3.2, Math.min(d - 2.2, 7));
      }
      const mannequin = (x: number, z: number) => {
        const c = pick(k, CLOTHES);
        k.solid.geometry(CYL, at(x, 0.02, z, 0.2, 0.04, 0.2), 0x2a2a2a);
        k.solid.box(x, z, 0.1, 0.24, 0.16, 0.8, pick(k, CLOTHES));
        k.solid.box(x, z, 0.9, 0.38, 0.22, 0.58, c);
        k.solid.geometry(BALL, at(x, 1.62, z, 0.11, 0.13, 0.11), 0xe9e6e0);
        k.blocks.push([x, z, 0.5, 0.4]);
      };
      if (x0 < -2.2) mannequin(x0 + 1.2, FRONT + 0.9);
      if (x1 > 2.2) mannequin(x1 - 1.2, FRONT + 0.9);
      counter(k, cx, d - 1.4, Math.min(1.8, span - 2), 0xf4f2ee, 0x1e1e1e, 1.0, 0.6);
      till(k, cx + 0.4, d - 1.4, 1.0);
      person(k, cx, d - 0.75, 0, -1);
      person(k, x0 + 1.15, 3.2 + k.r() * Math.max(0, d - 5), -1, 0);
      k.shiny.box(x1 - 0.04, d - 0.9, 0.1, 0.02, 0.7, 1.9, 0xd8dde0);
      if (free(k, x0 + 0.6, d - 0.6, 1.1, 1.05, 0.02)) {
        k.solid.box(x0 + 1.13, d - 0.55, 0, 0.04, 1.05, 2.15, 0xece8e0);
        k.shiny.box(x0 + 0.57, d - 1.08, 2.08, 1.1, 0.02, 0.02, 0xb8b8b8);
        const curtain = pick(k, [0x3a3f58, 0x7a2e2e, 0x8a7f6e, 0x2c2c2c]);
        for (let i = 0; i < 9; i++) k.solid.box(x0 + 0.1 + i * 0.115, d - 1.07 + (i % 2) * 0.03, 0.12, 0.12, 0.03, 1.94, curtain);
        k.blocks.push([x0 + 0.6, d - 0.6, 1.1, 1.05]);
      }
      const tz = (entryZ(d) + d - 1.7) / 2;
      if (free(k, cx, tz, 1.3, 0.75, 0.35)) {
        block(k, cx, tz, 0.7, 1.3, 0.75, 0.04, 0xd8c8a8);
        for (const dx of [-0.6, 0.6]) for (const dz of [-0.32, 0.32]) k.solid.box(cx + dx, tz + dz, 0, 0.04, 0.04, 0.7, 0x2a2a2a);
        for (let i = 0; i < 8; i++) {
          const sx = cx - 0.46 + (i % 4) * 0.31, sz = tz + (i < 4 ? -0.17 : 0.17), c = pick(k, CLOTHES);
          for (let j = 0, n = 2 + Math.floor(k.r() * 4); j < n; j++) k.solid.box(sx, sz, 0.74 + j * 0.034, 0.27, 0.22, 0.03, j % 2 ? c : new THREE.Color(c).multiplyScalar(0.88).getHex());
        }
      }
      for (let x = x0 + 1; x < x1 - 0.5; x += 1.8) for (let z = FRONT + 1.2; z < d - 0.6; z += 2) spot(k, x, z, 0.09, 0xfff6e6);
      break;
    }
    case 'bakery': {
      const cz = Math.max(d - 2.2, entryZ(d) + 0.35), cl = span - 1.0; // a shallow room's counter goes back, clear of the entrance
      counter(k, cx, cz, cl, 0xf2efe8, 0x8a6d3b, 0.9, 0.7);
      k.glow.box(cx, cz, 0.93, cl - 0.1, 0.55, 0.02, 0xfff1d6);
      for (const tray of [0.97, 1.17]) {
        for (let x = cx - cl / 2 + 0.12; x < cx + cl / 2 - 0.1; x += 0.13) {
          k.solid.geometry(BALL, at(x, tray + 0.03, cz - 0.1 + (tray > 1 ? 0.12 : -0.05), 0.055, 0.03, 0.05), pick(k, [0xb8762a, 0xd9a24a, 0x7a3e1a, 0xe8c9a0, 0xc7586a]));
        }
      }
      k.solid.box(cx, cz, 1.13, cl - 0.1, 0.55, 0.015, 0xd0d0d0);
      k.glass.quad([cx, 1.2, cz - 0.34], [cl / 2, 0, 0], [0, 0.28, 0], [0, 0, -1], 0xffffff);
      k.glass.quad([cx, 1.48, cz], [cl / 2, 0, 0], [0, 0, 0.34], [0, 1, 0], 0xffffff);
      for (const y of [0.95, 1.4, 1.85]) {
        k.solid.box(cx, d - 0.22, y - 0.03, span - 0.6, 0.4, 0.03, 0x8a6d3b);
        for (let x = cx - span / 2 + 0.45; x < cx + span / 2 - 0.4; x += 0.3) {
          k.solid.geometry(BALL, at(x, y + 0.06, d - 0.22, 0.13, 0.07, 0.09), pick(k, [0xa0612a, 0x8a4f22, 0xc98a45, 0x6b3a1a]));
        }
      }
      person(k, cx, cz + 1.0, 0, -1);
      person(k, cx + (k.r() - 0.5) * 1.5, cz - 1.0, 0, 1);
      for (let x = cx - cl / 2 + 0.6; x < cx + cl / 2; x += 1.4) pendant(k, x, cz);
      if (cz - FRONT > 2.4) {
        menu(k, x0 + 0.03, 1.7, (FRONT + cz) / 2 + 0.2, 0.8, 0.62, 'left', 'VANDAAG', [['Grijs brood', '3,40'], ['Pistolets', '0,70'], ['Croissant', '1,40'],
          ['Antwerpse handjes', '1,20'], ['Rijsttaart', '3,10']]);
      }
      if (h > 3.1) clock(k, 'right', cz + 0.3, 2.2);
      break;
    }
    case 'jewelry': {
      const caseAt = (x: number, z: number, sx: number, sz: number) => {
        block(k, x, z, 0, sx, sz, 0.9, 0x2e2a2d);
        k.glow.box(x, z, 0.9, sx - 0.04, sz - 0.04, 0.015, 0x3a3236);
        for (let i = 0; i < sx * sz * 40; i++) {
          k.glow.box(x + (k.r() - 0.5) * (sx - 0.1), z + (k.r() - 0.5) * (sz - 0.1), 0.92, 0.025, 0.025, 0.012, k.r() < 0.6 ? 0xf2d27a : 0xf4f4f4);
        }
        k.glass.quad([x, 1.25, z], [sx / 2, 0, 0], [0, 0, sz / 2], [0, 1, 0], 0xffffff);
        for (const s of [-1, 1]) {
          k.glass.quad([x, 1.07, z + (s * sz) / 2], [sx / 2, 0, 0], [0, 0.18, 0], [0, 0, s], 0xffffff);
          k.glass.quad([x + (s * sx) / 2, 1.07, z], [0, 0.18, 0], [0, 0, sz / 2], [s, 0, 0], 0xffffff);
        }
      };
      if (d > 5) {
        caseAt(x0 + 0.35, (2.6 + d - 1.5) / 2, 0.55, d - 4.1);
        caseAt(x1 - 0.35, (2.6 + d - 1.5) / 2, 0.55, d - 4.1);
      }
      if (span > 4.5 && d > 6) caseAt(cx, (d + 2.4) / 2 - 0.4, 0.8, 0.8);
      counter(k, cx, d - 1.2, Math.min(2, span - 2), 0x1c1a1d, 0x0e0e0e, 1.0, 0.6);
      person(k, cx, d - 0.6, 0, -1);
      person(k, cx + 0.5, d - 2.0, 0, 1);
      for (let x = x0 + 0.8; x < x1 - 0.3; x += 1.5) for (let z = FRONT + 1.5; z < d - 0.3; z += 1.8) spot(k, x, z, 0.06, 0xfff1d0, 3.2);
      break;
    }
    case 'pharmacy':
    case 'shop': {
      const pharmacy = style === 'pharmacy';
      const goods: Goods = pharmacy ? 'pharmacy' : 'general';
      const frame = pharmacy ? 0xf2f2f0 : 0xb08d57;
      const levels = [0.4, 0.85, 1.3, 1.75].filter((y) => y < h - 1.5);
      if (d - 2.8 > 1.5) {
        shelving(k, x0 + 0.25, (2.6 + d - 0.4) / 2, d - 3.0, true, 1, levels, goods, 0.85, frame);
        shelving(k, x1 - 0.25, (2.6 + d - 0.4) / 2, d - 3.0, true, -1, levels, goods, 0.85, frame);
      }
      if (span - 1.2 > 1.5) shelving(k, cx, d - 0.25, span - 1.2, false, -1, levels, goods, 0.9, frame);
      const cz = pharmacy ? d - 1.7 : d - 1.6;
      counter(k, cx, cz, Math.min(span - 2.2, pharmacy ? 4 : 2), 0xf4f4f2, pharmacy ? 0x2e8b57 : 0x6b4a30, 1.0, 0.6);
      till(k, cx + 0.5, cz, 1.0);
      person(k, cx - 0.3, cz + 0.65, 0, -1);
      if (pharmacy) {
        k.glow.box(x0 + 0.03, FRONT + 1.8, h - 1.1, 0.02, 0.18, 0.55, 0x2bd46b);
        k.glow.box(x0 + 0.03, FRONT + 1.8, h - 0.92, 0.02, 0.55, 0.18, 0x2bd46b);
      }
      if (free(k, cx, (2.4 + cz) / 2, 1.3, 0.8, 0.6) && cz - 2.4 > 2.2) {
        const tz = (2.4 + cz) / 2;
        block(k, cx, tz, 0, 1.3, 0.8, 0.78, 0xd8cdb8);
        for (let i = 0; i < 10; i++) k.solid.box(cx + (k.r() - 0.5) * 1.1, tz + (k.r() - 0.5) * 0.6, 0.78, 0.14, 0.14, 0.08 + k.r() * 0.2, pick(k, PACKS[goods]));
      }
      person(k, cx + 0.2, cz - 0.95, 0, 1);
      for (let z = FRONT + 1.5; z < d - 0.5; z += 2.2) ceilingLight(k, cx, z, Math.min(span - 1.5, 2.5), 0.3);
      break;
    }
    case 'bank': {
      for (const x of [cx - 1.4, cx + 1.4]) {
        if (x < x0 + 0.9 || x > x1 - 0.9) continue;
        block(k, x, d - 1.8, 0.72, 1.4, 0.7, 0.04, 0xe9e6e0);
        k.solid.box(x, d - 1.8, 0, 1.36, 0.04, 0.72, 0x2f3b4e);
        k.solid.box(x, d - 1.6, 0.76, 0.5, 0.04, 0.32, 0x1a1a1a);
        k.glow.box(x, d - 1.62, 0.79, 0.46, 0.01, 0.26, 0x8fb4d6);
        person(k, x, d - 1.1, 0, -1);
        chair(k, x - 0.3, d - 2.45, 0, 1, 0x2f3b4e);
        chair(k, x + 0.3, d - 2.45, 0, 1, 0x2f3b4e);
        sit(k, x + (k.r() < 0.5 ? -0.3 : 0.3), d - 2.45, 0, 1, 0.6);
      }
      block(k, x0 + 0.2, FRONT + 2.8, 0, 0.4, 0.7, 1.7, 0x5a6068);
      k.glow.box(x0 + 0.41, FRONT + 2.8, 1.15, 0.01, 0.4, 0.3, 0x7fb0e0);
      plant(k, x1 - 0.45, FRONT + 0.6);
      plant(k, x0 + 0.45, d - 0.5);
      person(k, cx + 0.6, d - 3.2, 0, 1);
      if (d > 6.5 && span > 4) {
        stanchions(k, [[cx - 1.4, d - 3.5], [cx - 0.7, d - 3.5], [cx, d - 3.5]], 0x2f3b4e);
        k.blocks.push([cx - 0.7, d - 3.5, 1.4, 0.1]);
      }
      if (h > 3) clock(k, 'right', d - 1.8, 2.2);
      for (let z = FRONT + 3.9; z < d - 1.2; z += 1.8) picture(k, x0 + 0.02, z, 1.95, 0.9, 0.6, 'left', 0xc9a04a);
      for (let z = FRONT + 1.5; z < d - 0.5; z += 2.2) ceilingLight(k, cx, z, Math.min(span - 1.5, 3), 0.5);
      break;
    }
    case 'service': {
      for (let z = 2.8; z < d - 1.0; z += 1.4) {
        k.shiny.box(x0 + 0.03, z, 1.0, 0.02, 0.8, 1.0, 0xd8dde0);
        k.solid.box(x0 + 0.2, z, 0.85, 0.3, 0.9, 0.04, 0xf2f2f0);
        k.solid.geometry(CYL, at(x0 + 0.95, 0.25, z, 0.24, 0.5, 0.24), 0x1a1a1a);
        k.solid.box(x0 + 0.95, z, 0.5, 0.5, 0.5, 0.12, 0x2a2a2a);
        k.solid.box(x0 + 1.17, z, 0.6, 0.08, 0.5, 0.55, 0x2a2a2a);
        k.blocks.push([x0 + 0.95, z, 0.6, 0.6]);
      }
      person(k, x0 + 1.55, 2.8, -1, 0);
      counter(k, x1 - 1.0, d - 1.3, 1.2, 0x2a2a2a, 0xd8d2c4, 1.05, 0.55);
      person(k, x1 - 1.0, d - 0.7, 0, -1);
      if (x1 > 2.3) block(k, x1 - 0.9, FRONT + 0.45, 0.42, 1.2, 0.42, 0.06, 0x8a7f6e);
      plant(k, x1 - 0.4, d - 2.4, false);
      if (h > 3) clock(k, 'right', d - 2.4, 2.2);
      if (d > 5) picture(k, x1 - 0.02, FRONT + 2.2, 1.7, 0.8, 0.6, 'right', 0x1a1a1a);
      for (let z = FRONT + 1.5; z < d - 0.5; z += 2) ceilingLight(k, cx, z, 0.6, 0.6);
      break;
    }
    case 'hotel': {
      counter(k, cx, d - 1.6, Math.min(2.6, span - 2), 0x4a2f1d, 0xe8e2d6, 1.1, 0.7);
      person(k, cx, d - 0.9, 0, -1);
      for (let i = 0; i < 12; i++) k.shiny.box(cx - 0.75 + (i % 6) * 0.3, d - 0.04, 1.4 + Math.floor(i / 6) * 0.3, 0.06, 0.03, 0.12, 0xc9a04a);
      const sx = x0 + 2.0;
      if (sx + 1.1 < x1 - 1.0 && d > 6) {
        const sz = d / 2 + 0.3;
        k.solid.box(sx, sz, 0.005, 2.6, 2.4, 0.01, 0x6b1f2a);
        for (const s of [-1, 1]) {
          const z = sz + s * 1.0;
          block(k, sx, z, 0, 1.8, 0.85, 0.42, 0x2f3b4e);
          k.solid.box(sx, z + s * 0.33, 0.42, 1.8, 0.2, 0.45, 0x2f3b4e);
          for (const e of [-1, 1]) k.solid.box(sx + e * 0.85, z, 0.42, 0.14, 0.85, 0.2, 0x2f3b4e);
        }
        block(k, sx, sz, 0, 1.0, 0.6, 0.42, 0x3a2414);
      }
      plant(k, x0 + 0.45, d - 0.5);
      plant(k, x1 - 0.45, FRONT + 0.6);
      if (d > 7) {
        k.shiny.quad([x1 - 0.01, 1.05, d - 2.5], [0, 1.05, 0], [0, 0, 0.55], [-1, 0, 0], 0xb8bcc0);
        k.solid.box(x1 - 0.02, d - 2.5, 2.1, 0.04, 1.3, 0.12, 0x2a2a2a);
        k.glow.box(x1 - 0.03, d - 3.2, 1.2, 0.02, 0.08, 0.14, 0xf2d27a);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        k.glow.geometry(BALL, at(cx + Math.cos(a) * 0.35, h - 0.75, d / 2 + Math.sin(a) * 0.35, 0.06, 0.08, 0.06), 0xffe2b0);
      }
      k.shiny.geometry(CYL, at(cx, h - 0.4, d / 2, 0.02, 0.8, 0.02), 0xc9a04a);
      k.shiny.geometry(CYL, at(cx, h - 0.75, d / 2, 0.38, 0.03, 0.38), 0xc9a04a);
      lamp(k, cx, h - 0.8, d / 2, 7, SOFT, 9);
      for (const x of [x0 + 0.9, x1 - 0.9]) for (let z = FRONT + 1.4; z < d - 0.5; z += 2.4) spot(k, x, z, 0.06, SOFT, 2.4);
      k.shiny.geometry(BALL, at(cx - Math.min(1.1, span / 2 - 1.1), 1.13, d - 1.82, 0.045, 0.035, 0.045), 0xc9a04a);
      if (h > 3.2) for (let i = 0; i < 4; i++) clock(k, 'left', d / 2 - 1.05 + i * 0.7, 2.35);
      if (d > 7 && free(k, x1 - 0.9, d - 3.9, 0.6, 1.0, 0.1)) {
        const tx = x1 - 0.9, tz = d - 3.9;
        k.shiny.box(tx, tz, 0.12, 0.6, 1.0, 0.03, 0xc9a04a);
        for (const s of [-1, 1]) k.shiny.geometry(CYL, at(tx, 0.95, tz + s * 0.48, 0.018, 1.7, 0.018), 0xc9a04a);
        k.shiny.geometry(CYL, at(tx, 1.8, tz, 0.018, 0.96, 0.018, 0, Math.PI / 2), 0xc9a04a);
        for (const [y, sz, hh, c] of [[0.15, 0.7, 0.5, 0x2a2a2a], [0.65, 0.55, 0.35, 0x7a2e2e], [1.0, 0.45, 0.25, 0x8a6d3b]] as const) k.solid.box(tx, tz, y, 0.4, sz, hh, c);
        for (const s of [-1, 1]) for (const e of [-1, 1]) k.solid.geometry(CYL, at(tx + e * 0.25, 0.06, tz + s * 0.42, 0.06, 0.03, 0.06, 0, 0, Math.PI / 2), 0x1a1a1a);
        k.blocks.push([tx, tz, 0.6, 1.0]);
      }
      person(k, cx - 0.6, d - 2.5, 0, 1);
      break;
    }
    case 'culture': {
      for (let x = x0 + 1.2; x < x1 - 0.9; x += 2.2) {
        const ph = 0.8 + k.r() * 0.3;
        picture(k, x, d - 0.02, Math.min(1.6, h - 1.2 - ph / 2), 1.1, ph, 'back', pick(k, [0x1a1a1a, 0xb08d57, 0xf4f4f2]));
        spot(k, x, d - 1.0, 0.07, 0xfff6e6);
      }
      for (let z = 2.8; z < d - 1.0; z += 2.4) {
        picture(k, x0 + 0.02, z, 1.65, 1.1, 0.8 + k.r() * 0.4, 'left', pick(k, [0x1a1a1a, 0xb08d57]));
        picture(k, x1 - 0.02, z, 1.65, 1.1, 0.8 + k.r() * 0.4, 'right', pick(k, [0x1a1a1a, 0xb08d57]));
        spot(k, x0 + 1.0, z, 0.07, 0xfff6e6);
        spot(k, x1 - 1.0, z, 0.07, 0xfff6e6);
      }
      if (d > 6) block(k, cx, d / 2 + 0.8, 0, 1.6, 0.45, 0.45, 0x3a2414);
      if (span > 5 && d > 7) {
        const px = cx + 1.8 < x1 - 1 ? cx + 1.8 : cx - 1.8;
        block(k, px, d / 2 - 1.2, 0, 0.5, 0.5, 1.0, 0xf4f4f2);
        k.shiny.geometry(KNOT, at(px, 1.28, d / 2 - 1.2, 1, 1, 1), 0x8a5a2b);
        stanchions(k, [[px - 0.6, d / 2 - 1.8], [px + 0.6, d / 2 - 1.8]], 0x7a1e2a);
        k.blocks.push([px, d / 2 - 1.8, 1.2, 0.1]);
      }
      person(k, x1 - 0.6, FRONT + 1.6, -1, 0);
      person(k, cx - 0.4, d - 2.0, 0, 1);
      break;
    }
    case 'club': {
      const neon = [0xff3fa4, 0x3fe0ff, 0x9b5cff, 0xffb347];
      const fz0 = 2.6, fz1 = Math.max(fz0 + 2, d - 2.4), fx0 = x0 + 0.8, fx1 = Math.min(x1 - 2.2, x0 + 0.8 + 6);
      for (let x = fx0; x < fx1 - 0.25; x += 0.6) {
        for (let z = fz0; z < fz1 - 0.25; z += 0.6) k.glow.box(x + 0.3, z + 0.3, 0.012, 0.56, 0.56, 0.008, k.r() < 0.5 ? 0x1a1424 : pick(k, neon));
      }
      block(k, cx, d - 0.9, 0, Math.min(2.2, span - 2), 0.8, 1.1, 0x111114);
      for (const s of [-0.4, 0.4]) k.solid.geometry(CYL, at(cx + s, 1.12, d - 0.9, 0.17, 0.03, 0.17), 0x2a2a2a);
      k.glow.box(cx, d - 1.31, 0.2, Math.min(2.0, span - 2.2), 0.02, 0.7, 0x9b5cff);
      person(k, cx, d - 0.3, 0, -1);
      if (x1 - fx1 > 1.4 && d - 4.8 > 0.5) {
        const bz = (2.6 + d - 2) / 2;
        block(k, x1 - 0.6, bz, 0, 0.6, d - 4.6, 1.08, 0x1c1820);
        k.glow.box(x1 - 0.91, bz, 0.15, 0.02, d - 4.8, 0.05, 0xff3fa4);
        k.glow.box(x1 - 0.12, bz, 1.46, 0.2, d - 4.8, 0.03, 0x3fe0ff);
        for (let z = 2.5; z < d - 2.2; z += 0.1 + k.r() * 0.05) {
          const hgt = 0.22 + k.r() * 0.12;
          k.shiny.geometry(CYL, at(x1 - 0.12, 1.49 + hgt / 2, z, 0.035, hgt, 0.035), pick(k, [0x2f5d3a, 0x5a3a1e, 0xc9d6d0, 0x7a2e2e, 0x8a6d3b]));
        }
        person(k, x1 - 0.2, bz, -1, 0);
      }
      for (let x = fx0 + 0.6; x < fx1; x += 1.3) {
        for (let z = fz0 + 0.6; z < fz1; z += 1.5) {
          const c = pick(k, neon);
          spot(k, x, z, 0.1, c, 3);
          if (k.r() < 0.45) k.beam.geometry(BEAM, at(x, h, z, 1, 1, 1, k.r() * 6, (k.r() - 0.5) * 0.5).multiply(at(0, -h / 2, 0, 0.35, h, 0.35)), c);
        }
      }
      const bx = (fx0 + fx1) / 2, bz = (fz0 + fz1) / 2;
      k.solid.box(bx, bz, h - 0.45, 0.01, 0.01, 0.45, 0x1a1a1a);
      k.shiny.geometry(BALL, at(bx, h - 0.62, bz, 0.2, 0.2, 0.2), 0xe8e8ec);
      for (let i = 0; i < 70; i++) {
        const wall: Wall = k.r() < 0.4 ? 'left' : k.r() < 0.5 ? 'right' : 'back';
        wallBox(k.glow, k, wall, wall === 'back' ? x0 + k.r() * span : FRONT + 0.5 + k.r() * (d - 1), 0.012, 0.6 + k.r() * (h - 0.9), 0.04, 0.004, 0.04, pick(k, [0xffffff, ...neon]));
      }
      const booth = Math.min(2.2, span - 2);
      for (const s of [-1, 1]) {
        const sx = cx + s * (booth / 2 + 0.4);
        if (sx - 0.3 < x0 + 0.1 || sx + 0.3 > x1 - 0.1) continue;
        block(k, sx, d - 0.45, 0, 0.55, 0.5, 1.5, 0x141416);
        for (const [y, r] of [[0.45, 0.2], [1.05, 0.12], [1.32, 0.06]]) k.solid.geometry(CYL, at(sx, y, d - 0.7, r, 0.02, r, 0, Math.PI / 2), 0x2c2c30);
      }
      for (let i = 0; i < 6; i++) person(k, fx0 + 0.4 + k.r() * (fx1 - fx0 - 0.8), fz0 + 0.4 + k.r() * (fz1 - fz0 - 0.8), k.r() - 0.5, k.r() - 0.5);
      break;
    }
    case 'public': {
      const books = (x: number, z: number, length: number, alongZ: boolean, faces: number) =>
        shelving(k, x, z, length, alongZ, faces, [0.35, 0.75, 1.15, 1.55, 1.95].filter((y) => y < h - 1.5), 'books', 0.95, 0x5a3e26);
      if (d - 3 > 1.5) {
        books(x0 + 0.22, (2.6 + d - 0.4) / 2, d - 3.0, true, 1);
        books(x1 - 0.22, (2.6 + d - 0.4) / 2, d - 3.0, true, -1);
      }
      if (span > 2) books(cx, d - 0.22, span - 1.2, false, -1);
      for (let z = 3.0; z < d - 1.6; z += 2.2) {
        for (let x = x0 + 1.8; x < x1 - 1.6; x += 2.6) {
          if (!free(k, x, z, 1.6, 1.4, 0.6)) continue;
          k.solid.box(x, z, 0.72, 1.6, 0.8, 0.04, 0x8a6d3b);
          for (const dx of [-0.7, 0.7]) for (const dz of [-0.32, 0.32]) k.solid.box(x + dx, z + dz, 0, 0.05, 0.05, 0.72, 0x3a2a1c);
          for (const s of [-1, 1]) for (const dx of [-0.4, 0.4]) {
            chair(k, x + dx, z + s * 0.62, 0, -s, 0x5a3e26);
            sit(k, x + dx, z + s * 0.62, 0, -s, 0.3);
          }
          k.blocks.push([x, z, 1.6, 1.4]);
          for (const dx of [-0.45, 0.45]) deskLamp(k, x + dx, z, 0.76);
          for (let i = 0; i < 3; i++) k.solid.box(x + (k.r() - 0.5) * 1.2, z + (k.r() - 0.5) * 0.4, 0.76, 0.22, 0.3, 0.035, pick(k, BOOKS));
          pendant(k, x, z, 2);
        }
      }
      if (x1 > 2.5) {
        counter(k, x1 - 1.3, FRONT + 1.6, 1.4, 0x5a3e26, 0x2a1a0e, 1.0, 0.6);
        person(k, x1 - 1.3, FRONT + 2.2, 0, -1);
      }
      person(k, x0 + 1.0, d / 2, -1, 0);
      break;
    }
    case 'plate': {
      counter(k, cx, d - 1.5, Math.min(2.2, span - 1.6), 0xf2f2f0, 0x3a3f45, 1.08, 0.65);
      till(k, cx + 0.4, d - 1.5, 1.08);
      person(k, cx, d - 0.85, 0, -1);
      for (let z = 2.6; z < d - 2.4; z += 0.6) chair(k, x0 + 0.4, z, 1, 0, 0x3a4a5e);
      if (d - 2.4 > 2.8) k.blocks.push([x0 + 0.4, (2.6 + d - 2.4) / 2, 0.5, d - 5.0]);
      plant(k, x1 - 0.45, FRONT + 0.5);
      k.solid.quad([x1 - 0.01, 1.05, d - 0.9], [0, 1.05, 0], [0, 0, 0.45], [-1, 0, 0], 0x6b4a30);
      k.shiny.box(x1 - 0.04, d - 1.25, 1.0, 0.05, 0.05, 0.05, 0xc0c0c0);
      if (d - 2.4 > 2.8) clock(k, 'left', (2.6 + d - 2.4) / 2, Math.min(2.2, h - 0.5));
      if (free(k, x1 - 0.3, d - 2.1, 0.32, 0.32, 0.05)) {
        block(k, x1 - 0.3, d - 2.1, 0, 0.32, 0.32, 1.0, 0xeeeeec);
        k.solid.geometry(CYL, at(x1 - 0.3, 1.2, d - 2.1, 0.13, 0.4, 0.13), 0x6fa8dc);
        k.shiny.box(x1 - 0.3, d - 2.27, 0.75, 0.05, 0.03, 0.04, 0x3a6fb5);
      }
      if (d > 5) picture(k, x1 - 0.02, FRONT + 2.4, 1.65, 1.0, 0.7, 'right', 0x1a1a1a);
      for (let z = FRONT + 1.5; z < d - 0.4; z += 2) ceilingLight(k, cx, z, 0.6, 0.6);
      break;
    }
  }
}
