import { beforeAll, describe, expect, it } from 'vitest';
import { Traffic, type Suspect, type TrafficHost } from '../src/actors/traffic';
import { VEHICLE_TYPES, Vehicle } from '../src/actors/vehicle';
import { Router, snap } from '../src/game/gps';
import { MAX_STARS, Wanted } from '../src/game/wanted';
import { Physics } from '../src/physics/physics';
import type { CityData, GraphData } from '../src/world/cityData';
import { Districts } from '../src/world/districts';
import { NavGraph } from '../src/world/navGraph';

describe('wanted level', () => {
  it('only counts crimes the police see, until they are after you', () => {
    const w = new Wanted();
    expect(w.crime(false)).toBe(false);
    expect(w.level).toBe(0);
    expect(w.crime(true)).toBe(true);
    expect(w.level).toBe(1);
    w.update(5, true, false);
    expect(w.crime(false)).toBe(true);
    expect(w.level).toBe(2);
  });

  it('adds one star per rampage, not one per person hit', () => {
    const w = new Wanted();
    for (let i = 0; i < 5; i++) w.crime(true);
    expect(w.level).toBe(1);
    for (let t = 0; t < 60; t += 0.5) {
      w.crime(true);
      w.update(0.5, true, false);
    }
    expect(w.level).toBe(MAX_STARS);
  });

  it('gives the police time to arrive before the search starts', () => {
    const w = new Wanted();
    w.crime(true);
    for (let t = 0; t < 20; t += 0.5) w.update(0.5, false, false);
    expect(w.searching).toBe(false);
    expect(w.level).toBe(1);
  });

  it('is lost after long enough out of sight, and longer with more stars', () => {
    const w = new Wanted();
    w.crime(true);
    w.update(0.1, true, false);
    let t = 0;
    while (w.update(0.1, false, false) !== 'lost') t += 0.1;
    expect(w.level).toBe(0);
    const three = new Wanted();
    three.level = 3;
    three.update(0.1, true, false);
    let t3 = 0;
    while (three.update(0.1, false, false) !== 'lost') t3 += 0.1;
    expect(t3).toBeGreaterThan(t + 5);
  });

  it('flashes the stars while searching, and a sighting resets the search', () => {
    const w = new Wanted();
    w.crime(true);
    w.update(0.1, true, false);
    w.update(1, false, false);
    expect(w.searching).toBe(false);
    w.update(1, false, false);
    expect(w.searching).toBe(true);
    w.update(0.1, true, false);
    expect(w.searching).toBe(false);
  });

  it('forgets the gap between stars after Wasted or Busted', () => {
    const w = new Wanted();
    expect(w.crime(true)).toBe(true);
    w.clear();
    expect(w.crime(true)).toBe(true);
  });

  it('starts a set level with the police on their way', () => {
    const w = new Wanted();
    w.set(3);
    for (let t = 0; t < 20; t += 0.5) w.update(0.5, false, false);
    expect(w.level).toBe(3);
  });

  it('busts you after being held beside a police car, not for brushing past one', () => {
    const w = new Wanted();
    w.crime(true);
    w.update(1, true, true);
    w.update(0.1, true, false);
    w.update(1, true, true);
    expect(w.level).toBe(1);
    expect(w.update(1, true, true)).toBe('busted');
    expect(w.level).toBe(0);
  });
});

describe('districts', () => {
  const districts = new Districts([
    { n: 'Meir', p: [0, 0, 10, 0, 10, 10, 0, 10] },
    { n: 'Antwerpen-Noord', p: [-50, -50, 50, -50, 50, 50, -50, 50] },
  ]);

  it('names the smallest quarter around the point', () => {
    expect(districts.at(5, 5)).toBe('Meir');
    expect(districts.at(30, 30)).toBe('Antwerpen-Noord');
    expect(districts.at(80, 0)).toBe('');
  });
});

// A 240 m square ring road, two-way at 50 km/h.
const SIDE = 240;
function ring(): GraphData['drive'] {
  const corners = [[0, 0], [SIDE / 2, 0], [SIDE, 0], [SIDE, SIDE / 2], [SIDE, SIDE], [SIDE / 2, SIDE], [0, SIDE], [0, SIDE / 2]];
  const edges = corners.map(([x0, z0], i) => {
    const [x1, z1] = corners[(i + 1) % corners.length];
    const p: number[] = [];
    for (let k = 0; k <= 6; k++) p.push(x0 + ((x1 - x0) * k) / 6, z0 + ((z1 - z0) * k) / 6);
    return { a: i, b: (i + 1) % corners.length, p, len: SIDE / 2, s: 50 / 3.6, w: 10 };
  });
  return { nodes: corners.flat(), edges };
}

