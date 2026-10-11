import * as THREE from 'three';
import type { Clip } from '../../actors/crowd';
import { parkMiller } from '../../core/util';
import { CUBE, CYL, Mesher, at, type Lamp, type V3 } from '../interiors';

export type Skin = 'marble' | 'plaster' | 'planks' | 'planksDark' | 'concrete' | 'tiles' | 'checker' | 'ashlar' | 'flags';
export type Mat = 'solid' | 'shiny' | 'glow' | 'glass' | 'beam' | Skin;

/** The floor rises `rise` m from (x, z) over len m along (dx, dz). */
export interface Ramp {
  x: number;
  z: number;
  dx: number;
  dz: number;
  len: number;
  rise: number;
}

/** Walkable rectangle; h = headroom (m). A linked ramp belongs to both levels and hands you over halfway up. */
export interface Floor {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y: number;
  h: number;
  level: number;
  ramp?: Ramp;
  link?: [number, number];
}

export interface Block {
  x: number;
  z: number;
  sx: number;
  sz: number;
  level: number;
  round: boolean;
}

export interface HallLamp extends Lamp {
  level: number;
}

export interface HallPerson {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  level: number;
  clip: Clip;
}

export interface Walker {
  path: [number, number][];
  y: number;
  speed: number; // m/s
}

export interface Sheet {
  m: THREE.Matrix4;
  w: number;
  h: number;
  glow: boolean;
  key?: string; // drawn once and kept: paintings, stained glass
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

/** From a (bottom, on level `from`) to b (top, on level `to`), each end a 1 m flat landing. */
export interface Escalator {
  from: number;
  to: number;
  a: V3;
  b: V3;
  w: number;
}

export interface Lift {
  level: number;
  x: number;
  z: number;
  label: string;
  to: { level: number; x: number; z: number; heading: number };
}

export interface Exit {
  x: number;
  z: number;
  nx: number;
  nz: number;
  w: number;
}

export interface Hole {
  a: number;
  b: number;
  y0: number;
  spring: number;
  kind: 'round' | 'pointed' | 'flat';
}

export const hole = (a: number, b: number, y0: number, spring: number, kind: Hole['kind'] = 'round'): Hole => ({ a, b, y0, spring, kind });

export const LANDING = 1; // m: flat steps at each end of an escalator

const up = new THREE.Vector3(0, 1, 0);

/** Records a hall in its landmark's frame (x along the long side, y up), optionally turned a quarter at a time. */
export class HallKit {
  readonly meshers = new Map<Mat, Mesher>();
  readonly floors: Floor[] = [];
  readonly blocks: Block[] = [];
  readonly rails: [number, number, number, number, number][] = [];
  readonly lamps: HallLamp[] = [];
  readonly people: HallPerson[] = [];
  readonly walkers: Walker[] = [];
  readonly sheets: Sheet[] = [];
  readonly escalators: Escalator[] = [];
  readonly lifts: Lift[] = [];
  readonly openAir = new Set<number>();
  level = 0;
  private q = 0;
  private dy = 0;
  private frame = new THREE.Matrix4();
  readonly r: () => number;

  constructor(seed: number) {
    let s = seed;
    this.r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  }

  m(mat: Mat): Mesher {
    let m = this.meshers.get(mat);
    if (!m) this.meshers.set(mat, (m = new Mesher()));
    return m;
  }

  /** Draws fn's content turned q quarter turns (as three's rotation.y) and raised dy. */
  turn(q: number, dy: number, fn: () => void) {
    const [sq, sdy, sf] = [this.q, this.dy, this.frame];
    this.q = ((q % 4) + 4) % 4;
    this.dy = dy;
    this.frame = new THREE.Matrix4().makeTranslation(0, dy, 0).multiply(new THREE.Matrix4().makeRotationY((this.q * Math.PI) / 2));
    fn();
    [this.q, this.dy, this.frame] = [sq, sdy, sf];
  }

  p(x: number, z: number): [number, number] {
    return this.q === 0 ? [x, z] : this.q === 1 ? [z, -x] : this.q === 2 ? [-x, -z] : [-z, x];
  }

  private pt(v: V3): V3 {
    const [x, z] = this.p(v[0], v[2]);
    return [x, v[1] + this.dy, z];
  }

