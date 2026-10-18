import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { MAX_HEALTH, Player, TRAM_EXPOSURE, crashHurt, exposure } from '../src/actors/player';
import { BUS_SPEC, MOTORBIKE_SPEC, SCOOTER_SPEC, VEHICLE_TYPES, Vehicle, type VehicleSpec } from '../src/actors/vehicle';
import { Physics } from '../src/physics/physics';
import type { CityData, GraphData } from '../src/world/cityData';
import { WaterMap } from '../src/world/water';

let physics: Physics;
beforeAll(async () => {
  physics = await Physics.create({ bounds: { minX: -100, minZ: -100, maxX: 100, maxZ: 100 }, buildings: [], trees: [] } as unknown as CityData);
});

describe('player health', () => {
  it('takes hits, dies once at zero and comes back to full on revive', () => {
    const p = new Player(physics.world, 0, 0);
    expect(p.health).toBe(MAX_HEALTH);
    expect(p.hurt(60)).toBe(false);
    expect(p.health).toBe(40);
    expect(p.hurt(0)).toBe(false);
    expect(p.hurt(55)).toBe(true);
    expect(p.health).toBe(0);
    expect(p.hurt(10)).toBe(false);
    p.recover(60);
    expect(p.health).toBe(0);
    p.revive();
    expect(p.health).toBe(MAX_HEALTH);
    physics.remove(p.body);
  });

  it('heals only after a while without getting hurt', () => {
    const p = new Player(physics.world, 0, 0);
    p.hurt(50);
    for (let t = 0; t < 5; t += 0.1) p.recover(0.1);
    expect(p.health).toBe(50);
    for (let t = 0; t < 4; t += 0.1) p.recover(0.1);
    expect(p.health).toBeGreaterThan(50);
    p.hurt(1);
    const after = p.health;
    p.recover(1);
    expect(p.health).toBe(after);
    for (let t = 0; t < 60; t += 0.1) p.recover(0.1);
    expect(p.health).toBe(MAX_HEALTH);
    physics.remove(p.body);
  });

  it('takes a scratch without holding off healing', () => {
    const p = new Player(physics.world, 0, 0);
    p.hurt(50);
    for (let t = 0; t < 6.5; t += 0.1) p.recover(0.1);
    const healing = p.health;
    p.hurt(0.5, false);
    expect(p.health).toBeCloseTo(healing - 0.5);
    p.recover(1);
    expect(p.health).toBeGreaterThan(healing - 0.5);
    physics.remove(p.body);
  });
});

describe('crash damage', () => {
  const spec = (name: string) => VEHICLE_TYPES.find(([s]) => s.name === name)![0] as VehicleSpec;
  const exposureOf = (s: VehicleSpec) => {
    const v = new Vehicle(physics.world, s, 0xffffff, 0, 0, 0);
    const k = exposure(v);
    physics.remove(v.body);
    return k;
  };

  it('grows faster than the speed lost', () => {
    const k = 1;
    expect(crashHurt(15 / 3.6, k)).toBe(0);
    expect(crashHurt(50 / 3.6, k)).toBeGreaterThan(5);
    expect(crashHurt(90 / 3.6, k)).toBeGreaterThan(crashHurt(50 / 3.6, k) * 4);
    expect(crashHurt(130 / 3.6, k)).toBeGreaterThan(MAX_HEALTH * 0.9); // the bounce off a wall at 130 km/h does the rest
  });

  it('hurts riders most and bus drivers least', () => {
    const [scooter, motorbike, sedan, ambulance, truck, bus] = [SCOOTER_SPEC, MOTORBIKE_SPEC, spec('sedan'), spec('ambulance'), spec('truck'), BUS_SPEC].map(exposureOf);
    expect(scooter).toBe(motorbike);
    expect(motorbike).toBeGreaterThan(sedan);
    expect(sedan).toBeGreaterThan(ambulance);
    expect(ambulance).toBeGreaterThan(truck);
    expect(truck).toBeGreaterThanOrEqual(bus);
    expect(bus).toBe(TRAM_EXPOSURE);
    expect(crashHurt(80 / 3.6, motorbike)).toBeGreaterThan(crashHurt(80 / 3.6, sedan) * 2);
  });
});

describe('hospital respawn', () => {
  it('is on dry land beside ZNA Sint-Elisabeth', () => {
    const graph = JSON.parse(readFileSync('public/map/graph.json', 'utf8')) as GraphData;
    const city = JSON.parse(readFileSync('public/map/city.json', 'utf8')) as CityData;
    const [x, z] = graph.hospital;
    expect(Math.hypot(x, z)).toBeGreaterThan(100); // found, not the [0, 0] fallback
    expect(new WaterMap(city).contains(x, z)).toBe(false);
  });
});
