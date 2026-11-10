import * as THREE from 'three';
import { canvasTexture } from '../../core/canvasText';
import { parkMiller } from '../../core/util';

export type FloorKind = 'planks' | 'planksDark' | 'tiles' | 'checker' | 'marble' | 'carpet' | 'concrete';
export type WallKind = 'plaster' | 'brick' | 'whiteBrick' | 'subway' | 'stripes';
export type Surface = FloorKind | WallKind;

export const REPEAT: Record<WallKind, number> = { plaster: 2.4, brick: 1.2, whiteBrick: 1.2, subway: 1.2, stripes: 1.6 }; // m per texture tile
export const WALL_ROUGHNESS: Record<WallKind, number> = { plaster: 0.92, brick: 0.95, whiteBrick: 0.9, subway: 0.22, stripes: 0.8 };

const surfaces = new Map<string, THREE.CanvasTexture>();
export function surfaceTexture(kind: Surface, tint = '#3a3d4a'): THREE.CanvasTexture {
  const key = kind + tint;
  let tex = surfaces.get(key);
  if (tex) return tex;
  tex = canvasTexture(512, 512, (g) => paint(g, kind, tint));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  surfaces.set(key, tex);
  return tex;
}

function paint(g: CanvasRenderingContext2D, kind: Surface, tint: string) {
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
}

export const FLOOR_ROUGHNESS: Record<FloorKind, number> = { planks: 0.5, planksDark: 0.45, tiles: 0.3, checker: 0.35, marble: 0.12, carpet: 0.95, concrete: 0.35 };
