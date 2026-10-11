import { parkMiller } from '../../core/util';
import { BALL, CYL, WARM, at, fitFont } from '../interiors';
import type { HallPlan } from '.';
import { hole, vaultProfile, type HallKit } from './kit';

const STONE = 0xd8cfbf;
const FLAGS = 0xc9c3b8;
const OAK = 0x4a3220;
const RED = '#d7192d'; // Visit Antwerpen's red
const DAY = 0xdce6f2;

// Gate passage from the door on the river side into the great hall, which fills the old keep's ground floor.
const P = { x0: -4.6, x1: -1.4, z0: 8.5, z1: 15.75 };
const H = { x0: -6.5, x1: 18.5, z0: -4, z1: 8.5, h: 7.2 };
const S = { x0: -13.6, x1: -7.1, z0: 0.5, z1: 8, h: 4.4 };

export const steen: HallPlan = {
  name: 'Het Steen',
  door: { x: -3, z: P.z1, nx: 0, nz: 1, w: 2.4 },
  ambient: [0xffe2c4, 0.7],
  sun: 0.08,
  build(k) {
    passage(k);
    hall(k);
    storyRoom(k);
  },
};

function passage(k: HallKit) {
  const { x0, x1, z0, z1 } = P, spring = 2.6;
  k.floor(x0, x1, z0, z1 + 0.3, 0, 3.9);
  k.flat('flags', x0, x1, z0, z1, 0.01, FLAGS, 1.6);
  k.wallX('ashlar', x0, z0, z1, 0, spring, 1, [], STONE, 2.2);
  k.wallX('ashlar', x1, z0, z1, 0, spring, -1, [], STONE, 2.2);
  k.vault('plaster', z0, z1, vaultProfile(x0, x1, spring, 'round'), 0xe6ddcc, true);
  const door = hole(-4.2, -1.8, 0, 2.4);
  k.wallZ('ashlar', z1, x0, x1, 0, 4.3, -1, [door], STONE, 2.2);
  k.reveal('ashlar', door, true, z1, 0.5, STONE, 2.2);
  k.quad('glass', [-3, 1.8, z1 + 0.45], [1.2, 0, 0], [0, 1.8, 0], [0, 0, -1], 0xffffff);
  k.box('solid', -3, z1 + 0.45, 0, 0.06, 0.06, 2.4, 0x2a2622);
  k.box('solid', -3, z1 + 0.45, 2.38, 2.4, 0.06, 0.06, 0x2a2622);
  k.lamp(-3, 2.2, z1 + 2, 9, DAY, 9);
  for (const z of [10.5, 13.5]) lantern(k, x0 + 0.12, z, 1);
}

function lantern(k: HallKit, x: number, z: number, side: number) {
  k.box('solid', x + side * 0.12, z, 1.86, 0.24, 0.04, 0.04, 0x1e1e1e);
  k.box('glow', x + side * 0.28, z, 1.56, 0.15, 0.15, 0.26, 0xffcf8a);
  for (const y of [1.52, 1.82]) k.box('solid', x + side * 0.28, z, y, 0.19, 0.19, 0.05, 0x1e1e1e);
  k.lamp(x + side * 0.6, 1.7, z, 1.6, WARM, 5);
}

