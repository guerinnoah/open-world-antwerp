import { BALL, CYL, at, fitFont } from '../interiors';
import type { Landmark } from '../cityData';
import { MAS_ESCALATOR_HOLE } from './escalators';
import type { HallPlan } from '.';
import { hole, type HallKit } from './kit';

// Each floor's frame is turned a quarter from the one below (landmarks/mas.ts): its gallery runs along +z, its escalator up through the next box.
const FLOORS = 10, FH = 6.27, HALF = 19.5, INNER = 11, GLASS_Z = 18.55;
const ROOF = FLOORS;
const floorY = (i: number) => (i === 0 ? 0 : i * FH - 0.35); // m: walking surface of floor i
const ceilingY = (i: number) => floorY(i + 1) - 0.38;
const LANE = { z0: MAS_ESCALATOR_HOLE[2], z1: MAS_ESCALATOR_HOLE[3] }, LANE_Z = (LANE.z0 + LANE.z1) / 2;
const FOOT = -1.9, TOP = 12; // escalator ends along x (m), 1 m flat landings at each
const LIFT_X = -8;
const SANDSTONE = 0xa1493a, CONCRETE = 0xc9c5bd, STEEL = 0x2b2f33;

const NAMES: Partial<Record<Landmark['id'], string>> = {
  cathedral: 'Kathedraal', centraal: 'Centraal Station', steen: 'Het Steen', boerentoren: 'Boerentoren', stadhuis: 'Stadhuis',
};

export const mas: HallPlan = {
  name: 'MAS',
  door: { x: -12, z: HALF, nx: 0, nz: 1, w: 2.6 },
  ambient: [0xeef2f6, 1.15],
  sun: 0.65,
  keepExterior: true,
  tone: (_x, _z, level) => (level === ROOF ? { ambient: [0xdfe6ee, 0.7], sun: 1 } : { ambient: [0xeef2f6, 1.15], sun: 0.65 }),
  build(k, lm, all) {
    for (let i = 0; i < FLOORS; i++) {
      k.level = i;
      k.turn(i, 0, () => gallery(k, i));
    }
    k.level = ROOF;
    k.openAir.add(ROOF);
    k.turn(FLOORS - 1, 0, () => roofDeck(k));
    k.turn(0, 0, () => pavilion(k));
    panorama(k, lm, all);
    k.level = 0;
  },
};

function gallery(k: HallKit, i: number) {
  const y = floorY(i), top = ceilingY(i), x0 = -HALF + 0.6, x1 = HALF - 0.6;
  k.floor(x0, x1, INNER, GLASS_Z, y, top - y);
  if (i === 0) k.floor(-13.2, -10.8, GLASS_Z - 0.2, HALF + 0.1, 0, 3);
  k.flat('concrete', -HALF, HALF, INNER, HALF, y + 0.02, CONCRETE, 3);

  const [e0, e1] = MAS_ESCALATOR_HOLE;
  for (const [a, b, c, d] of [[-HALF, e0, INNER, HALF], [e1, HALF, INNER, HALF], [e0, e1, INNER, LANE.z0], [e0, e1, LANE.z1, HALF]]) {
    k.flat('plaster', a, b, c, d, top, 0xf2f2f0, 2.4, true);
  }
  for (const x of [-15, -9, -3, 3, 15]) {
    k.box('glow', x, 14.5, top - 0.04, 4, 0.12, 0.03, 0xf6f8fb);
    k.lamp(x, top - 0.3, 14.5, 8, 0xf4f6fa, 9);
  }

  const mouth = i > 0 ? [hole(-LANE.z1, -LANE.z0, y, y + 2.5, 'flat')] : [];
  k.wallZ('ashlar', INNER + 0.02, -HALF, HALF, y, top, 1, mouth, SANDSTONE, 2.4);
  liftDoor(k, LIFT_X, INNER + 0.03, y, i === 0 ? 'Lift to the roof' : 'Lift down', i);
  floorSign(k, -12.5, INNER + 0.04, y + 3.2, i);

  wavyGlass(k, y, top);
  for (const x of [-HALF + 0.55, HALF - 0.55]) {
    k.panel('glass', x, INNER, x, HALF, y, top, [x < 0 ? 1 : -1, 0], 0xffffff);
    k.box('solid', x, (INNER + HALF) / 2, y, 0.08, HALF - INNER, 0.08, STEEL);
  }
  if (i === 0) groundFloor(k);
  else furnish(k, i, y);
  escalator(k, i, y, floorY(i + 1));
  if (i > 0) tunnel(k, i - 1);
}