  private dir(v: V3): V3 {
    const [x, z] = this.p(v[0], v[2]);
    return [x, v[1], z];
  }

  box(mat: Mat, x: number, z: number, y0: number, sx: number, sz: number, h: number, colour: number) {
    const [px, pz] = this.p(x, z);
    this.m(mat).box(px, pz, y0 + this.dy, this.q % 2 ? sz : sx, this.q % 2 ? sx : sz, h, colour);
  }

  quad(mat: Mat, c: V3, e1: V3, e2: V3, n: V3, colour: number, uv = 0) {
    this.m(mat).quad(this.pt(c), this.dir(e1), this.dir(e2), this.dir(n), colour, uv);
  }

  geom(mat: Mat, g: THREE.BufferGeometry, m: THREE.Matrix4, colour: number, uv = 0) {
    this.m(mat).geometry(g, this.frame.clone().multiply(m), colour, uv);
  }

  cyl(mat: Mat, x: number, y0: number, z: number, r: number, h: number, colour: number) {
    this.geom(mat, CYL, at(x, y0 + h / 2, z, r, h, r), colour);
  }

  flat(mat: Mat, x0: number, x1: number, z0: number, z1: number, y: number, colour: number, uv = 0, down = false) {
    this.quad(mat, [(x0 + x1) / 2, y, (z0 + z1) / 2], [(x1 - x0) / 2, 0, 0], [0, 0, (z1 - z0) / 2], [0, down ? -1 : 1, 0], colour, uv);
  }