describe('police chase', () => {
  const DT = 1 / 60;
  const graph = new NavGraph(ring(), true);
  const router = new Router(graph);
  let physics: Physics;
  let host: TrafficHost;
  beforeAll(async () => {
    physics = await Physics.create({ bounds: { minX: -60, minZ: -60, maxX: SIDE + 60, maxZ: SIDE + 60 }, buildings: [], trees: [] } as unknown as CityData);
    host = {
      vehicles: [],
      addVehicle(v) {
        this.vehicles.push(v);
      },
      removeVehicle(v) {
        this.vehicles.splice(this.vehicles.indexOf(v), 1);
        physics.remove(v.body);
      },
      route(x, z, heading, tx, tz) {
        const start = snap(graph, x, z, 60), goal = snap(graph, tx, tz, 120);
        return (start && goal && router.route(start, goal, true, heading, true)?.points) || null;
      },
    };
  });

  const run = (traffic: Traffic, suspect: Suspect, units: number, seconds: number, until: () => boolean) => {
    for (let t = 0; t < seconds; t += DT) {
      traffic.pursue(units, suspect);
      traffic.update(DT, suspect.x, suspect.z);
      for (const v of host.vehicles) v.step(DT);
      physics.step();
      for (const v of host.vehicles) v.sync();
      if (until()) return true;
    }
    return false;
  };

  it('sends a police car that finds you off the road and pulls up beside you', () => {
    const traffic = new Traffic(physics, graph, host, 0);
    const suspect: Suspect = { x: SIDE / 2, z: SIDE / 2, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
    const pinned = run(traffic, suspect, 1, 60, () => traffic.pinned(suspect.x, suspect.z));
    expect(traffic.police).toHaveLength(1);
    expect(traffic.police[0].siren).toBe(true);
    expect(pinned).toBe(true);
    expect(traffic.spotted).toBe(true);
    expect(traffic.witness(suspect.x, suspect.z)).toBe(true);

    const cop = traffic.police[0];
    traffic.pursue(0, null);
    expect(traffic.police).toHaveLength(0);
    expect(cop.siren).toBe(false);
    for (const v of [...host.vehicles]) traffic.despawn(v);
  });

  it('rams a moving car from two stars, and pulls up instead once it stops', () => {
    const traffic = new Traffic(physics, graph, host, 0);
    const sedan = VEHICLE_TYPES.find(([spec]) => spec.name === 'sedan')![0];
    const getaway = new Vehicle(physics.world, sedan, 0xffffff, 30, SIDE - 40, -Math.PI / 2);
    const suspect: Suspect = { x: getaway.x, z: getaway.z, vx: 0, vz: -3, speed: 75 / 3.6, ram: true, hidden: false, car: getaway };
    const hit = run(traffic, suspect, 1, 60, () => {
      getaway.sync();
      getaway.body.setLinvel({ x: suspect.vx, y: suspect.vz }, true);
      [suspect.x, suspect.z] = [getaway.x, getaway.z];
      traffic.reveal(suspect.x, suspect.z); // about ramming, not finding
      const cop = traffic.police[0];
      let touching = false;
      if (cop) physics.world.contactPair(cop.body.collider(0), getaway.body.collider(0), (m) => (touching ||= m.numContacts() > 0));
      return touching;
    });
    expect(hit).toBe(true);

    suspect.vz = 0;
    getaway.body.setLinvel({ x: 0, y: 0 }, true);
    const pinned = run(traffic, suspect, 1, 20, () => traffic.pinned(suspect.x, suspect.z));
    expect(pinned).toBe(true);
    traffic.pursue(0, null);
    for (const v of [...host.vehicles]) traffic.despawn(v);
    physics.remove(getaway.body);
  });

  it('stops at the water rather than driving in after you', () => {
    const moat = (x: number, z: number) => {
      const r = Math.hypot(x - SIDE / 2, z - SIDE / 2);
      return r > 15 && r < 35;
    };
    const wetHost: TrafficHost = { ...host, wet: moat };
    const traffic = new Traffic(physics, graph, wetHost, 0);
    const suspect: Suspect = { x: SIDE / 2, z: SIDE / 2, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
    let swam = false;
    run(traffic, suspect, 1, 40, () => {
      swam ||= traffic.police.some((v) => moat(v.x, v.z));
      return false;
    });
    expect(traffic.police).toHaveLength(1);
    expect(swam).toBe(false);
    expect(traffic.pinned(suspect.x, suspect.z)).toBe(false);
    traffic.pursue(0, null);
    for (const v of [...wetHost.vehicles]) traffic.despawn(v);
  });

  it('heads for where it last saw you, not where you went', () => {
    const traffic = new Traffic(physics, graph, host, 0);
    const suspect: Suspect = { x: SIDE / 2, z: SIDE / 2, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
    expect(run(traffic, suspect, 1, 60, () => traffic.spotted)).toBe(true);
    const cop = traffic.police[0];
    const seenAt = [cop.x, cop.z];
    Object.assign(suspect, { hidden: true, x: SIDE / 2 + (SIDE / 2 - seenAt[0]) * 0.5, z: SIDE / 2 + (SIDE / 2 - seenAt[1]) * 0.5 });
    run(traffic, suspect, 1, 3, () => false);
    const d = (traffic as unknown as { drivers: Map<Vehicle, { pts: number[]; searching: [number, number] | null }> }).drivers.get(cop)!;
    const goal = d.searching ?? d.pts.slice(-2);
    expect(Math.hypot(goal[0] - SIDE / 2, goal[1] - SIDE / 2)).toBeLessThan(2);
    traffic.pursue(0, null);
    for (const v of [...host.vehicles]) traffic.despawn(v);
  });

  it('cannot see you indoors', () => {
    const traffic = new Traffic(physics, graph, host, 0);
    const suspect: Suspect = { x: SIDE / 2, z: SIDE / 2, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: true, car: null };
    run(traffic, suspect, 1, 20, () => false);
    expect(traffic.police).toHaveLength(1);
    expect(traffic.spotted).toBe(false);
    traffic.pursue(0, null);
    for (const v of [...host.vehicles]) traffic.despawn(v);
  });
});
