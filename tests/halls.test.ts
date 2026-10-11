import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CityData } from '../src/world/cityData';
import { PLANS, floorAt, floorsOn, outline } from '../src/world/halls';
import { HallKit, type Floor } from '../src/world/halls/kit';

const city = JSON.parse(readFileSync('public/map/city.json', 'utf8')) as CityData;

const rect = (x0: number, x1: number, z0: number, z1: number, y = 0): Floor => ({ x0, x1, z0, z1, y, h: 3, level: 0 });

describe('hall outline', () => {
  it('walls round a room but not between two floors that meet level', () => {
    const walls = outline([rect(0, 10, 0, 5), rect(10, 20, 0, 5)]);
    expect(walls.some(([ax, , bx]) => ax === 10 && bx === 10)).toBe(false);
    expect(walls.filter(([, az, , bz]) => az === 0 && bz === 0).reduce((n, [ax, , bx]) => n + Math.abs(bx - ax), 0)).toBeCloseTo(20);
  });

  it('walls the sides of a staircase where the floor beside it stays low', () => {
    const stair: Floor = { ...rect(0, 10, 0, 4), ramp: { x: 0, z: 0, dx: 1, dz: 0, len: 10, rise: 5 } };
    const walls = outline([stair, rect(0, 10, 4, 8), rect(-5, 0, 0, 8)]);
    expect(walls.some(([ax, az, bx, bz]) => az === 4 && bz === 4 && Math.min(ax, bx) === 0 && Math.max(ax, bx) === 10)).toBe(true);
    expect(walls.some(([ax, az, bx, bz]) => ax === 0 && bx === 0 && Math.min(az, bz) === 0 && Math.max(az, bz) === 4)).toBe(false);
  });
});

describe.each(Object.entries(PLANS))('%s hall', (id, plan) => {
  const lm = city.landmarks.find((l) => l.id === id)!;
  const kit = new HallKit(7);
  plan!.build(kit, lm, city.landmarks);
  const on = (level: number, x: number, z: number) => !!floorAt(floorsOn(kit.floors, level), x, z);

  it('lets you in at the door onto a ground floor, with the exit within reach', () => {
    const d = plan!.door;
    expect(on(0, d.x - d.nx * 1.6, d.z - d.nz * 1.6)).toBe(true);
  });

  it('lands every escalator ride and lift on a floor', () => {
    for (const e of kit.escalators) {
      const dx = Math.sign(e.b[0] - e.a[0]), dz = Math.sign(e.b[2] - e.a[2]);
      expect(on(e.from, e.a[0] + dx * 0.3, e.a[2] + dz * 0.3), `${id} escalator foot ${e.from}`).toBe(true);
      expect(on(e.from, e.a[0] - dx * 1.1, e.a[2] - dz * 1.1), `${id} ride down ${e.from}`).toBe(true);
      expect(on(e.to, e.b[0] - dx * 0.3, e.b[2] - dz * 0.3), `${id} escalator top ${e.to}`).toBe(true);
      expect(on(e.to, e.b[0] + dx * 1.1, e.b[2] + dz * 1.1), `${id} ride up ${e.to}`).toBe(true);
    }
    for (const l of kit.lifts) {
      expect(on(l.level, l.x, l.z), `${id} lift on ${l.level}`).toBe(true);
      expect(on(l.to.level, l.to.x, l.to.z), `${id} lift to ${l.to.level}`).toBe(true);
    }
  });

  it('keeps standing people out of furniture', () => {
    for (const p of kit.people) {
      if (p.clip !== 'idle') continue;
      const inside = kit.blocks.find((b) => b.level === p.level && Math.abs(b.x - p.x) < b.sx / 2 - 0.05 && Math.abs(b.z - p.z) < b.sz / 2 - 0.05);
      expect(inside, `${id} person at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`).toBeUndefined();
    }
  });
});