  panel(mat: Mat, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, n: [number, number], colour: number, uv = 0) {
    this.quad(mat, [(ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2], [(bx - ax) / 2, 0, (bz - az) / 2], [0, (y1 - y0) / 2, 0], [n[0], 0, n[1]], colour, uv);
  }

  /** A flat shape (outline less holes, in its own u, v metres) placed by m: u, v → its x, y; it faces its +z. */
  shape(mat: Mat, outline: [number, number][], holes: [number, number][][], m: THREE.Matrix4, colour: number, uv = 0) {
    const s = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, v)));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
    this.geom(mat, new THREE.ShapeGeometry(s), m, colour, uv);
  }

  /** A wall in the vertical plane through (x, z) facing (nx, nz): u runs to a viewer's right, v up from y. */
  wall(mat: Mat, x: number, y: number, z: number, nx: number, nz: number, outline: [number, number][], holes: [number, number][][], colour: number, uv = 0) {
    this.shape(mat, outline, holes, wallBasis(x, y, z, nx, nz), colour, uv);
  }

  /** wall()'s outline extruded `depth` m behind its face. */
  solidWall(mat: Mat, x: number, y: number, z: number, nx: number, nz: number, outline: [number, number][], holes: [number, number][][], depth: number, colour: number, uv = 0) {
    const s = new THREE.Shape(outline.map(([u, v]) => new THREE.Vector2(u, v)));
    for (const h of holes) s.holes.push(new THREE.Path(h.map(([u, v]) => new THREE.Vector2(u, v))));
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth);
    this.geom(mat, g, wallBasis(x, y, z, nx, nz), colour, uv);
  }

  /** A wall t thick centred on z = c, both faces and its openings' reveals (holes in x). */
  thickZ(mat: Mat, c: number, x0: number, x1: number, y0: number, y1: number, t: number, holes: Hole[], colour: number, uv = 0) {
    this.solidWall(mat, 0, 0, c + t / 2, 0, 1, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
      holes.map((h) => archOutline(h.a, h.b, h.y0, h.spring, h.kind)), t, colour, uv);
  }

  thickX(mat: Mat, c: number, z0: number, z1: number, y0: number, y1: number, t: number, holes: Hole[], colour: number, uv = 0) {
    this.solidWall(mat, c + t / 2, 0, 0, 1, 0, [[-z0, y0], [-z1, y0], [-z1, y1], [-z0, y1]],
      holes.map((h) => archOutline(-h.b, -h.a, h.y0, h.spring, h.kind)), t, colour, uv);
  }

  /** Inside of a vault from a0 to a1 along x (or z): profile [across, y] pairs, rising from its first point, seen from below. */
  vault(mat: Mat, a0: number, a1: number, profile: [number, number][], colour: number, alongZ = false) {
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    for (let i = 0; i < profile.length; i++) {
      const [c, y] = profile[i];
      const [pc, py] = profile[Math.max(0, i - 1)], [nc, ny] = profile[Math.min(profile.length - 1, i + 1)];
      const tc = nc - pc, ty = ny - py, l = Math.hypot(tc, ty) || 1;
      for (const a of [a0, a1]) {
        if (alongZ) {
          pos.push(c, y, a);
          nor.push(ty / l, -tc / l, 0);
        } else {
          pos.push(a, y, c);
          nor.push(0, -tc / l, ty / l);
        }
      }
    }
    // Wound to face the inside; along z the profile's handedness flips.
    const flip = alongZ !== a1 < a0;
    for (let i = 0; i + 1 < profile.length; i++) {
      const a = i * 2;
      if (flip) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geom(mat, indexed(pos, nor, idx), new THREE.Matrix4(), colour);
  }

  /** Inside of a surface of revolution about the vertical through (x, z): profile [r, y] from the bottom up. */
  lathe(mat: Mat, x: number, z: number, profile: [number, number][], colour: number, segments = 32) {
    const pos: number[] = [], nor: number[] = [], idx: number[] = [];
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      for (let i = 0; i < profile.length; i++) {
        const [r, y] = profile[i];
        const [pr, py] = profile[Math.max(0, i - 1)], [nr, ny] = profile[Math.min(profile.length - 1, i + 1)];
        const tr = nr - pr, ty = ny - py, l = Math.hypot(tr, ty) || 1;
        pos.push(x + r * c, y, z + r * sn);
        nor.push((-ty / l) * c, tr / l, (-ty / l) * sn);
      }
    }
    const n = profile.length;
    for (let s = 0; s < segments; s++) {
      for (let i = 0; i + 1 < n; i++) {
        const a = s * n + i, b = (s + 1) * n + i;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    this.geom(mat, indexed(pos, nor, idx), new THREE.Matrix4(), colour);
  }

  wallZ(mat: Mat, c: number, x0: number, x1: number, y0: number, y1: number, nz: number, holes: Hole[], colour: number, uv = 0) {
    const u = (x: number) => nz * x;
    this.wall(mat, 0, 0, c, 0, nz, [[u(x0), y0], [u(x1), y0], [u(x1), y1], [u(x0), y1]],
      holes.map((h) => archOutline(Math.min(u(h.a), u(h.b)), Math.max(u(h.a), u(h.b)), h.y0, h.spring, h.kind)), colour, uv);
  }

  wallX(mat: Mat, c: number, z0: number, z1: number, y0: number, y1: number, nx: number, holes: Hole[], colour: number, uv = 0) {
    const u = (z: number) => -nx * z;
    this.wall(mat, c, 0, 0, nx, 0, [[u(z0), y0], [u(z1), y0], [u(z1), y1], [u(z0), y1]],
      holes.map((h) => archOutline(Math.min(u(h.a), u(h.b)), Math.max(u(h.a), u(h.b)), h.y0, h.spring, h.kind)), colour, uv);
  }

  /** The sides and soffit of an opening through a wall `depth` thick, from the plane x = c (or z = c) towards +x (+z). */
  reveal(mat: Mat, h: Hole, axisZ: boolean, c: number, depth: number, colour: number, uv = 0) {
    const pts = archOutline(h.a, h.b, h.y0, h.spring, h.kind);
    const mx = (h.a + h.b) / 2, my = (h.y0 + h.spring) / 2;
    for (let i = 1; i < pts.length; i++) {
      const [pa, pb] = [pts[i], pts[(i + 1) % pts.length]];
      if (pa[1] === h.y0 && pb[1] === h.y0) continue;
      const da = pb[0] - pa[0], dv = pb[1] - pa[1], l = Math.hypot(da, dv);
      let na = -dv / l, nv = da / l;
      if (na * (mx - pa[0]) + nv * (my - pa[1]) < 0) [na, nv] = [-na, -nv];
      const ma = (pa[0] + pb[0]) / 2, mv = (pa[1] + pb[1]) / 2;
      if (axisZ) this.quad(mat, [ma, mv, c + depth / 2], [da / 2, dv / 2, 0], [0, 0, depth / 2], [na, nv, 0], colour, uv);
      else this.quad(mat, [c + depth / 2, mv, ma], [0, dv / 2, da / 2], [depth / 2, 0, 0], [0, nv, na], colour, uv);
    }
  }

  bar(mat: Mat, a: V3, b: V3, w: number, t: number, colour: number) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const d = vb.clone().sub(va), len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(up, d.normalize());
    const m = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(w, len, t));
    this.geom(mat, CUBE, m, colour);
  }

  floor(x0: number, x1: number, z0: number, z1: number, y: number, h: number, ramp?: { to: [number, number]; rise: number; link?: [number, number] }) {
    const [ax, az] = this.p(x0, z0), [bx, bz] = this.p(x1, z1);
    const f: Floor = { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz), y: y + this.dy, h, level: this.level };
    if (ramp) {
      // The ramp starts on the rectangle's edge facing away from `to`.
      const [tx, tz] = this.p(...ramp.to);
      const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2, dx = tx - cx, dz = tz - cz;
      const alongX = Math.abs(dx) > Math.abs(dz);
      const sx = alongX ? Math.sign(dx) : 0, sz = alongX ? 0 : Math.sign(dz);
      const len = alongX ? f.x1 - f.x0 : f.z1 - f.z0;
      f.ramp = { x: sx > 0 ? f.x0 : f.x1, z: sz > 0 ? f.z0 : f.z1, dx: sx, dz: sz, len, rise: ramp.rise };
      if (ramp.link) f.link = ramp.link;
    }
    this.floors.push(f);
  }

  block(x: number, z: number, sx: number, sz: number, round = false) {
    const [px, pz] = this.p(x, z);
    this.blocks.push({ x: px, z: pz, sx: this.q % 2 ? sz : sx, sz: this.q % 2 ? sx : sz, level: this.level, round });
  }

  rail(ax: number, az: number, bx: number, bz: number) {
    this.rails.push([...this.p(ax, az), ...this.p(bx, bz), this.level]);
  }

  lamp(x: number, y: number, z: number, power: number, colour: number, range: number, shaded = false) {
    const [px, pz] = this.p(x, z);
    this.lamps.push({ x: px, y: y + this.dy, z: pz, power, colour: new THREE.Color(colour), range, shaded, level: this.level });
  }

  person(x: number, z: number, fx: number, fz: number, y = 0, clip: Clip = 'idle') {
    const [px, pz] = this.p(x, z), [dx, dz] = this.p(fx, fz);
    if (this.people.some((o) => o.level === this.level && Math.hypot(o.x - px, o.z - pz) < 0.6)) return;
    this.people.push({ x: px, y: y + this.dy, z: pz, fx: dx, fz: dz, level: this.level, clip });
  }

  walker(path: [number, number][], y: number, speed = 1.3) {
    this.walkers.push({ path: path.map(([x, z]) => this.p(x, z)), y: y + this.dy, speed });
  }

  /** A canvas-drawn plane centred on (x, y, z), turned yaw about y (0 faces +z), tilted pitch about its own x. */
  sheet(x: number, y: number, z: number, w: number, h: number, yaw: number, draw: Sheet['draw'], glow = false, key?: string, pitch = 0) {
    this.sheets.push({ m: this.frame.clone().multiply(at(x, y, z, 1, 1, 1, yaw, pitch)), w, h, glow, key, draw });
  }

  escalator(a: V3, b: V3, w: number, to: number) {
    this.escalators.push({ from: this.level, to, a: this.pt(a), b: this.pt(b), w });
  }

  lift(x: number, z: number, label: string, to: Lift['to']) {
    const [px, pz] = this.p(x, z);
    this.lifts.push({ level: this.level, x: px, z: pz, label, to });
  }
}