function hall(k: HallKit) {
  const { x0, x1, z0, z1, h } = H;
  k.floor(x0, x1, z0, z1, 0, h);
  k.flat('flags', x0, x1, z0, z1, 0.01, FLAGS, 1.6);
  k.flat('planksDark', x0, x1, z0, z1, h, 0xffffff, 2, true);
  for (let x = x0 + 1.2; x < x1; x += 2.2) k.box('solid', x, (z0 + z1) / 2, h - 0.34, 0.3, z1 - z0, 0.34, OAK);
  for (const z of [z0 + 0.15, z1 - 0.15]) k.box('solid', (x0 + x1) / 2, z, h - 0.5, x1 - x0, 0.3, 0.5, OAK);

  const windows = [-3, 3, 9, 15].map((x) => hole(x - 0.5, x + 0.5, 5.2, 6.4));
  k.wallZ('ashlar', z0, x0, x1, 0, h, 1, windows, STONE, 2.2);
  for (const w of windows) {
    k.reveal('ashlar', w, true, z0 - 0.7, 0.7, STONE, 2.2);
    k.quad('glow', [(w.a + w.b) / 2, 6.05, z0 - 0.69], [0.5, 0, 0], [0, 0.85, 0], [0, 0, 1], DAY);
    k.box('solid', (w.a + w.b) / 2, z0 - 0.66, 5.2, 0.04, 0.03, 1.7, 0x2a2622);
    k.lamp((w.a + w.b) / 2, 6, z0 + 1.2, 6, DAY, 9);
  }
  const arch = hole(P.x0, P.x1, 0, 2.6);
  k.wallZ('ashlar', z1, x0, x1, 0, h, -1, [arch], STONE, 2.2);
  const side = hole(3, 6, 0, 2.5);
  k.wallX('ashlar', x0, z0, z1, 0, h, 1, [side], STONE, 2.2);
  k.wallX('ashlar', x1, z0, z1, 0, h, -1, [], STONE, 2.2);

  desk(k);
  shop(k);
  cityModel(k, 11.5, 1);
  tapestries(k);
  for (const [x, z] of [[2, -2.6], [10, -2.6]] as const) bench(k, x, z, 2.4, 0);

  for (let x = 0; x < x1; x += 6) {
    k.box('solid', x, 2.2, h - 1.2, 0.02, 0.02, 1.2, 0x111111);
    k.box('solid', x, 2.2, h - 1.25, 3.2, 0.12, 0.08, 0x1b1b1b);
    k.box('glow', x, 2.2, h - 1.26, 3.1, 0.08, 0.01, 0xfff1dc);
    k.lamp(x, h - 1.5, 2.2, 8, 0xfff0dc, 10, true);
  }

  for (const [x, z, fx, fz] of [[4.5, 4.6, 0, -1], [6, 4.8, -0.3, -1], [12, -2.8, 0, -1], [-2, -2.9, 0.2, -1], [9.1, 1, 1, 0], [13.9, 2.2, -1, -0.3],
    [16.6, 0, 1, 0], [16.4, 4.5, 1, 0.2], [1, 7.2, 0, -1], [-4.5, 0.5, 0, 1]] as const) k.person(x, z, fx, fz);
  for (const [x, z] of [[2.3, -2.6], [10.6, -2.6]] as const) k.person(x, z, 0, -1, 0, 'moped');
}

