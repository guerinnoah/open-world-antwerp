import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uploadFirst } from '../core/instancing';
import { rand } from './buildings';
import type { Building, CityData, LogoRect, Sign, SignStyle } from './cityData';
import { facadeStyle } from './facadeLayout';

const ATLAS = 2048;
const MAX_CELLS = 8;
const CELL_W = 128, CELL_H = 64; // px per atlas cell; a name takes 1–MAX_CELLS cells side by side in a row
const COLS = ATLAS / CELL_W, ROWS = ATLAS / CELL_H;
const GRID = 50;
const NEW_PER_REFRESH = 10; // names drawn per refresh, to keep frame times even while driving
const CAPACITY = 2000;
const LOGO_SIGN_H = 0.75; // m; the logo is 3/4 of it, as tools/map/signs.ts sizes it

interface Look {
  bg: string;
  fg: string;
  font: string;
}

export interface Door {
  x: number;
  z: number;
  nx: number;
  nz: number;
  ux: number;
  uz: number;
  building: Building;
  edge: number;
  along: number;
  length: number;
  groundH: number;
  name: string;
  style: SignStyle;
  look: Look;
}

type FaceKind = 'sign' | 'plate' | 'street' | 'board' | 'hotel';

interface Face {
  kind: FaceKind;
  text: string;
  look: Look;
  bg: THREE.Color;
  rotated: boolean;
  px: number;
  matrices: THREE.Matrix4[];
  view: number;
  textRange: number;
  cell: number;
  pharmacy: boolean;
  logo?: LogoRect;
}

interface Placed {
  x: number;
  z: number;
  faces: Face[];
  cross?: THREE.Matrix4;
  brackets: THREE.Matrix4[];
  door?: THREE.Matrix4;
}

