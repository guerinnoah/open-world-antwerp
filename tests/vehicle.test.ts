import { beforeAll, describe, expect, it } from 'vitest';
import { ARTIC_SPEC, BUS_SPEC, VEHICLE_TYPES, paintFor } from '../src/actors/vehicle';
import { wrapAngle } from '../src/core/util';
import { VEHICLE_KINDS } from '../src/net/protocol';
import { RAPIER } from '../src/physics/physics';
import { testDrive } from './drive';

const sedan = VEHICLE_TYPES.find(([spec]) => spec.name === 'sedan')![0];

beforeAll(async () => {
  await RAPIER.init();
});

// desktops step physics at 60 Hz, phones at 30
describe.each([60, 30])('vehicle feel at %i Hz', (hz) => {
  const setup = (speed = 0) => testDrive(sedan, 1 / hz, speed);
  it('pulls away at a realistic pace: 0–50 km/h under 4.5 s, 0–100 km/h under 9 s', () => {
    const { car, run } = setup();
    const to50 = run({ throttle: 1 }, 10, () => car.forwardSpeed >= 50 / 3.6);
    const to100 = to50 + run({ throttle: 1 }, 10, () => car.forwardSpeed >= 100 / 3.6);
    expect(to50).toBeLessThan(4.5);
    expect(to100).toBeLessThan(9);
  });

  it('tops out just under its max speed', () => {
    const { car, run } = setup();
    run({ throttle: 1 }, 25);
    expect(car.forwardSpeed).toBeGreaterThan(sedan.maxSpeed * 0.93);
    expect(car.forwardSpeed).toBeLessThanOrEqual(sedan.maxSpeed);
  });

  it('stops from 50 km/h within 10 m', () => {
    const { car, run } = setup(50 / 3.6);
    run({ throttle: -1 }, 5, () => car.forwardSpeed <= 0.3);
    expect(car.x).toBeLessThan(10);
  });

  it('reverses slowly', () => {
    const { car, run } = setup();
    run({ throttle: -1 }, 6);
    expect(car.forwardSpeed).toBeLessThan(-5);
    expect(car.forwardSpeed).toBeGreaterThan(-8.5);
  });

  it('turns tight enough for Antwerp side streets at 30 km/h, wider at 90', () => {
    const radiusAt = (kmh: number) => {
      const { car, run } = setup(kmh / 3.6);
      run({ steer: 1, throttle: 0.2 }, 1.5);
      const v = car.body.linvel();
      return Math.hypot(v.x, v.y) / Math.abs(car.body.angvel());
    };
    const slow = radiusAt(30);
    const fast = radiusAt(90);
    expect(slow).toBeGreaterThan(4);
    expect(slow).toBeLessThan(9);
    expect(fast).toBeGreaterThan(slow * 2);
  });

  it('steers right for positive steer when going forward', () => {
    const { car, run } = setup(10);
    run({ steer: 1, throttle: 0.3 }, 0.5);
    expect(car.z).toBeGreaterThan(0);
  });

  it('slides with the handbrake: much more sideways slip than with grip', () => {
    const slip = (handbrake: boolean) => {
      const { car, run } = setup(60 / 3.6);
      run({ steer: 1, handbrake }, 0.6);
      const v = car.body.linvel();
      const a = car.angle;
      return Math.abs(-v.x * Math.sin(a) + v.y * Math.cos(a)) / Math.max(Math.hypot(v.x, v.y), 0.1);
    };
    expect(slip(true)).toBeGreaterThan(slip(false) * 3);
  });

  it('a parked car that gets shoved comes to rest', () => {
    const { car, run } = setup(10);
    car.driven = false;
    run({}, 3);
    expect(Math.hypot(car.body.linvel().x, car.body.linvel().y)).toBeLessThan(0.1);
  });
});

