import * as THREE from 'three';
import type { Door } from '../signs';
import { pick } from '../../core/util';
import { AISLES, BOOKS, CLOTHES, PACKS, PICTURE_FROM, beer, block, bottles, ceilingLight, chair, clock, counter, deskLamp, fits, label, menu, pendant, person, picture, plant, seatTable, setting, shelving, sit, spot, staffDoor, stanchions, table, taps, till, wallBox, type Goods } from './furniture';
import { SOFT, lamp } from './lighting';
import { BALL, BEAM, CYL, FRONT, KNOT, at } from './mesher';
import { entryZ, inEntry, type Kit, type Place, type Wall } from './room';

export function furnish(k: Kit, door: Door) {
  const style = door.style as Place;
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
          ['Frikandel', '3,10'], ['Stoofvleessaus', '1,90'], ['Cola', '2,50']], door.look);
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
        for (let z = PICTURE_FROM; z < barZ - 2.1; z += 1.9) picture(k, x1 - 0.02, z, 1.8, 0.5, 0.62, 'right', pick([0x2a1a0e, 0xb08d57, 0x1a1a1a], k.r));
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
          if (!fits(k, x, z, 1.7, 0.9, 0.15)) continue;
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
          if (k.r() < 0.85) k.items.round(x, d - 0.62, y, 0.032, 0.26, pick([0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0xecf0f1, 0x2c2c2c], k.r));
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
      const bx = x0 < -1.7 ? -1.4 : x1 > 1.7 ? 1.4 : 0; // baskets beside the door, inside the walls
      if (bx) {
        for (let i = 0; i < 6; i++) k.solid.box(bx, FRONT + 0.6, i * 0.075, 0.45, 0.33, 0.065, i % 2 ? 0xc0392b : 0xb03326);
        k.solid.box(bx, FRONT + 0.6, 0.45, 0.03, 0.3, 0.06, 0x1a1a1a);
      }
      break;
    }
    case 'fashion': {
      const rail = (x: number, z0: number, z1: number) => {
        const len = z1 - z0, zc = (z0 + z1) / 2;
        for (const z of [z0 + 0.05, z1 - 0.05]) k.shiny.geometry(CYL, at(x, 0.8, z, 0.018, 1.6, 0.018), 0xb8b8b8);
        k.shiny.box(x, zc, 1.58, 0.03, len, 0.03, 0xc8c8c8);
        for (let z = z0 + 0.12; z < z1 - 0.1; z += 0.07 + k.r() * 0.05) {
          const long = 0.55 + k.r() * 0.4, c = pick(CLOTHES, k.r);
          k.solid.box(x, z, 1.47 - long, 0.46, 0.03, long, c);
          k.solid.box(x, z, 1.47, 0.34, 0.03, 0.06, c);
          k.shiny.box(x, z, 1.53, 0.02, 0.01, 0.06, 0x9a9a9a);
        }
        k.blocks.push([x, zc, 0.6, len]);
      };
      if (d - 1.3 > 3) {
        rail(x0 + 0.4, 2.6, d - 1.65); // short of the changing room
        rail(x1 - 0.4, 2.6, d - 1.3);
        // The middle rails start further in: only where that still leaves a rail.
        if (span > 6.5 && d - 2.2 > 3.6) for (const x of [-1.6, 1.6]) if (x > x0 + 1.8 && x < x1 - 1.8) rail(x, 3.2, Math.min(d - 2.2, 7));
      }
      const mannequin = (x: number, z: number) => {
        const c = pick(CLOTHES, k.r);
        k.solid.geometry(CYL, at(x, 0.02, z, 0.2, 0.04, 0.2), 0x2a2a2a);
        k.solid.box(x, z, 0.1, 0.24, 0.16, 0.8, pick(CLOTHES, k.r));
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
      if (fits(k, x0 + 0.6, d - 0.6, 1.1, 1.05, 0.02)) {
        k.solid.box(x0 + 1.13, d - 0.55, 0, 0.04, 1.05, 2.15, 0xece8e0);
        k.shiny.box(x0 + 0.57, d - 1.08, 2.08, 1.1, 0.02, 0.02, 0xb8b8b8);
        const curtain = pick([0x3a3f58, 0x7a2e2e, 0x8a7f6e, 0x2c2c2c], k.r);
        for (let i = 0; i < 9; i++) k.solid.box(x0 + 0.1 + i * 0.115, d - 1.07 + (i % 2) * 0.03, 0.12, 0.12, 0.03, 1.94, curtain);
        k.blocks.push([x0 + 0.6, d - 0.6, 1.1, 1.05]);
      }
      const tz = (entryZ(d) + d - 1.7) / 2;
      if (fits(k, cx, tz, 1.3, 0.75, 0.35)) {
        block(k, cx, tz, 0.7, 1.3, 0.75, 0.04, 0xd8c8a8);
        for (const dx of [-0.6, 0.6]) for (const dz of [-0.32, 0.32]) k.solid.box(cx + dx, tz + dz, 0, 0.04, 0.04, 0.7, 0x2a2a2a);
        for (let i = 0; i < 8; i++) {
          const sx = cx - 0.46 + (i % 4) * 0.31, sz = tz + (i < 4 ? -0.17 : 0.17), c = pick(CLOTHES, k.r);
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
          k.solid.geometry(BALL, at(x, tray + 0.03, cz - 0.1 + (tray > 1 ? 0.12 : -0.05), 0.055, 0.03, 0.05), pick([0xb8762a, 0xd9a24a, 0x7a3e1a, 0xe8c9a0, 0xc7586a], k.r));
        }
      }
      k.solid.box(cx, cz, 1.13, cl - 0.1, 0.55, 0.015, 0xd0d0d0);
      k.glass.quad([cx, 1.2, cz - 0.34], [cl / 2, 0, 0], [0, 0.28, 0], [0, 0, -1], 0xffffff);
      k.glass.quad([cx, 1.48, cz], [cl / 2, 0, 0], [0, 0, 0.34], [0, 1, 0], 0xffffff);
      for (const y of [0.95, 1.4, 1.85]) {
        k.solid.box(cx, d - 0.22, y - 0.03, span - 0.6, 0.4, 0.03, 0x8a6d3b);
        for (let x = cx - span / 2 + 0.45; x < cx + span / 2 - 0.4; x += 0.3) {
          k.solid.geometry(BALL, at(x, y + 0.06, d - 0.22, 0.13, 0.07, 0.09), pick([0xa0612a, 0x8a4f22, 0xc98a45, 0x6b3a1a], k.r));
        }
      }
      person(k, cx, cz + 1.0, 0, -1);
      person(k, cx + (k.r() - 0.5) * 1.5, cz - 1.0, 0, 1);
      for (let x = cx - cl / 2 + 0.6; x < cx + cl / 2; x += 1.4) pendant(k, x, cz);
      if (cz - FRONT > 2.4) {
        menu(k, x0 + 0.03, 1.7, (FRONT + cz) / 2 + 0.2, 0.8, 0.62, 'left', 'VANDAAG', [['Grijs brood', '3,40'], ['Pistolets', '0,70'], ['Croissant', '1,40'],
          ['Eclair', '2,20'], ['Rijsttaart', '3,10']]);
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
      for (let x = x0 + 0.8; x < x1 - 0.3; x += 1.5) for (let z = FRONT + 1.5; z < d - 0.3; z += 1.8) spot(k, x, z, 0.06, 0xfff1d0, 4.2);
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
      if (fits(k, cx, (2.4 + cz) / 2, 1.3, 0.8, 0.6) && cz - 2.4 > 2.2) {
        const tz = (2.4 + cz) / 2;
        block(k, cx, tz, 0, 1.3, 0.8, 0.78, 0xd8cdb8);
        for (let i = 0; i < 10; i++) k.solid.box(cx + (k.r() - 0.5) * 1.1, tz + (k.r() - 0.5) * 0.6, 0.78, 0.14, 0.14, 0.08 + k.r() * 0.2, pick(PACKS[goods], k.r));
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
        k.blocks.push([x, d - 2.45, 1.05, 0.45]);
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
      if (d > 6.6) picture(k, x1 - 0.02, PICTURE_FROM, 1.7, 0.8, 0.6, 'right', 0x1a1a1a); // clear of the clock
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
      if (d > 7 && fits(k, x1 - 0.9, d - 3.9, 0.6, 1.0, 0.1)) {
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
        picture(k, x, d - 0.02, Math.min(1.6, h - 1.2 - ph / 2), 1.1, ph, 'back', pick([0x1a1a1a, 0xb08d57, 0xf4f4f2], k.r));
        spot(k, x, d - 1.0, 0.07, 0xfff6e6);
      }
      for (let z = 2.8; z < d - 1.0; z += 2.4) {
        picture(k, x0 + 0.02, z, 1.65, 1.1, 0.8 + k.r() * 0.4, 'left', pick([0x1a1a1a, 0xb08d57], k.r));
        picture(k, x1 - 0.02, z, 1.65, 1.1, 0.8 + k.r() * 0.4, 'right', pick([0x1a1a1a, 0xb08d57], k.r));
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
        for (let z = fz0; z < fz1 - 0.25; z += 0.6) k.glow.box(x + 0.3, z + 0.3, 0.012, 0.56, 0.56, 0.008, k.r() < 0.5 ? 0x1a1424 : pick(neon, k.r));
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
          k.shiny.geometry(CYL, at(x1 - 0.12, 1.49 + hgt / 2, z, 0.035, hgt, 0.035), pick([0x2f5d3a, 0x5a3a1e, 0xc9d6d0, 0x7a2e2e, 0x8a6d3b], k.r));
        }
        person(k, x1 - 0.2, bz, -1, 0);
      }
      for (let x = fx0 + 0.6; x < fx1; x += 1.3) {
        for (let z = fz0 + 0.6; z < fz1; z += 1.5) {
          const c = pick(neon, k.r);
          spot(k, x, z, 0.1, c, 3);
          if (k.r() < 0.45) k.beam.geometry(BEAM, at(x, h, z, 1, 1, 1, k.r() * 6, (k.r() - 0.5) * 0.5).multiply(at(0, -h / 2, 0, 0.35, h, 0.35)), c);
        }
      }
      const bx = (fx0 + fx1) / 2, bz = (fz0 + fz1) / 2;
      k.solid.box(bx, bz, h - 0.45, 0.01, 0.01, 0.45, 0x1a1a1a);
      k.shiny.geometry(BALL, at(bx, h - 0.62, bz, 0.2, 0.2, 0.2), 0xe8e8ec);
      for (let i = 0; i < 70; i++) {
        const wall: Wall = k.r() < 0.4 ? 'left' : k.r() < 0.5 ? 'right' : 'back';
        wallBox(k, k.glow, wall, wall === 'back' ? x0 + k.r() * span : FRONT + 0.5 + k.r() * (d - 1), 0.012, 0.6 + k.r() * (h - 0.9), 0.04, 0.004, 0.04, pick([0xffffff, ...neon], k.r));
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
          if (!fits(k, x, z, 1.6, 1.4, 0.6)) continue;
          k.solid.box(x, z, 0.72, 1.6, 0.8, 0.04, 0x8a6d3b);
          for (const dx of [-0.7, 0.7]) for (const dz of [-0.32, 0.32]) k.solid.box(x + dx, z + dz, 0, 0.05, 0.05, 0.72, 0x3a2a1c);
          for (const s of [-1, 1]) for (const dx of [-0.4, 0.4]) {
            chair(k, x + dx, z + s * 0.62, 0, -s, 0x5a3e26);
            sit(k, x + dx, z + s * 0.62, 0, -s, 0.3);
          }
          k.blocks.push([x, z, 1.6, 1.7]); // chair backs included
          for (const dx of [-0.45, 0.45]) deskLamp(k, x + dx, z, 0.76);
          for (let i = 0; i < 3; i++) k.solid.box(x + (k.r() - 0.5) * 1.2, z + (k.r() - 0.5) * 0.4, 0.76, 0.22, 0.3, 0.035, pick(BOOKS, k.r));
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
      let last = 0;
      for (let z = 2.6; z < d - 2.4; z += 0.6) {
        chair(k, x0 + 0.4, z, 1, 0, 0x3a4a5e);
        last = z;
      }
      if (last) k.blocks.push([x0 + 0.4, (2.6 + last) / 2, 0.5, last - 2.6 + 0.44]); // m: seats 0.42 deep
      plant(k, x1 - 0.45, FRONT + 0.5);
      k.solid.quad([x1 - 0.01, 1.05, d - 0.9], [0, 1.05, 0], [0, 0, 0.45], [-1, 0, 0], 0x6b4a30);
      k.shiny.box(x1 - 0.04, d - 1.25, 1.0, 0.05, 0.05, 0.05, 0xc0c0c0);
      if (d - 2.4 > 2.8) clock(k, 'left', (2.6 + d - 2.4) / 2, Math.min(2.2, h - 0.5));
      if (fits(k, x1 - 0.3, d - 2.1, 0.32, 0.32, 0.05)) {
        block(k, x1 - 0.3, d - 2.1, 0, 0.32, 0.32, 1.0, 0xeeeeec);
        k.solid.geometry(CYL, at(x1 - 0.3, 1.2, d - 2.1, 0.13, 0.4, 0.13), 0x6fa8dc);
        k.shiny.box(x1 - 0.3, d - 2.27, 0.75, 0.05, 0.03, 0.04, 0x3a6fb5);
      }
      if (d > 6.3) picture(k, x1 - 0.02, PICTURE_FROM, 1.7, 0.8, 0.6, 'right', 0x1a1a1a); // clear of the water cooler
      for (let z = FRONT + 1.5; z < d - 0.4; z += 2) ceilingLight(k, cx, z, 0.6, 0.6);
      break;
    }
  }
}
