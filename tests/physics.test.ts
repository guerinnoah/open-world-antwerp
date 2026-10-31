import { beforeAll, describe, expect, it } from 'vitest';
import { Traffic, type TrafficHost } from '../src/actors/traffic';
import { addSections, removeSectioned, type Sectioned } from '../src/actors/transit';
import { VEHICLE_TYPES, Vehicle } from '../src/actors/vehicle';
import { Physics, RAPIER } from '../src/physics/physics';
import type { CityData } from '../src/world/cityData';
import type { NavGraph } from '../src/world/navGraph';

const sedan = VEHICLE_TYPES.find(([spec]) => spec.name === 'sedan')![0];

// a 10 m square building east of the origin, one tree 6 m south, in a 200 m map
const city = {
  bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 },
  buildings: [{ rings: [[10, -5, 20, -5, 20, 5, 10, 5]] }],
  trees: [0, 6, 0, 30],
} as unknown as CityData;

let physics: Physics;
beforeAll(async () => {
  physics = await Physics.create(city);
});

const sectioned = (): Sectioned => ({ sections: [], prev: [] }) as unknown as Sectioned;

describe('castStatic', () => {
  it('stops at walls, trees and the map edge, not at trams or cars', () => {
    const tram = sectioned();
    addSections(physics, tram, 'tram', [{ x: -10, z: 0, angle: Math.PI / 2 }], [3.6], 1.15);
    const car = new Vehicle(physics.world, sedan, 0xffffff, 0, -10, 0);
    physics.step();
    expect(physics.castStatic(0, 0, 1, 0, 30)).toBeCloseTo(10, 3);
    expect(physics.castStatic(0, 50, 0, 1, 80)).toBeCloseTo(50, 3);
    expect(physics.castStatic(0, 0, 0, 1, 30)).toBeCloseTo(5.7, 3);
    expect(physics.castStatic(0, 0, -1, 0, 30)).toBe(30);
    expect(physics.castStatic(0, 0, 0, -1, 30)).toBe(30);
    removeSectioned(physics, [tram], tram);
    physics.remove(car.body);
  });
});

describe('removing', () => {
  it('a body twice is a no-op, even once a new body reuses its slot', () => {
    const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    physics.remove(body);
    const reuse = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
    expect(() => physics.remove(body)).not.toThrow();
    expect(reuse.isValid()).toBe(true);
    physics.remove(reuse);
    expect(() => physics.step()).not.toThrow();
  });

  it('a tram or bus twice leaves the others alone', () => {
    const [a, b] = [sectioned(), sectioned()];
    const all = [a, b];
    addSections(physics, a, 'tram', [{ x: 50, z: 50, angle: 0 }, { x: 57, z: 50, angle: 0 }], [3.6, 3.6], 1.15);
    addSections(physics, b, 'tram', [{ x: 50, z: 60, angle: 0 }], [3.6], 1.15);
    physics.step();
    removeSectioned(physics, all, a);
    removeSectioned(physics, all, a);
    expect(all).toEqual([b]);
    expect(b.sections[0].isValid()).toBe(true);
    expect(() => physics.step()).not.toThrow();
    removeSectioned(physics, all, b);
  });
});

describe('traffic gap', () => {
  const host: TrafficHost = { vehicles: [], addVehicle() {}, removeVehicle() {} };
  const gapAhead = (place: () => () => void) => {
    const traffic = new Traffic(physics, {} as NavGraph, host, 0);
    const car = new Vehicle(physics.world, sedan, 0xffffff, -50, -50, 0);
    const cleanup = place();
    physics.step();
    const { gap } = (traffic as unknown as { obstacleAhead(v: Vehicle, x: number, z: number, a: number, speed: number): { gap: number } })
      .obstacleAhead(car, car.x, car.z, car.angle, 0);
    cleanup();
    physics.remove(car.body);
    return gap;
  };
  const nose = -50 + sedan.length / 2;

  it('is measured to the back of a 12 m bus, not its middle', () => {
    const bus = sectioned();
    const gap = gapAhead(() => {
      addSections(physics, bus, 'bus', [{ x: nose + 3 + 6, z: -50, angle: 0 }], [6], 1.275);
      return () => removeSectioned(physics, [bus], bus);
    });
    expect(gap).toBeCloseTo(3, 1);
  });

  it('is measured to the back of a car ahead, and the side of one crossing', () => {
    let other: Vehicle;
    const behind = gapAhead(() => {
      other = new Vehicle(physics.world, sedan, 0xffffff, nose + 2 + sedan.length / 2, -50, 0);
      return () => physics.remove(other.body);
    });
    const crossing = gapAhead(() => {
      other = new Vehicle(physics.world, sedan, 0xffffff, nose + 2 + sedan.width / 2, -50, Math.PI / 2);
      return () => physics.remove(other.body);
    });
    expect(behind).toBeCloseTo(2, 1);
    expect(crossing).toBeCloseTo(2, 1);
  });
});