function wavyGlass(k: HallKit, y: number, top: number) {
  const n = 32, half = HALF - 0.6;
  for (let j = 0; j < n; j++) {
    const xa = half - (j / n) * 2 * half, xb = half - ((j + 1) / n) * 2 * half;
    const za = GLASS_Z + 0.45 + Math.sin(j * (Math.PI / 2)) * 0.45, zb = GLASS_Z + 0.45 + Math.sin((j + 1) * (Math.PI / 2)) * 0.45;
    const l = Math.hypot(xb - xa, zb - za);
    k.panel('glass', xa, za, xb, zb, y, top, [-(zb - za) / l, (xb - xa) / l], 0xffffff);
    if (j % 2 === 0) k.box('solid', xa, za, y, 0.07, 0.07, top - y, STEEL);
  }
  k.box('solid', 0, GLASS_Z + 0.45, y, 2 * half, 0.25, 0.1, STEEL);
}

function liftDoor(k: HallKit, x: number, z: number, y: number, label: string, i: number) {
  k.box('shiny', x, z, y, 2.2, 0.06, 2.5, 0x9ea4a8);
  k.box('shiny', x, z + 0.02, y, 0.02, 0.05, 2.4, 0x5a5f63);
  k.box('glow', x + 1.4, z + 0.02, y + 1.1, 0.12, 0.03, 0.2, 0xffffff);
  k.lift(x, z + 1.2, label, i === 0 ? { level: ROOF, x: 0, z: 6.2, heading: Math.PI / 2 } : { level: 0, x: LIFT_X, z: INNER + 1.4, heading: Math.PI / 2 });
}

function floorSign(k: HallKit, x: number, z: number, y: number, i: number) {
  k.sheet(x, y, z, 2.4, 1.2, 0, (g, w, h) => {
    g.fillStyle = '#f2efe8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b8282e';
    g.font = `700 ${Math.round(h * 0.62)}px 'Helvetica Neue', Arial, sans-serif`;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(String(i), w * 0.08, h * 0.55);
    g.fillStyle = '#1d1d1b';
    g.font = `700 ${Math.round(h * 0.2)}px 'Helvetica Neue', Arial, sans-serif`;
    g.fillText('MAS', w * 0.42, h * 0.36);
    g.font = `${Math.round(h * 0.15)}px 'Helvetica Neue', Arial, sans-serif`;
    g.fillText(i === 0 ? 'Museum aan de Stroom' : 'Boulevard', w * 0.42, h * 0.62);
  }, false, `mas-floor-${i}`);
}

function bench(k: HallKit, x: number, z: number, y: number) {
  k.box('solid', x, z, y + 0.4, 2.6, 0.55, 0.08, 0x6b4c34);
  for (const e of [-1, 1]) k.box('solid', x + e * 1.1, z, y, 0.1, 0.5, 0.4, STEEL);
  k.block(x, z, 2.6, 0.55);
}

function vitrine(k: HallKit, x: number, z: number, y: number, what: number) {
  k.box('solid', x, z, y, 1.2, 1.2, 0.9, 0xeceae4);
  k.box('glass', x, z, y + 0.9, 1.2, 1.2, 1.0, 0xffffff);
  k.block(x, z, 1.2, 1.2);
  if (what === 0) {
    k.box('solid', x, z, y + 0.95, 0.8, 0.18, 0.14, 0x5a3a22);
    k.box('solid', x - 0.25, z, y + 1.09, 0.2, 0.16, 0.08, 0x6b4a2c);
    for (const dx of [-0.25, 0, 0.22]) {
      k.box('solid', x + dx, z, y + 1.09, 0.015, 0.015, 0.55, 0x3a2614);
      k.box('solid', x + dx, z, y + 1.3, 0.02, 0.24, 0.2, 0xeee6d2);
    }
  } else if (what === 1) {
    k.geom('shiny', CYL, at(x, y + 1.15, z, 0.18, 0.5, 0.18), 0xb8862e);
    k.geom('shiny', BALL, at(x, y + 1.45, z, 0.15, 0.1, 0.15), 0xb8862e);
  } else {
    k.geom('solid', BALL, at(x, y + 1.25, z, 0.2, 0.32, 0.16), 0x7a5a3a);
    k.box('solid', x, z, y + 0.9, 0.3, 0.3, 0.06, 0x2a2a2a);
  }
  k.lamp(x, y + 2.6, z, 2, 0xfff4e4, 4, true);
}

