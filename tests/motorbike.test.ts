import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { MOPED_SPEC, MOTORBIKE_SPEC, VEHICLE_TYPES, type VehicleSpec } from '../src/actors/vehicle';
import { RAPIER } from '../src/physics/physics';
import { testDrive } from './drive';

beforeAll(async () => {
  await RAPIER.init();
});

const sedan = VEHICLE_TYPES.find(([spec]) => spec.name === 'sedan')![0];
const setup = (spec: VehicleSpec, DT: number) => testDrive(spec, DT, 0, 0x1c1d20);

describe.each([60, 30])('motorbike feel at %i Hz', (hz) => {
  it('beats any car off the line (0–100 km/h under 3.5 s) and tops out past 190 km/h', () => {
    const { car: bike, run: ride } = setup(MOTORBIKE_SPEC, 1 / hz);
    const { car, run: drive } = setup(sedan, 1 / hz);
    const to100 = ride({ throttle: 1 }, 10, () => bike.forwardSpeed >= 100 / 3.6);
    expect(to100).toBeLessThan(3.5);
    expect(to100).toBeLessThan(drive({ throttle: 1 }, 10, () => car.forwardSpeed >= 100 / 3.6));
    ride({ throttle: 1 }, 15);
    expect(bike.forwardSpeed * 3.6).toBeGreaterThan(190);
  });

  it('leans hard into a fast right turn', () => {
    const { car: v, run } = setup(MOTORBIKE_SPEC, 1 / hz);
    run({ throttle: 1 }, 4);
    run({ throttle: 0.5, steer: 1 }, 1.5);
    expect(v.roll).toBeGreaterThan(0.4);
    expect(v.roll).toBeLessThanOrEqual(0.75);
  });

  it('a moped is a tuned "brommer": 55 km/h', () => {
    const { car: v, run } = setup(MOPED_SPEC, 1 / hz);
    run({ throttle: 1 }, 15);
    expect(v.forwardSpeed * 3.6).toBeGreaterThan(54);
    expect(v.forwardSpeed * 3.6).toBeLessThanOrEqual(55.01);
  });
});

describe('motorbikes on the street', () => {
  it('are a small share of the parked and moving vehicles', () => {
    const total = VEHICLE_TYPES.reduce((s, [, w]) => s + w, 0);
    const bikes = VEHICLE_TYPES.filter(([spec]) => spec === MOTORBIKE_SPEC || spec === MOPED_SPEC).reduce((s, [, w]) => s + w, 0);
    expect(bikes / total).toBeGreaterThan(0.05);
    expect(bikes / total).toBeLessThan(0.15);
  });

  it('every avatar can ride them (the seated poses are baked)', () => {
    const people = JSON.parse(readFileSync('public/people/people.json', 'utf8')) as { clips: Record<string, unknown> }[];
    for (const p of people) expect(Object.keys(p.clips)).toEqual(expect.arrayContaining(['moto', 'moped']));
  });
});