function indexed(pos: number[], nor: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function wallBasis(x: number, y: number, z: number, nx: number, nz: number): THREE.Matrix4 {
  return new THREE.Matrix4().makeBasis(new THREE.Vector3(nz, 0, -nx), up, new THREE.Vector3(nx, 0, nz)).setPosition(x, y, z);
}

export function archOutline(u0: number, u1: number, v0: number, spring: number, kind: 'round' | 'pointed' | 'flat' = 'round', steps = 12): [number, number][] {
  const w = u1 - u0, c = (u0 + u1) / 2;
  const out: [number, number][] = [[u0, v0], [u1, v0], [u1, spring]];
  if (kind === 'round') {
    for (let i = 1; i < steps; i++) {
      const t = (i / steps) * Math.PI;
      out.push([c + (Math.cos(t) * w) / 2, spring + (Math.sin(t) * w) / 2]);
    }
  } else if (kind === 'pointed') {
    // Equilateral arch: each side an arc centred on the opposite springing point.
    const half = Math.floor(steps / 2);
    for (let i = 1; i <= half; i++) {
      const t = (i / half) * (Math.PI / 3);
      out.push([u0 + w * Math.cos(t), spring + w * Math.sin(t)]);
    }
    for (let i = half - 1; i >= 1; i--) {
      const t = (i / half) * (Math.PI / 3);
      out.push([u1 - w * Math.cos(t), spring + w * Math.sin(t)]);
    }
  }
  out.push([u0, spring]);
  return out;
}

const archRise = (w: number, kind: 'round' | 'pointed' | 'flat') => (kind === 'round' ? w / 2 : kind === 'pointed' ? (w * Math.sqrt(3)) / 2 : 0);

export function vaultProfile(z0: number, z1: number, spring: number, kind: 'round' | 'pointed', steps = 16, rise?: number): [number, number][] {
  const w = z1 - z0, c = (z0 + z1) / 2, out: [number, number][] = [];
  const top = rise ?? archRise(w, kind);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let z: number, y: number;
    if (kind === 'round') {
      const a = Math.PI * (1 - t);
      z = c + (Math.cos(a) * w) / 2;
      y = spring + Math.sin(a) * top;
    } else {
      const s = t < 0.5 ? t * 2 : (1 - t) * 2, a = s * (Math.PI / 3);
      const dz = w * (1 - Math.cos(a));
      z = t < 0.5 ? z0 + dz : z1 - dz;
      y = spring + (Math.sin(a) / Math.sin(Math.PI / 3)) * top;
    }
    out.push([z, y]);
  }
  return out;
}