function groundFloor(k: HallKit) {
  k.box('solid', 2, 12.6, 0, 6, 0.9, 1.05, 0xeceae4);
  k.box('solid', 2, 12.15, 0.2, 6, 0.02, 0.6, 0xb8282e);
  k.block(2, 12.6, 6, 0.9);
  for (const x of [0.5, 3.5]) k.person(x, 11.7, 0, 1);
  k.sheet(2, 3.6, INNER + 0.05, 5, 1.1, 0, (g, w, h) => {
    g.fillStyle = '#1d1d1b';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.font = `900 ${Math.round(h * 0.55)}px 'Helvetica Neue', Arial, sans-serif`;
    g.fillText('MAS', w / 2, h * 0.42);
    g.font = `${Math.round(h * 0.18)}px 'Helvetica Neue', Arial, sans-serif`;
    g.fillText('Museum aan de Stroom', w / 2, h * 0.8);
  }, false, 'mas-desk');
  for (const z of [12.2, 13.6]) {
    k.box('solid', 16.5, z, 0, 3.6, 0.5, 1.8, 0x3a3a3a);
    for (let x = 15; x < 18.2; x += 0.3) k.box('solid', x, z + 0.27, 0.3 + (Math.round(x * 10) % 3) * 0.5, 0.22, 0.04, 0.3, [0xc0392b, 0xf2efe6, 0x1f5fa8, 0xf1c40f][Math.round(x * 10) % 4]);
    k.block(16.5, z, 3.6, 0.5);
  }
  for (const [x, z, fx, fz] of [[-6, 14, 0.3, 1], [1, 14.4, 0, -1], [3, 14.3, -0.3, -1], [-15, 17.5, 0, 1], [14.5, 15, 1, 0]] as const) k.person(x, z, fx, fz);
  bench(k, -15, 12.4, 0);
  k.person(-15.4, 12.4, 0, 1, 0, 'moped');
}

function furnish(k: HallKit, i: number, y: number) {
  bench(k, -12, 12.4, y);
  bench(k, 15.5, 12.4, y);
  vitrine(k, 4 + (i % 3), 13, y, i % 3);
  if (i % 2) k.person(-12.4, 12.4, 0, 1, y, 'moped');
  for (const [x, z, fx, fz] of [[-9 + (i % 3) * 2, 18, 0.2, 1], [-5.5 + (i % 2), 18.1, -0.1, 1], [16, 17.5, 0.4, 1], [5 + (i % 3), 14.6, 0, -1]] as const) {
    if ((x * 7 + i * 3) % 5 < 3) k.person(x, z, fx, fz, y);
  }
}