describe.each([60, 30])('bus at %i Hz', (hz) => {
  const DT = 1 / hz;

  it('pulls away and stops like a bus: 0–50 km/h in 5–10 s, from 50 km/h to a stop within 18 m', () => {
    for (const spec of [BUS_SPEC, ARTIC_SPEC]) {
      const { car, run } = testDrive(spec, DT);
      const t = run({ throttle: 1 }, 20, () => car.forwardSpeed >= 50 / 3.6);
      expect(t).toBeGreaterThan(5);
      expect(t).toBeLessThan(10);
      const x0 = car.x;
      run({ throttle: -1 }, 10, () => car.forwardSpeed <= 0.1);
      expect(car.x - x0).toBeLessThan(18);
    }
  });

  it('turns about its rear axle: the rear wheels never slide sideways, the front sweeps round', () => {
    const { car, run } = testDrive(BUS_SPEC, DT, 5);
    const pivot = BUS_SPEC.pivot!;
    let worst = 0, last: { x: number; z: number } | null = null;
    run({ steer: 1, throttle: 0.3 }, 3, () => {
      const a = car.angle, x = car.x - Math.cos(a) * pivot, z = car.z - Math.sin(a) * pivot;
      if (last && Math.hypot(x - last.x, z - last.z) > 1e-3) worst = Math.max(worst, Math.abs(wrapAngle(Math.atan2(z - last.z, x - last.x) - a)));
      last = { x, z };
      return false;
    });
    expect(worst).toBeLessThan(0.12);
    expect(Math.abs(wrapAngle(car.angle))).toBeGreaterThan(1);
  });

  it("an articulated bus's trailer stays hitched, folds within its limit and lines up again behind", () => {
    const { car, run } = testDrive(ARTIC_SPEC, DT, 6);
    const trailer = car.trailer!;
    const hitchGap = () => {
      const hx = car.x - Math.cos(car.angle) * (ARTIC_SPEC.length / 2), hz = car.z - Math.sin(car.angle) * (ARTIC_SPEC.length / 2);
      const half = ARTIC_SPEC.trailer!.length / 2;
      return Math.hypot(trailer.x + Math.cos(trailer.angle) * half - hx, trailer.z + Math.sin(trailer.angle) * half - hz);
    };
    let fold = 0, gap = 0;
    run({ steer: 1, throttle: 0.3 }, 4, () => {
      fold = Math.max(fold, Math.abs(wrapAngle(car.angle - trailer.angle)));
      gap = Math.max(gap, hitchGap());
      return false;
    });
    expect(fold).toBeGreaterThan(0.2);
    expect(fold).toBeLessThan(0.95);
    expect(gap).toBeLessThan(0.15);
    run({ throttle: 0.5 }, 8);
    expect(Math.abs(wrapAngle(car.angle - trailer.angle))).toBeLessThan(0.05);
  });
});

describe.each([60, 30])('afloat at %i Hz', (hz) => {
  const setup = (speed = 0) => {
    const s = testDrive(sedan, 1 / hz, speed);
    s.car.afloat = true;
    return s;
  };

  it('splashing in at 100 km/h, the water slows it to paddling pace within 2 s', () => {
    const { car, run } = setup(100 / 3.6);
    run({ throttle: 1 }, 2);
    expect(car.forwardSpeed * 3.6).toBeLessThan(sedan.maxSpeed * 3.6 * 0.33);
  });

  it('still drives: gets going under the gas, but tops out at under a third of its road speed', () => {
    const { car, run } = setup();
    run({ throttle: 1 }, 3);
    expect(car.forwardSpeed).toBeGreaterThan(4);
    run({ throttle: 1 }, 10);
    expect(car.forwardSpeed).toBeLessThan(sedan.maxSpeed * 0.31);
  });

  it('keeps sliding sideways like a boat, long after tyres on the road would have gripped', () => {
    const slip = (afloat: boolean) => {
      const { car, run } = testDrive(sedan, 1 / hz);
      car.afloat = afloat;
      car.body.setLinvel({ x: 5, y: 3 }, true);
      run({ throttle: 0.3 }, 0.5);
      return Math.abs(-car.body.linvel().x * Math.sin(car.angle) + car.body.linvel().y * Math.cos(car.angle));
    };
    expect(slip(false)).toBeLessThan(0.1);
    expect(slip(true)).toBeGreaterThan(0.5);
  });
});

describe('the wider fleet', () => {
  it('can send every traffic type over the network', () => {
    for (const [spec] of VEHICLE_TYPES) expect(VEHICLE_KINDS).toContain(spec.name);
  });

  it('paints emergency vehicles in their livery colour', () => {
    const police = VEHICLE_TYPES.find(([spec]) => spec.name === 'police')![0];
    expect(new Set(Array.from({ length: 20 }, () => paintFor(police))).size).toBe(1);
  });

  it.each(['truck', 'firetruck'])('%s gets going and stops from 50 km/h within 20 m', (name) => {
    const spec = VEHICLE_TYPES.find(([s]) => s.name === name)![0];
    const { car, run } = testDrive(spec, 1 / 60);
    expect(run({ throttle: 1 }, 10, () => car.forwardSpeed > 30 / 3.6)).toBeLessThan(8);
    const braking = testDrive(spec, 1 / 60, 50 / 3.6);
    const x0 = braking.car.x;
    braking.run({ throttle: -1 }, 6, () => braking.car.forwardSpeed < 0.1);
    expect(braking.car.x - x0).toBeLessThan(20);
  });
});