function desk(k: HallKit) {
  const z = 3.6;
  k.box('solid', 4.5, z, 0, 6, 0.8, 1.02, 0xf2f0ea);
  k.box('shiny', 4.5, z, 1.02, 6.1, 0.9, 0.04, 0x2a2a2a);
  k.box('solid', 4.5, z + 0.41, 0.1, 6, 0.02, 0.8, 0xd7192d);
  k.block(4.5, z, 6, 0.8);
  for (const x of [2.5, 4.5, 6.5]) {
    k.box('solid', x, z - 0.2, 1.06, 0.36, 0.04, 0.26, 0x222222);
    k.box('glow', x, z - 0.17, 1.08, 0.32, 0.01, 0.2, 0x9ab8d8);
  }
  for (const x of [3.2, 5.8]) k.person(x, z - 1, 0, 1);
  k.sheet(4.5, 5.2, z + 0.02, 3.6, 0.9, 0, (g, w, hh) => {
    g.fillStyle = RED;
    g.fillRect(0, 0, w, hh);
    g.fillStyle = '#fff';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    fitFont(g, "700 {s}px 'Helvetica Neue', Arial, sans-serif", 'VISIT ANTWERPEN', w * 0.76, Math.round(hh * 0.42));
    g.fillText('VISIT ANTWERPEN', w * 0.19, hh * 0.53);
    g.textAlign = 'center';
    g.beginPath();
    g.arc(w * 0.1, hh / 2, hh * 0.32, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = RED;
    g.font = `italic 700 ${Math.round(hh * 0.5)}px Georgia, serif`;
    g.fillText('i', w * 0.1, hh * 0.54);
  }, true, 'steen-desk');
  for (const x of [3, 6]) k.box('solid', x, z + 0.02, 5.65, 0.015, 0.015, H.h - 5.65, 0x111111);
}

function shop(k: HallKit) {
  const x = H.x1 - 0.3;
  const goods = [0xc0392b, 0xf1c40f, 0x1f5fa8, 0xf2efe6, 0x6d4c41, 0x2e7d32, 0xe67e22];
  for (const z of [-2.6, 0, 2.6, 5.2]) {
    k.box('solid', x + 0.2, z, 0, 0.04, 2.2, 2.1, 0x4a3426);
    for (const e of [-1, 1]) k.box('solid', x, z + e * 1.08, 0, 0.44, 0.04, 2.1, 0x4a3426);
    k.block(x, z, 0.5, 2.2);
    for (const y of [0.1, 0.55, 1.0, 1.45, 1.9]) {
      k.box('solid', x, z, y - 0.03, 0.42, 2.12, 0.03, 0x6b4c38);
      if (y > 1.8) continue;
      for (let s = -0.95; s < 0.9; s += 0.14 + k.r() * 0.1) {
        const hgt = 0.1 + k.r() * 0.22;
        k.box('solid', x - 0.02, z + s + 0.05, y, 0.26, 0.1, hgt, goods[Math.floor(k.r() * goods.length)]);
      }
    }
  }
  k.sheet(x - 0.27, 2.75, 1.3, 3, 0.5, -Math.PI / 2, (g, w, h) => {
    g.fillStyle = '#1d1d1b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.font = `700 ${Math.round(h * 0.5)}px 'Helvetica Neue', Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('CITY SHOP', w / 2, h * 0.53);
  }, false, 'steen-shop');
  k.cyl('shiny', 15.6, 0, 6.2, 0.03, 1.7, 0x9a9da0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    k.geom('solid', CYL, at(15.6 + Math.cos(a) * 0.14, 1.1, 6.2 + Math.sin(a) * 0.14, 0.12, 0.9, 0.12, a, 0, 0), [0xf4e2c4, 0xc9e1f2, 0xf2c9c9, 0xd8f2c9][i]);
  }
  k.block(15.6, 6.2, 0.5, 0.5, true);
}

function cityModel(k: HallKit, cx: number, cz: number) {
  const w = 3.6, d = 2.6, top = 0.86;
  k.box('solid', cx, cz, 0, w + 0.1, d + 0.1, top, 0x3a2a1e);
  k.block(cx, cz, w + 0.1, d + 0.1);
  k.box('solid', cx, cz, top, w, d, 0.02, 0x9da486);
  k.box('shiny', cx - w / 2 + 0.35, cz, top + 0.01, 0.5, d, 0.02, 0x3d5a73);
  for (let i = 0; i < 160; i++) {
    const x = cx - w / 2 + 0.7 + k.r() * (w - 0.8), z = cz - d / 2 + 0.1 + k.r() * (d - 0.2);
    if (Math.hypot(x - cx, z - cz) > 1.5 && k.r() < 0.5) continue;
    const hgt = 0.03 + k.r() * 0.05;
    k.box('solid', x, z, top + 0.02, 0.05 + k.r() * 0.06, 0.05 + k.r() * 0.06, hgt, [0xb5543a, 0xc9b8a0, 0x8a3d2c, 0xd8cfbf][Math.floor(k.r() * 4)]);
  }
  k.box('solid', cx + 0.2, cz + 0.3, top + 0.02, 0.18, 0.08, 0.12, 0xd6cfc0);
  k.box('solid', cx + 0.28, cz + 0.3, top + 0.02, 0.05, 0.05, 0.4, 0xd6cfc0);
  k.geom('solid', BALL, at(cx - w / 2 + 0.75, top + 0.06, cz - 0.2, 0.08, 0.06, 0.08), 0x8f8b83);
  k.box('glass', cx, cz, top + 0.02, w, d, 0.4, 0xffffff);
  k.lamp(cx, 3, cz, 4, 0xfff4e0, 5, true);
}

const WEAVES = [
  ['#e2403a', '#f2b33d', '#2a5ea8', '#f4ead8', '#1d1d1b'],
  ['#2d8a63', '#f0c94a', '#e46a2e', '#f4ead8', '#24324a'],
  ['#7b3fa0', '#e9579a', '#41b5c9', '#f6e7cf', '#1f1f1f'],
];

/** The six big tapestries (Sam Vanallemeersch): bold flat colour, the city's story in pictograms. */
function tapestries(k: HallKit) {
  const hang: [number, number, number, number][] = [[0, H.z0 + 0.06, 0, 3.4], [6, H.z0 + 0.06, 0, 3.4], [12, H.z0 + 0.06, 0, 3.4],
    [5, H.z1 - 0.06, Math.PI, 3.2], [12, H.z1 - 0.06, Math.PI, 3.2], [H.x0 + 0.06, -1.6, Math.PI / 2, 3]];
  hang.forEach(([x, z, yaw, w], i) => {
    const colours = WEAVES[i % 3], hgt = 4;
    k.sheet(x, 0.9 + hgt / 2, z, w, hgt, yaw, (g, W, Hh) => weave(g, W, Hh, colours, i), false, `steen-tapestry-${i}`);
    const [fx, fz] = [Math.sin(yaw), Math.cos(yaw)];
    k.box('shiny', x, z - fz * 0.02, 0.9 + hgt + 0.05, Math.abs(fz) * (w + 0.2) + 0.05, Math.abs(fx) * (w + 0.2) + 0.05, 0.04, 0x2a2a2a);
    k.lamp(x + fx * 2.2, 5.6, z + fz * 2.2, 3.2, 0xfff0dc, 6, true);
  });
}

function weave(g: CanvasRenderingContext2D, w: number, h: number, c: string[], seed: number) {
  const r = parkMiller(seed * 977 + 13);
  g.fillStyle = c[3];
  g.fillRect(0, 0, w, h);
  const cell = w / 6;
  for (let y = 0; y < h; y += cell) {
    for (let x = 0; x < w; x += cell) {
      g.fillStyle = c[Math.floor(r() * 5)];
      const kind = Math.floor(r() * 5);
      if (kind === 0) g.fillRect(x, y, cell, cell);
      else if (kind === 1) {
        g.beginPath();
        g.arc(x + cell / 2, y + cell / 2, cell * 0.42, 0, Math.PI * 2);
        g.fill();
      } else if (kind === 2) {
        g.beginPath();
        g.moveTo(x, y + cell);
        g.lineTo(x + cell / 2, y);
        g.lineTo(x + cell, y + cell);
        g.fill();
      } else if (kind === 3) {
        g.fillRect(x, y + cell * 0.35, cell, cell * 0.3);
        g.fillRect(x + cell * 0.35, y, cell * 0.3, cell);
      }
    }
  }
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 1;
  for (let y = 0; y < h; y += 3) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
}

function bench(k: HallKit, x: number, z: number, length: number, rot: number) {
  const [sx, sz] = rot ? [0.45, length] : [length, 0.45];
  k.box('solid', x, z, 0.42, sx, sz, 0.06, 0x6b4c38);
  for (const e of [-1, 1]) k.box('solid', x + (rot ? 0 : (e * (length - 0.2)) / 2), z + (rot ? (e * (length - 0.2)) / 2 : 0), 0, rot ? 0.4 : 0.08, rot ? 0.08 : 0.4, 0.42, 0x2a2a2a);
  k.block(x, z, sx, sz);
}

function storyRoom(k: HallKit) {
  const { x0, x1, z0, z1, h } = S;
  k.floor(x1 - 0.2, H.x0 + 0.2, 3.1, 5.9, 0, 2.4);
  k.floor(x0, x1, z0, z1, 0, h);
  k.flat('planksDark', x0, x1, z0, z1, 0.01, 0x9a9a9a, 2);
  k.flat('plaster', x0, x1, z0, z1, h, 0x1c1c20, 2.4, true);
  const door = hole(3, 6, 0, 2.5);
  k.wallX('plaster', x1, z0, z1, 0, h, -1, [door], 0x26262b, 2.4);
  k.reveal('ashlar', door, false, x1, 0.6, STONE, 2.2);
  k.wallX('plaster', x0, z0, z1, 0, h, 1, [], 0x26262b, 2.4);
  k.wallZ('plaster', z0, x0, x1, 0, h, 1, [], 0x26262b, 2.4);
  k.wallZ('plaster', z1, x0, x1, 0, h, -1, [], 0x26262b, 2.4);
  k.sheet(x0 + 0.05, 2.1, (z0 + z1) / 2, 6.4, 3.2, Math.PI / 2, mapOfAntwerp, true, 'steen-story');
  k.lamp(x0 + 2, 2.2, (z0 + z1) / 2, 5, 0xbcd0e8, 7);
  for (const x of [-10, -11.6]) bench(k, x, (z0 + z1) / 2, 4.6, 1);
  for (const [x, z] of [[-10, 2.6], [-10, 5.4], [-11.6, 4.2]] as const) k.person(x, z, -1, 0, 0, 'moped');
}

/** The projection: old Antwerp inside its walls on the Scheldt bend, ships on the river. */
function mapOfAntwerp(g: CanvasRenderingContext2D, w: number, h: number) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#e9dcbc');
  grad.addColorStop(1, '#d2c19a');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#6f8fa3';
  g.beginPath();
  g.moveTo(w * 0.05, 0);
  g.bezierCurveTo(w * 0.22, h * 0.3, w * 0.12, h * 0.65, w * 0.3, h);
  g.lineTo(w * 0.08, h);
  g.bezierCurveTo(w * 0.0, h * 0.6, w * 0.08, h * 0.3, 0, 0);
  g.fill();
  g.strokeStyle = '#7a5a3a';
  g.lineWidth = h * 0.012;
  g.beginPath();
  g.moveTo(w * 0.2, h * 0.08);
  g.lineTo(w * 0.62, h * 0.12);
  g.lineTo(w * 0.78, h * 0.45);
  g.lineTo(w * 0.62, h * 0.86);
  g.lineTo(w * 0.24, h * 0.92);
  g.stroke();
  const r = parkMiller(5);
  for (let i = 0; i < 260; i++) {
    const x = w * (0.24 + r() * 0.5), y = h * (0.14 + r() * 0.74);
    g.fillStyle = r() < 0.5 ? '#a0503a' : '#8a6a4a';
    g.fillRect(x, y, w * 0.012, h * 0.018);
  }
  g.fillStyle = '#5a5048';
  g.fillRect(w * 0.42, h * 0.3, w * 0.02, h * 0.16);
  for (const [x, y] of [[0.12, 0.25], [0.16, 0.55], [0.2, 0.8]]) {
    g.fillStyle = '#3a2a1a';
    g.fillRect(w * x, h * y, w * 0.05, h * 0.02);
    g.fillStyle = '#f4ecd8';
    g.beginPath();
    g.moveTo(w * (x + 0.025), h * (y - 0.07));
    g.lineTo(w * (x + 0.045), h * y);
    g.lineTo(w * (x + 0.005), h * y);
    g.fill();
  }
  g.fillStyle = '#2b2118';
  g.font = `italic 700 ${Math.round(h * 0.09)}px Georgia, serif`;
  g.textAlign = 'right';
  g.fillText('The Antwerp Story', w * 0.96, h * 0.12);
  g.font = `italic ${Math.round(h * 0.05)}px Georgia, serif`;
  g.fillText('Antverpia, anno 1565', w * 0.96, h * 0.2);
}