function escalator(k: HallKit, i: number, y0: number, y1: number) {
  const w = LANE.z1 - LANE.z0, z = LANE_Z, xa = FOOT + 1, xb = TOP - 1, run = xb - xa, rise = y1 - y0;
  k.escalator([FOOT, y0, z], [TOP, y1, z], w, i + 1);
  const slope = (x: number) => y0 + ((x - xa) / run) * rise;
  k.bar('solid', [xa, y0 - 0.55, z], [xb, y1 - 0.55, z], 0.9, w, 0x3a3e43);
  k.box('shiny', (FOOT + xa) / 2, z, y0, 1, w - 0.2, 0.03, 0x9ea4a8);
  k.box('shiny', (xb + TOP) / 2, z, y1, 1, w - 0.2, 0.03, 0x9ea4a8);
  const steps = Math.round(run / 0.4);
  for (let s = 0; s < steps; s++) {
    const x = xa + (s + 0.5) * (run / steps);
    k.box('solid', x, z, slope(x - run / steps / 2) - 0.25, run / steps, w - 0.25, 0.25 + rise / steps, 0x55595e);
  }
  for (const side of [LANE.z0, LANE.z1]) {
    const n = side === LANE.z0 ? -1 : 1;
    k.quad('glass', [(xa + xb) / 2, (y0 + y1) / 2 + 0.5, side], [run / 2, rise / 2, 0], [0, 0.5, 0], [0, 0, n], 0xffffff);
    k.bar('solid', [xa - 0.8, y0 + 1.0, side], [xa, y0 + 1.0, side], 0.08, 0.1, 0x111111);
    k.bar('solid', [xa, y0 + 1.0, side], [xb, y1 + 1.0, side], 0.08, 0.1, 0x111111);
    k.bar('solid', [xb, y1 + 1.0, side], [xb + 0.8, y1 + 1.0, side], 0.08, 0.1, 0x111111);
    k.bar('solid', [xa, y0 - 0.1, side], [xb, y1 - 0.1, side], 0.25, 0.12, 0xb8bcc0);
  }
  k.lamp((xa + xb) / 2, (y0 + y1) / 2 + 2.5, z, 6, 0xf4f6fa, 8);
}

/** Floor i's escalator shaft through the box above, drawn in floor i's frame: called from floor i + 1's turn, so it turns back. */
function tunnel(k: HallKit, i: number) {
  k.turn(i, 0, () => {
    const y0 = floorY(i), y1 = floorY(i + 1), xa = FOOT + 1, xb = TOP - 1, ceil = ceilingY(i);
    const [e0] = MAS_ESCALATOR_HOLE, roofAt = (x: number) => y0 + ((x - xa) / (xb - xa)) * (y1 - y0) + 2.5;
    for (const [z, n] of [[LANE.z0, 1], [LANE.z1, -1]] as const) {
      const outline: [number, number][] = [[e0, ceil], [INNER, ceil], [INNER, y1 + 2.5], [e0, roofAt(e0)]];
      k.wall('plaster', 0, 0, z, 0, n, outline.map(([x, yy]) => [n * x, yy] as [number, number]), [], 0xe6e6e2);
    }
    const dx = xb - e0, dy = roofAt(xb) - roofAt(e0), l = Math.hypot(dx, dy);
    k.quad('plaster', [(e0 + xb) / 2, (roofAt(e0) + roofAt(xb)) / 2, LANE_Z], [dx / 2, dy / 2, 0], [0, 0, (LANE.z1 - LANE.z0) / 2], [dy / l, -dx / l, 0], 0xe6e6e2);
    k.flat('plaster', xb, INNER + 0.02, LANE.z0, LANE.z1, y1 + 2.5, 0xe6e6e2, 2.4, true);
    k.box('glow', (e0 + xb) / 2, LANE_Z, (roofAt(e0) + roofAt(xb)) / 2 - 0.05, 0.12, 0.6, 0.03, 0xf6f8fb);
    k.lamp((e0 + xb) / 2, y1 + 1, LANE_Z, 3, 0xf4f6fa, 5);
  });
}