function doorFrameGeometry(): THREE.BufferGeometry {
  const parts = [
    new THREE.BoxGeometry(0.08, 2.42, 0.12).translate(-0.56, 1.21, 0.06), new THREE.BoxGeometry(0.08, 2.42, 0.12).translate(0.56, 1.21, 0.06),
    new THREE.BoxGeometry(1.2, 0.1, 0.12).translate(0, 2.37, 0.06), new THREE.BoxGeometry(1.04, 0.22, 0.05).translate(0, 0.11, 0.035),
    new THREE.BoxGeometry(0.75, 0.04, 0.04).translate(0, 1.05, 0.14),
    ...[-0.36, 0.36].map((x) => new THREE.BoxGeometry(0.03, 0.03, 0.09).translate(x, 1.05, 0.1)),
  ];
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

const LOOKS: Record<SignStyle, Look[]> = {
  pharmacy: [{ bg: '#0f7b3f', fg: '#ffffff', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' }],
  cafe: [
    { bg: '#16301f', fg: '#e7d29a', font: 'italic 700 {s}px Georgia, "Times New Roman", serif' },
    { bg: '#3a1418', fg: '#ecd9a6', font: '700 {s}px Georgia, "Times New Roman", serif' },
    { bg: '#111111', fg: '#d9b45a', font: '700 {s}px Georgia, "Times New Roman", serif' },
    { bg: '#1b2a44', fg: '#f1e7c9', font: 'italic 700 {s}px Georgia, serif' },
  ],
  restaurant: [
    { bg: '#2b2b2b', fg: '#f4efe4', font: '600 {s}px Georgia, serif' },
    { bg: '#5a1d1d', fg: '#f6e8cf', font: 'italic 600 {s}px Georgia, serif' },
    { bg: '#e9e3d6', fg: '#2b2b2b', font: '600 {s}px Georgia, serif' },
    { bg: '#204035', fg: '#f4efe4', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' },
  ],
  fastfood: [
    { bg: '#c8102e', fg: '#ffd400', font: '800 {s}px "Arial Black", Arial, sans-serif' },
    { bg: '#ffd400', fg: '#b3001b', font: '800 {s}px "Arial Black", Arial, sans-serif' },
    { bg: '#ffffff', fg: '#c8102e', font: '800 {s}px Arial, sans-serif' },
  ],
  bakery: [
    { bg: '#f3e6cc', fg: '#6b3e1f', font: 'italic 700 {s}px Georgia, serif' },
    { bg: '#4a2a17', fg: '#f3e1b8', font: '700 {s}px Georgia, serif' },
  ],
  jewelry: [
    { bg: '#0c0c0c', fg: '#d4af37', font: '600 {s}px Didot, "Bodoni 72", Georgia, serif' },
    { bg: '#f5f1e8', fg: '#1a1a1a', font: '500 {s}px Didot, Georgia, serif' },
  ],
  fashion: [
    { bg: '#111111', fg: '#ffffff', font: '300 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#ffffff', fg: '#111111', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#e8e2d8', fg: '#2a2a2a', font: '400 {s}px Didot, Georgia, serif' },
  ],
  food: [
    { bg: '#1f5e3a', fg: '#ffffff', font: '700 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#ffffff', fg: '#1f5e3a', font: '700 {s}px "Helvetica Neue", Arial, sans-serif' },
  ],
  bank: [{ bg: '#13294b', fg: '#ffffff', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' }],
  service: [
    { bg: '#ffffff', fg: '#333333', font: '500 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#2d2d2d', fg: '#ffffff', font: '500 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#f2d7d9', fg: '#5a2a33', font: 'italic 600 {s}px Georgia, serif' },
  ],
  hotel: [
    { bg: '#1d2b4f', fg: '#d9b45a', font: '700 {s}px Didot, "Bodoni 72", Georgia, serif' },
    { bg: '#5a1420', fg: '#f1e2bf', font: '700 {s}px Georgia, serif' },
    { bg: '#111111', fg: '#ffffff', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' },
  ],
  culture: [
    { bg: '#111111', fg: '#ffffff', font: '800 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#c8102e', fg: '#ffffff', font: '800 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#f4f1ea', fg: '#111111', font: '800 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#2b4a6f', fg: '#ffffff', font: '700 {s}px Georgia, serif' },
  ],
  club: [
    { bg: '#0b0b10', fg: '#ff3fa4', font: '800 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#0b0b10', fg: '#3fe0ff', font: '800 {s}px "Helvetica Neue", Arial, sans-serif' },
  ],
  public: [{ bg: '#d9d2c3', fg: '#2f2b26', font: '600 {s}px Georgia, "Times New Roman", serif' }],
  plate: [
    { bg: '#b08d3c', fg: '#1c1408', font: '600 {s}px Georgia, serif' },
    { bg: '#c5c8cc', fg: '#1d1f22', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#141414', fg: '#e8e8e8', font: '500 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#f2f2f2', fg: '#2a2a2a', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' },
  ],
  street: [{ bg: '#1f3c78', fg: '#ffffff', font: '700 {s}px "Helvetica Neue", Arial, sans-serif' }],
  shop: [
    { bg: '#ffffff', fg: '#222222', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#222222', fg: '#ffffff', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' },
    { bg: '#7a1f2b', fg: '#ffffff', font: '600 {s}px Georgia, serif' },
    { bg: '#1e3d59', fg: '#ffffff', font: '600 {s}px "Helvetica Neue", Arial, sans-serif' },
  ],
};

function panelGeometry(): THREE.BufferGeometry {
  const face = new THREE.PlaneGeometry(1, 1).translate(0, 0, 0.045);
  const back = new THREE.BoxGeometry(1.04, 1.1, 0.07).translate(0, 0, 0.005);
  const uv = back.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, -1, -1);
  return mergeGeometries([face.toNonIndexed(), back.toNonIndexed()]);
}

function solidLook(hex: number, weight: number): Look {
  const c = new THREE.Color(hex);
  return { bg: `#${c.getHexString()}`, fg: c.r * 0.3 + c.g * 0.59 + c.b * 0.11 > 0.6 ? '#1a1a1a' : '#ffffff', font: `${weight} {s}px "Helvetica Neue", Arial, sans-serif` };
}

const turn = (angle: number) => new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle);
const pose = (x: number, y: number, z: number, q: THREE.Quaternion, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
const cellsOf = (f: Face) => Math.ceil(f.px / CELL_W);
const cellOrigin = (cell: number) => [(cell % COLS) * CELL_W, Math.floor(cell / COLS) * CELL_H];

export class Signs {
  readonly group = new THREE.Group();
  private placed: Placed[] = [];
  private grid = new Map<string, Placed[]>();
  private panels: THREE.InstancedMesh;
  private slotAttr: THREE.InstancedBufferAttribute;
  private crosses: THREE.InstancedMesh;
  private brackets: THREE.InstancedMesh;
  private doorFrames: THREE.InstancedMesh;
  private doorGlass: THREE.InstancedMesh;
  readonly doors: Door[] = [];
  private atlas: THREE.DataTexture;
  private scratch = document.createElement('canvas');
  private scratchTexture: THREE.Texture;
  private used = new Uint8Array(COLS * ROWS);
  private timer = 0;
  private white = new THREE.Color(1, 1, 1);
  private logos: LogoRect[];
  private logoImage?: HTMLImageElement;

  constructor(city: CityData, private renderer: THREE.WebGLRenderer, private view = 200) {
    this.group.name = 'signs';
    this.logos = city.logos ?? [];
    for (const sign of city.signs ?? []) {
      const p = this.place(sign, city.buildings[sign[0]]);
      if (!p) continue;
      this.placed.push(p);
      const key = `${Math.floor(p.x / GRID)},${Math.floor(p.z / GRID)}`;
      this.grid.set(key, [...(this.grid.get(key) ?? []), p]);
    }

    // The atlas lives only on the GPU: allocated empty, names copied in as they come into range.
    this.atlas = new THREE.DataTexture(null, ATLAS, ATLAS);
    this.atlas.source.dataReady = false;
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.minFilter = THREE.LinearMipmapLinearFilter;
    this.atlas.generateMipmaps = true;
    this.atlas.anisotropy = 4;
    this.atlas.needsUpdate = true;
    this.scratch.width = CELL_W * MAX_CELLS;
    this.scratch.height = CELL_H;
    this.scratchTexture = new THREE.Texture(this.scratch);
    if (this.logos.length && !new URLSearchParams(location.search).has('nologos')) {
      const image = new Image();
      image.src = '/map/logos.webp';
      image.decode().then(() => {
        this.logoImage = image;
        for (const p of this.placed) for (const f of p.faces) if (f.logo && f.cell >= 0) this.release(f);
      }, () => {});
    }

    const geometry = panelGeometry();
    // Per face: atlas offset and size of its name; size 0 = plain colour, negative v size = text running down.
    this.slotAttr = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    geometry.setAttribute('iSlot', this.slotAttr);
    const material = new THREE.MeshStandardMaterial({ map: this.atlas, roughness: 0.55 });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 iSlot;\nvarying vec4 vSlot;\nvarying vec2 vFaceUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSlot = iSlot;\nvFaceUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vSlot;\nvarying vec2 vFaceUv;')
        .replace(
          '#include <map_fragment>',
          `if (vFaceUv.x < -0.5) {
            diffuseColor.rgb = vec3(0.03);
          } else if (vSlot.z > 0.0) {
            // The atlas is uploaded top row first; vertical signs (w < 0) read their slot turned a quarter clockwise.
            vec2 f = vSlot.w < 0.0 ? vec2(1.0 - vFaceUv.y, 1.0 - vFaceUv.x) : vec2(vFaceUv.x, 1.0 - vFaceUv.y);
            diffuseColor.rgb = texture2D(map, vSlot.xy + f * vec2(vSlot.z, abs(vSlot.w))).rgb;
          }`,
        )
        .replace('#include <color_fragment>', '#if defined( USE_INSTANCING_COLOR )\nif (vSlot.z <= 0.0 && vFaceUv.x > -0.5) diffuseColor.rgb *= vColor;\n#endif');
    };
    this.panels = new THREE.InstancedMesh(geometry, material, CAPACITY);
    this.panels.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);

    const crossShape = mergeGeometries([
      new THREE.BoxGeometry(0.2, 0.62, 0.1).translate(0.62, 0, 0), new THREE.BoxGeometry(0.62, 0.2, 0.1).translate(0.62, 0, 0),
      new THREE.BoxGeometry(0.3, 0.03, 0.03).translate(0.15, 0, 0),
    ]);
    this.crosses = new THREE.InstancedMesh(
      crossShape, new THREE.MeshStandardMaterial({ color: 0x14b14b, emissive: 0x18d65a, emissiveIntensity: 1.1, roughness: 0.4 }), 400,
    );
    const bracket = new THREE.BoxGeometry(1, 0.04, 0.04).translate(0.5, 0, 0);
    this.brackets = new THREE.InstancedMesh(bracket, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.5 }), 800);
    const doors = Math.min(this.doors.length, 400) || 1;
    this.doorFrames = new THREE.InstancedMesh(doorFrameGeometry(), new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.45, metalness: 0.6 }), doors);
    this.doorGlass = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1.04, 2.1).translate(0, 1.27, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x141a1e, roughness: 0.04, metalness: 0.1, emissive: 0x3a2610, emissiveIntensity: 0.6 }),
      doors,
    );
    for (const m of [this.panels, this.crosses, this.brackets, this.doorFrames, this.doorGlass]) {
      m.frustumCulled = false;
      m.castShadow = false;
      m.receiveShadow = true;
      m.count = 0;
      this.group.add(m);
    }
  }

  private place(sign: Sign, b: Building | undefined): Placed | null {
    if (!b) return null;
    const [, edge, t, width, style, name, brand, logoIndex] = sign;
    const logo = logoIndex === undefined ? undefined : this.logos[logoIndex];
    const ring = b.rings[0];
    const n = ring.length / 2;
    const ax = ring[edge * 2], az = ring[edge * 2 + 1];
    const bx = ring[((edge + 1) % n) * 2], bz = ring[((edge + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (!len) return null;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const nx = uz, nz = -ux;
    // Same wall push as buildings.ts (+2 cm) and ground-floor height as the building shader.
    const push = 0.01 + rand(b, 7) * 0.03 + 0.02;
    const groundH = facadeStyle(rand(b, 5)).groundH;
    const wx = ax + (bx - ax) * t, wz = az + (bz - az) * t;
    const x = wx + nx * push, z = wz + nz * push;
    // Panel +z and bracket +x point out of the wall.
    const facing = turn(Math.atan2(nx, nz));
    const outward = turn(-Math.atan2(nz, nx));
    const looks = LOOKS[style];
    let look = looks[Math.floor(rand(b, edge + 11) * looks.length)];
    if (brand != null) look = solidLook(brand, 800);
    else if (logo) look = solidLook(logo[4], 700);
    const placed: Placed = { x, z, faces: [], brackets: [] };
    if (style !== 'street') {
      let along = t * len;
      if (style === 'plate') along += along + 1.0 < len - 0.7 ? 1.0 : -1.0;
      const taken = this.doors.some((d) => d.building === b && d.edge === edge && Math.abs(d.along - along) < 1.4);
      if (along > 0.7 && along < len - 0.7 && !taken) {
        const dx = ax + ux * along, dz = az + uz * along;
        this.doors.push({ x: dx, z: dz, nx, nz, ux, uz, building: b, edge, along, length: len, groundH, name, style, look });
        placed.door = pose(dx + nx * push, 0, dz + nz * push, facing);
      }
    }
    const face = (kind: FaceKind, w: number, h: number, matrices: THREE.Matrix4[], view: number, textRange: number, text = name, rotated = false) => {
      const aspect = rotated ? h / w : w / h;
      placed.faces.push({
        kind, text, look, bg: new THREE.Color(look.bg), rotated, matrices, view, textRange, cell: -1, pharmacy: style === 'pharmacy',
        px: Math.min(CELL_W * MAX_CELLS, Math.max(CELL_H, Math.round(CELL_H * aspect))), logo: kind === 'sign' ? logo : undefined,
      });
    };
    const at = (y: number, h: number, w: number, depth = 1) => pose(x, y, z, facing, w, h, depth);

    if (style === 'street') {
      face('street', width, 0.26, [at(groundH + 0.3, 0.26, width, 0.4)], 90, 45);
      return placed;
    }
    if (style === 'plate') {
      face('plate', width, 0.24, [at(1.55, 0.24, width, 0.3)], 45, 20);
      return placed;
    }
    const h = logo ? LOGO_SIGN_H : style === 'culture' ? 0.75 : style === 'public' ? 0.5 : 0.6;
    face('sign', width, h, [at(groundH - 0.65, h, width)], this.view, logo || style === 'culture' || style === 'hotel' ? 120 : 90,
      style === 'public' && !logo ? name.toUpperCase() : name);

    const end = Math.min(width / 2 + 0.3, len * (1 - t) - 0.2);
    const hx = wx + ux * end, hz = wz + uz * end;
    const hanging = (kind: 'board' | 'hotel', y: number, w: number, h: number, out: number) => {
      const cx = hx + nx * out, cz = hz + nz * out;
      const both = [Math.atan2(ux, uz), Math.atan2(ux, uz) + Math.PI].map((a) => pose(cx, y, cz, turn(a), w, h, 0.6));
      const hotel = kind === 'hotel';
      face(kind, w, h, both, hotel ? this.view : 150, hotel ? 120 : 60, hotel ? 'HOTEL' : name, hotel);
    };
    const bracket = (y: number, length: number) => placed.brackets.push(pose(hx, y, hz, outward, length));
    if (style === 'pharmacy') {
      placed.cross = pose(hx, groundH + 0.55, hz, outward);
    } else if (style === 'cafe') {
      hanging('board', groundH + 0.55, 0.9, 0.45, 0.6);
      bracket(groundH + 0.82, 1.15);
    } else if (style === 'hotel') {
      hanging('hotel', groundH + 1.5, 0.55, 2.2, 0.45);
      bracket(groundH + 2.45, 0.25);
      bracket(groundH + 0.55, 0.25);
    }
    return placed;
  }

  private alloc(cells: number): number {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0, run = 0; col < COLS; col++) {
        run = this.used[row * COLS + col] ? 0 : run + 1;
        if (run === cells) {
          const first = row * COLS + col - cells + 1;
          this.used.fill(1, first, first + cells);
          return first;
        }
      }
    }
    return -1;
  }

  private release(f: Face) {
    this.used.fill(0, f.cell, f.cell + cellsOf(f));
    f.cell = -1;
  }

  private draw(f: Face, last: boolean) {
    const cell = this.alloc(cellsOf(f));
    if (cell < 0) return;
    const c = this.scratch.getContext('2d')!;
    const w = f.px, H = CELL_H;
    c.clearRect(0, 0, this.scratch.width, H);
    c.fillStyle = f.look.bg;
    c.fillRect(0, 0, w, H);
    let x0 = 0, x1 = w;
    const framed = f.kind === 'street' || f.kind === 'board';
    if (framed) {
      c.strokeStyle = f.look.fg;
      c.lineWidth = 3;
      c.strokeRect(5, 5, w - 10, H - 10);
      x0 = 8;
      x1 = w - 8;
    }
    if (f.pharmacy && f.kind === 'sign') {
      c.fillStyle = '#ffffff';
      c.fillRect(14, 22, 30, 20);
      c.fillRect(19, 12, 20, 40);
      c.fillStyle = '#2bd46b';
      c.fillRect(17, 25, 24, 14);
      c.fillRect(22, 15, 14, 34);
      x0 = 50;
    }
    if (f.logo && this.logoImage) {
      const [lx, ly, lw, lh, , emblem] = f.logo;
      let s = (H * 0.75) / lh;
      c.font = f.look.font.replace('{s}', '18');
      const named = emblem === 1 && c.measureText(f.text).width < w - lw * s - 44;
      s = Math.min(s, (w - 16) / lw);
      const dw = lw * s, dh = lh * s;
      const dx = named ? 10 : (w - dw) / 2;
      c.drawImage(this.logoImage, lx, ly, lw, lh, dx, (H - dh) / 2, dw, dh);
      x0 = named ? dx + dw + 8 : x1;
    }
    c.fillStyle = f.look.fg;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (f.rotated) {
      const letters = [...f.text];
      const step = w / letters.length;
      c.font = f.look.font.replace('{s}', String(Math.min(46, Math.floor(step * 0.8))));
      letters.forEach((ch, i) => {
        c.save();
        c.translate(step * (i + 0.5), H / 2);
        c.rotate(-Math.PI / 2);
        c.fillText(ch, 0, 2);
        c.restore();
      });
    } else if (x1 - x0 > 24) {
      let size = framed ? 34 : 44;
      for (; size > 12; size -= 2) {
        c.font = f.look.font.replace('{s}', String(size));
        if (c.measureText(f.text).width < x1 - x0 - 16) break;
      }
      c.fillText(f.text, (x0 + x1) / 2, H / 2 + 2);
    }
    const [sx, sy] = cellOrigin(cell);
    // Mipmaps (no shimmer on distant names) are rebuilt once, after the last name of a refresh.
    this.atlas.generateMipmaps = last;
    this.renderer.copyTextureToTexture(this.scratchTexture, this.atlas, new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(w, H)), new THREE.Vector2(sx, sy));
    this.atlas.generateMipmaps = true;
    f.cell = cell;
  }

  update(camera: THREE.Vector3, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.3;
    const near: [number, Face][] = [];
    const extras: [number, Placed][] = [];
    const r = Math.ceil(this.view / GRID);
    const gx = Math.floor(camera.x / GRID), gz = Math.floor(camera.z / GRID);
    for (let i = gx - r; i <= gx + r; i++) {
      for (let j = gz - r; j <= gz + r; j++) {
        for (const p of this.grid.get(`${i},${j}`) ?? []) {
          const d = Math.hypot(p.x - camera.x, p.z - camera.z);
          for (const f of p.faces) if (d < f.view) near.push([d, f]);
          if (d < 150 && (p.cross || p.brackets.length || p.door)) extras.push([d, p]);
        }
      }
    }
    near.sort((a, b) => a[0] - b[0]);
    const wanted = new Set<Face>();
    let cells = 0;
    for (const [d, f] of near) {
      if (d > f.textRange) continue;
      cells += cellsOf(f);
      if (cells > COLS * ROWS) break;
      wanted.add(f);
    }
    for (const p of this.placed) for (const f of p.faces) if (f.cell >= 0 && !wanted.has(f)) this.release(f);
    const todo = [...wanted].filter((f) => f.cell < 0).slice(0, NEW_PER_REFRESH);
    todo.forEach((f, i) => this.draw(f, i === todo.length - 1));

    let n = 0;
    for (const [, f] of near) {
      if (n + f.matrices.length > CAPACITY) break;
      for (const m of f.matrices) {
        this.panels.setMatrixAt(n, m);
        if (f.cell >= 0) {
          const [sx, sy] = cellOrigin(f.cell);
          this.slotAttr.setXYZW(n, sx / ATLAS, sy / ATLAS, f.px / ATLAS, (f.rotated ? -CELL_H : CELL_H) / ATLAS);
          this.panels.setColorAt(n, this.white);
        } else {
          this.slotAttr.setXYZW(n, 0, 0, 0, 0);
          this.panels.setColorAt(n, f.bg);
        }
        n++;
      }
    }
    let crosses = 0, brackets = 0, doors = 0;
    for (const [d, p] of extras) {
      if (p.door && d < 80 * (this.view / 200) + 20 && doors < this.doorFrames.instanceMatrix.count) {
        this.doorFrames.setMatrixAt(doors, p.door);
        this.doorGlass.setMatrixAt(doors++, p.door);
      }
      if (p.cross && crosses < this.crosses.instanceMatrix.count) this.crosses.setMatrixAt(crosses++, p.cross);
      for (const m of p.brackets) if (brackets < this.brackets.instanceMatrix.count) this.brackets.setMatrixAt(brackets++, m);
    }
    this.panels.count = n;
    this.crosses.count = crosses;
    this.brackets.count = brackets;
    this.doorFrames.count = this.doorGlass.count = doors;
    uploadFirst(this.doorFrames.instanceMatrix, doors);
    uploadFirst(this.doorGlass.instanceMatrix, doors);
    uploadFirst(this.panels.instanceMatrix, n);
    uploadFirst(this.panels.instanceColor, n);
    uploadFirst(this.slotAttr, n);
    uploadFirst(this.crosses.instanceMatrix, crosses);
    uploadFirst(this.brackets.instanceMatrix, brackets);
  }
}