export function profileAt(profile: [number, number][], z: number): number {
  for (let i = 0; i + 1 < profile.length; i++) {
    const [za, ya] = profile[i], [zb, yb] = profile[i + 1];
    if ((z - za) * (z - zb) <= 0 && za !== zb) return ya + ((z - za) / (zb - za)) * (yb - ya);
  }
  return profile[0][1];
}

const surfaces = new Map<string, THREE.CanvasTexture>();

/** Textures the shops don't have: dressed stone courses and big floor flags. */
export function hallTexture(kind: 'ashlar' | 'flags'): THREE.CanvasTexture {
  const cached = surfaces.get(kind);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const g = canvas.getContext('2d')!;
  const r = parkMiller(kind === 'ashlar' ? 11 : 23);
  g.fillStyle = kind === 'ashlar' ? '#b9b4ab' : '#8d8c88';
  g.fillRect(0, 0, 512, 512);
  const rows = kind === 'ashlar' ? 8 : 4, rh = 512 / rows;
  for (let row = 0; row < rows; row++) {
    let x = kind === 'ashlar' ? -(row % 2) * 64 : -(row % 2) * 96;
    while (x < 512) {
      const w = kind === 'ashlar' ? (r() < 0.5 ? 128 : 192) : 128 + Math.floor(r() * 2) * 64;
      const k = 0.88 + r() * 0.2;
      const base = kind === 'ashlar' ? [235, 230, 220] : [196, 194, 188];
      for (const o of [0, -512, 512]) {
        g.fillStyle = `rgb(${base.map((v) => Math.round(v * k)).join(',')})`;
        g.fillRect(x + o + 2, row * rh + 2, w - 4, rh - 4);
        g.fillStyle = 'rgba(0,0,0,0.05)';
        for (let s = 0; s < 18; s++) g.fillRect(x + o + r() * w, row * rh + r() * rh, 2 + r() * 6, 1 + r() * 3);
        g.fillStyle = 'rgba(255,255,255,0.04)';
        for (let s = 0; s < 10; s++) g.fillRect(x + o + r() * w, row * rh + r() * rh, 3 + r() * 8, 1 + r() * 2);
      }
      x += w;
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  surfaces.set(kind, tex);
  return tex;
}