function roofDeck(k: HallKit) {
  const y = floorY(ROOF), e = HALF - 0.4, [e0, e1] = MAS_ESCALATOR_HOLE;
  const a = LANE.z0 - 0.2, b = LANE.z1 + 0.2;
  for (const [x0, x1, z0, z1] of [[-e, e, -e, a], [-e, e0 - 0.2, a, e], [e1, e, a, e], [e0 - 0.2, e1, b, e]]) {
    k.floor(x0, x1, z0, z1, y, 30);
    k.flat('planks', x0 - (x0 === -e ? 0.4 : 0), x1 + (x1 === e ? 0.4 : 0), z0 - (z0 === -e ? 0.4 : 0), z1 + (z1 === e ? 0.4 : 0), y + 0.02, 0xb9b2a6, 2);
  }
  for (const [ax, az, bx, bz, n] of [[-HALF + 0.2, e + 0.1, HALF - 0.2, e + 0.1, [0, -1]], [-HALF + 0.2, -e - 0.1, HALF - 0.2, -e - 0.1, [0, 1]],
    [e + 0.1, -HALF + 0.2, e + 0.1, HALF - 0.2, [-1, 0]], [-e - 0.1, -HALF + 0.2, -e - 0.1, HALF - 0.2, [1, 0]]] as const) {
    k.panel('glass', ax, az, bx, bz, y, y + 1.08, [n[0], n[1]], 0xffffff);
  }
  const hood = 2.6;
  for (const z of [LANE.z0 - 0.15, LANE.z1 + 0.15]) k.panel('glass', e0, z, e1, z, y, y + hood, [0, z < LANE_Z ? -1 : 1], 0xffffff);
  k.panel('glass', e0, LANE.z0 - 0.15, e0, LANE.z1 + 0.15, y, y + hood, [-1, 0], 0xffffff);
  k.flat('glass', e0, e1 + 1, LANE.z0 - 0.15, LANE.z1 + 0.15, y + hood, 0xffffff, 0, false);
  for (const x of [e0, e1 + 1]) {
    for (const z of [LANE.z0 - 0.15, LANE.z1 + 0.15]) k.box('solid', x, z, y, 0.05, 0.05, hood, STEEL);
    k.box('solid', x, LANE_Z, y + hood - 0.05, 0.05, LANE.z1 - LANE.z0 + 0.3, 0.05, STEEL);
  }
  for (const [x, z] of [[-12, -12], [12, -12], [-12, 8]] as const) {
    bench(k, x, z, y);
    k.person(x - 0.5, z, 0, 1, y, 'moped');
  }
  for (let j = 0; j < 14; j++) {
    const side = j % 4, s = -15 + ((j * 7.3) % 30);
    const [x, z, fx, fz] = side === 0 ? [s, e - 0.6, 0, 1] : side === 1 ? [s, -e + 0.6, 0, -1] : side === 2 ? [e - 0.6, s, 1, 0] : [-e + 0.6, s, -1, 0];
    if (Math.abs(x - 8) < 4 && z > 14) continue;
    k.person(x, z, fx, fz, y);
  }
  for (const [x, z, fx, fz] of [[e - 0.5, -e + 0.5, 1, -1], [-e + 0.5, e - 0.5, -1, 1]] as const) telescope(k, x, z, y, fx, fz);
}

function telescope(k: HallKit, x: number, z: number, y: number, fx: number, fz: number) {
  k.cyl('shiny', x, y, z, 0.06, 1.1, 0x3a6a9a);
  k.bar('shiny', [x - fx * 0.25, y + 1.2, z - fz * 0.25], [x + fx * 0.25, y + 1.3, z + fz * 0.25], 0.16, 0.16, 0x3a6a9a);
  k.block(x, z, 0.4, 0.4, true);
}

function pavilion(k: HallKit) {
  const y = floorY(ROOF);
  k.block(0, 0, 14.2, 9.2);
  k.box('shiny', 0, 4.53, y, 2.2, 0.06, 2.5, 0x9ea4a8);
  k.lift(0, 5.4, 'Lift down', { level: 0, x: LIFT_X, z: INNER + 1.4, heading: Math.PI / 2 });
  k.lamp(0, y + 6, 0, 1, 0xffffff, 1);
}

function panorama(k: HallKit, lm: Landmark, all: Landmark[]) {
  const y = floorY(ROOF), c = Math.cos(lm.angle), s = Math.sin(lm.angle), e = HALF - 0.3;
  for (const o of all) {
    const name = NAMES[o.id];
    if (!name) continue;
    const dx = o.x - lm.x, dz = o.z - lm.z, dist = Math.hypot(dx, dz);
    const lx = (dx * c + dz * s) / dist, lz = (-dx * s + dz * c) / dist, t = e / Math.max(Math.abs(lx), Math.abs(lz));
    const x = lx * t, z = lz * t, yaw = Math.atan2(-lx, -lz);
    const text = `${name}  ${(dist / 1000).toFixed(1)} km`;
    k.sheet(x, y + 1.3, z, 1.6, 0.4, yaw, (g, w, h) => {
      g.fillStyle = '#1d1d1b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      fitFont(g, "700 {s}px 'Helvetica Neue', Arial, sans-serif", text, w * 0.82, Math.round(h * 0.5));
      g.fillText(`${text}  ↑`, w / 2, h * 0.54);
    }, false, `mas-panorama-${o.id}`);
  }
}
