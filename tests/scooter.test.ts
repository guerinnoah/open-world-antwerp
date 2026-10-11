import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BRANDS, brandOf, scatter } from '../src/actors/scooters';
import { SCOOTER_SPEC } from '../src/actors/vehicle';
import { RAPIER } from '../src/physics/physics';
import type { GraphData } from '../src/world/cityData';
import { testDrive } from './drive';

beforeAll(async () => {
  await RAPIER.init();
});

describe.each([60, 30])('e-scooter feel at %i Hz', (hz) => {
  const setup = () => {
    const { car: scooter, run } = testDrive(SCOOTER_SPEC, 1 / hz, 0, BRANDS[0].colour);
    return { scooter, run };
  };

  it('pulls away briskly and tops out at 38 km/h', () => {
    const { scooter, run } = setup();
    expect(run({ throttle: 1 }, 10, () => scooter.forwardSpeed >= 15 / 3.6)).toBeLessThan(3);
    run({ throttle: 1 }, 15);
    expect(scooter.forwardSpeed * 3.6).toBeGreaterThan(37);
    expect(scooter.forwardSpeed * 3.6).toBeLessThanOrEqual(38.01);
  });

  it('leans into a right turn, less than a bike would', () => {
    const { scooter, run } = setup();
    run({ throttle: 1 }, 6);
    run({ throttle: 1, steer: 1 }, 1.5);
    expect(scooter.roll).toBeGreaterThan(0.1);
    expect(scooter.roll).toBeLessThanOrEqual(0.3);
  });

  it('stops from full speed within 8 m', () => {
    const { scooter, run } = setup();
    run({ throttle: 1 }, 10);
    const x0 = scooter.x;
    run({ throttle: -1 }, 5, () => scooter.forwardSpeed < 0.05);
    expect(scooter.x - x0).toBeLessThan(8);
  });
});

describe('parked e-scooters', () => {
  const graph = JSON.parse(readFileSync('public/map/graph.json', 'utf8')) as GraphData;
  const parked = scatter(graph.walk);

  it('are laid out the same in every game (other players see the same ones)', () => {
    expect(scatter(graph.walk)).toEqual(parked);
  });

  it('fill the town with all three brands, a few lying on their side', () => {
    expect(parked.length).toBeGreaterThan(800);
    expect(parked.length).toBeLessThan(3000);
    BRANDS.forEach((b, i) => {
      const share = parked.filter((p) => p.brand === i).length / parked.length;
      expect(Math.abs(share - b.share)).toBeLessThan(0.1);
    });
    const down = parked.filter((p) => p.down).length / parked.length;
    expect(down).toBeGreaterThan(0.02);
    expect(down).toBeLessThan(0.1);
    expect(parked.filter((p) => Math.hypot(p.x, p.z) < 300).length).toBeGreaterThan(20);
  });

  it('tells the brand of a ridden scooter from its colour', () => {
    BRANDS.forEach((b, i) => expect(brandOf(b.colour)).toBe(i));
  });
});
