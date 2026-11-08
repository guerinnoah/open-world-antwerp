import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Pedestrians, type Ped } from '../src/actors/pedestrians';
import { Traffic, type Suspect, type TrafficHost } from '../src/actors/traffic';
import { VEHICLE_TYPES, Vehicle, type VehicleSpec } from '../src/actors/vehicle';

const PATROL = VEHICLE_TYPES.find(([spec]) => spec.name === 'police')![0];
import { Router, snap } from '../src/game/gps';
import { MAX_LEVEL, Wanted } from '../src/game/wanted';
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

  it('adds one level per rampage, not one per person hit', () => {
    const w = new Wanted();
    for (let i = 0; i < 5; i++) w.crime(true);
    expect(w.level).toBe(1);
    for (let t = 0; t < 60; t += 0.5) {
      w.crime(true);
      w.update(0.5, true, false);
    }
    expect(w.level).toBe(MAX_LEVEL);
  });

  it('gives the police time to arrive before the search starts', () => {
    const w = new Wanted();
    w.crime(true);
    for (let t = 0; t < 20; t += 0.5) w.update(0.5, false, false);
    expect(w.status).toBe('on the way');
    expect(w.level).toBe(1);
  });

  it('is lost after long enough out of sight, and longer at higher levels', () => {
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

  it('reports police on the way until seen, then chasing, then searching once out of sight', () => {
    const w = new Wanted();
    expect(w.status).toBe(null);
    w.crime(true);
    expect(w.status).toBe('on the way');
    w.update(0.1, true, false);
    expect(w.status).toBe('chasing');
    w.update(1, false, false);
    expect(w.status).toBe('chasing');
    w.update(1, false, false);
    expect(w.status).toBe('searching');
    w.update(0.1, true, false);
    expect(w.status).toBe('chasing');
  });

  it('forgets the gap between levels after being knocked out or arrested', () => {
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

  it('arrests you after being held beside a police car, not for brushing past one', () => {
    const w = new Wanted();
    w.crime(true);
    w.update(1, true, true);
    w.update(0.1, true, false);
    w.update(1, true, true);
    expect(w.level).toBe(1);
    expect(w.update(1, true, true)).toBe('arrested');
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

// A 240 m square ring road, two-way at 50 km/h, with open ground inside.
const SIDE = 240;
const MIDDLE = { x: SIDE / 2, z: SIDE / 2 - 5 }; // just under Game.route's 120 m snap to a road
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

describe('police on a long straight', () => {
  const DT = 1 / 60;
  const LENGTH = 400;
  // One-way, and a loop so nothing reaches a dead end; the top side is the long straight.
  const corners = [0, 0, LENGTH, 0, LENGTH, 50, 0, 50];
  const road = new NavGraph({
    nodes: corners,
    edges: [0, 1, 2, 3].map((i) => {
      const b = (i + 1) % 4, p = [corners[i * 2], corners[i * 2 + 1], corners[b * 2], corners[b * 2 + 1]];
      return { a: i, b, p, len: Math.hypot(p[2] - p[0], p[3] - p[1]), o: 1 as const, s: 50 / 3.6, w: 10 };
    }),
  }, true);
  const router = new Router(road);
  const setup = async (trees: number[] = []) => {
    const physics = await Physics.create({ bounds: { minX: -60, minZ: -60, maxX: LENGTH + 60, maxZ: 60 }, buildings: [], trees } as unknown as CityData);
    const host: TrafficHost = {
      vehicles: [],
      addVehicle(v) {
        this.vehicles.push(v);
        physics.owners.set(v.body.collider(0).handle, { kind: 'vehicle', entity: v });
      },
      removeVehicle(v) {
        this.vehicles.splice(this.vehicles.indexOf(v), 1);
        physics.remove(v.body);
      },
      route(x, z, heading, tx, tz) {
        const start = snap(road, x, z, 60), goal = snap(road, tx, tz, 120);
        return (start && goal && router.route(start, goal, true, heading, true)?.points) || null;
      },
      wet: () => false,
    };
    const traffic = new Traffic(physics, road, host, 0);
    const inner = traffic as unknown as { spawn(edge: number, forced: VehicleSpec): { v: Vehicle } | undefined; rejoin(d: unknown): void };
    const place = (spec: VehicleSpec, x: number, angle: number) => {
      let d;
      while (!(d = inner.spawn(0, spec)));
      d.v.body.setTranslation({ x, y: 0 }, true);
      d.v.body.setRotation(angle, true);
      d.v.body.setLinvel({ x: 0, y: 0 }, true);
      d.v.sync();
      inner.rejoin(d);
      return d.v;
    };
    const run = (suspect: Suspect, seconds: number, until: () => boolean) => {
      for (let t = 0; t < seconds; t += DT) {
        traffic.pursue(1, suspect);
        traffic.update(DT, suspect.x, suspect.z);
        for (const v of host.vehicles) v.step(DT);
        physics.step();
        for (const v of host.vehicles) v.sync();
        if (until()) return true;
      }
      return false;
    };
    return { physics, traffic, place, run };
  };
  const SEDAN = VEHICLE_TYPES.find(([spec]) => spec.name === 'sedan')![0];

  it('swings out round a parked car rather than stopping behind it', async () => {
    const { physics, place, run } = await setup();
    const parked = new Vehicle(physics.world, SEDAN, 0xffffff, 200, 0, 0);
    physics.owners.set(parked.body.collider(0).handle, { kind: 'vehicle', entity: parked });
    const cop = place(PATROL, 110, 0);
    const suspect: Suspect = { x: 270, z: 0, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
    expect(run(suspect, 40, () => cop.x > parked.body.translation().x + 3)).toBe(true);
  });

  it.each([['moving', false], ['stopped', true]])('gets round a %s car coming the other way without hitting it at speed', async (_, stopped) => {
    const { physics, traffic, place, run } = await setup();
    const cop = place(PATROL, 300, Math.PI);
    const oncoming = place(SEDAN, 170, 0);
    if (stopped) (traffic as unknown as { drivers: Map<Vehicle, { limits: number[] }> }).drivers.get(oncoming)!.limits.fill(0);
    const suspect: Suspect = { x: 150, z: 0, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
    let hardest = 0;
    const passed = run(suspect, 30, () => {
      physics.world.contactPair(cop.body.collider(0), oncoming.body.collider(0), (m) => {
        if (m.numContacts()) hardest = Math.max(hardest, Math.abs(cop.forwardSpeed) + Math.abs(oncoming.forwardSpeed));
      });
      return cop.x < oncoming.x - 3;
    });
    expect(passed).toBe(true);
    expect(hardest).toBeLessThan(6); // m/s closing
  });

  it('sees a tree between the edges of the car, which a line of sight misses', async () => {
    const between = await setup([50, 0.45, 0, 30]);
    const clear = await setup([50, 1.5, 0, 30]);
    const run = (s: typeof between) => {
      s.physics.step();
      const car = new Vehicle(s.physics.world, SEDAN, 0xffffff, 0, 0, 0);
      return (s.traffic as unknown as { clearRun(v: Vehicle, x: number, z: number, dist: number): boolean }).clearRun(car, 100, 0, 100);
    };
    expect(run(between)).toBe(false);
    expect(run(clear)).toBe(true);
  });

  it('stays put rather than driving off the end of a stub when there is nowhere dry to go', async () => {
    const { physics, traffic, place } = await setup();
    const cop = place(PATROL, 100, 0);
    const inner = traffic as unknown as { drivers: Map<Vehicle, { pts: number[]; limits: number[] }>; routeTo(d: unknown, x: number, z: number, speed: number): void; host: TrafficHost };
    inner.host.wet = () => true;
    inner.host.route = () => null;
    const d = inner.drivers.get(cop)!;
    inner.routeTo(d, 100, 50, 16);
    expect(d.pts).toEqual([cop.x, cop.z, cop.x, cop.z]);
    expect(d.limits).toEqual([0, 0]);
    physics.step();
  });
});

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
        physics.owners.set(v.body.collider(0).handle, { kind: 'vehicle', entity: v });
      },
      removeVehicle(v) {
        this.vehicles.splice(this.vehicles.indexOf(v), 1);
        physics.remove(v.body);
      },
      route(x, z, heading, tx, tz) {
        const start = snap(graph, x, z, 60), goal = snap(graph, tx, tz, 120);
        return (start && goal && router.route(start, goal, true, heading, true)?.points) || null;
      },
      wet: () => false,
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
    const suspect: Suspect = { ...MIDDLE, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
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

  it('rams a moving car from level two, and pulls up instead once it stops', () => {
    const traffic = new Traffic(physics, graph, host, 0);
    const sedan = VEHICLE_TYPES.find(([spec]) => spec.name === 'sedan')![0];
    const getaway = new Vehicle(physics.world, sedan, 0xffffff, 30, SIDE - 40, -Math.PI / 2);
    physics.owners.set(getaway.body.collider(0).handle, { kind: 'vehicle', entity: getaway });
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
      const r = Math.hypot(x - MIDDLE.x, z - MIDDLE.z);
      return r > 15 && r < 35;
    };
    const wetHost: TrafficHost = { ...host, wet: moat };
    const traffic = new Traffic(physics, graph, wetHost, 0);
    const suspect: Suspect = { ...MIDDLE, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
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
    const suspect: Suspect = { ...MIDDLE, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
    expect(run(traffic, suspect, 1, 60, () => traffic.spotted)).toBe(true);
    const cop = traffic.police[0];
    const seenAt = [cop.x, cop.z];
    Object.assign(suspect, { hidden: true, x: MIDDLE.x + (MIDDLE.x - seenAt[0]) * 0.5, z: MIDDLE.z + (MIDDLE.z - seenAt[1]) * 0.5 });
    run(traffic, suspect, 1, 3, () => false);
    const d = (traffic as unknown as { drivers: Map<Vehicle, { pts: number[]; searching: [number, number] | null }> }).drivers.get(cop)!;
    const goal = d.searching ?? d.pts.slice(-2);
    expect(Math.hypot(goal[0] - MIDDLE.x, goal[1] - MIDDLE.z)).toBeLessThan(2);
    traffic.pursue(0, null);
    for (const v of [...host.vehicles]) traffic.despawn(v);
  });

  it('gets traffic ahead to pull over for a siren, whichever way it is facing', () => {
    const traffic = new Traffic(physics, graph, host, 0) as unknown as { sirens: Vehicle[]; sirenComing(v: Vehicle): boolean };
    const sedan = VEHICLE_TYPES.find(([spec]) => spec.name === 'sedan')![0];
    const siren = new Vehicle(physics.world, sedan, 0xffffff, 0, 0, 0);
    traffic.sirens = [siren];
    const comes = (x: number, angle: number) => {
      const v = new Vehicle(physics.world, sedan, 0xffffff, x, 0, angle);
      const yes = traffic.sirenComing(v);
      physics.remove(v.body);
      return yes;
    };
    expect(comes(30, 0)).toBe(true);
    expect(comes(30, Math.PI)).toBe(true);
    expect(comes(-30, 0)).toBe(false);
    expect(comes(30, Math.PI / 2)).toBe(false);
    expect(comes(60, Math.PI)).toBe(false);
    physics.remove(siren.body);
  });

  it('clears people off the path of a pursuer, to the nearer side', () => {
    const ped = (x: number, z: number, state = 'walk') => ({ state, timer: 0, body: { translation: () => ({ x, y: z }) } }) as unknown as Ped;
    const east = ped(1, 10), west = ped(-1, 10), behind = ped(0, -5), aside = ped(6, 10), down = ped(0, 10, 'down');
    Pedestrians.prototype.clearWay.call({ peds: [east, west, behind, aside, down] } as unknown as Pedestrians, 0, 0, Math.PI / 2);
    expect([east.state, west.state]).toEqual(['flee', 'flee']);
    expect(east.away![0]).toBeCloseTo(1);
    expect(west.away![0]).toBeCloseTo(-1);
    expect([behind.state, aside.state, down.state]).toEqual(['walk', 'walk', 'down']);
  });

  it('forgets a pursuer the moment it goes, so nothing reads a removed body', () => {
    const traffic = new Traffic(physics, graph, host, 0);
    const suspect: Suspect = { ...MIDDLE, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
    run(traffic, suspect, 1, 10, () => traffic.police.length === 1);
    traffic.despawn(traffic.police[0]);
    expect(traffic.police).toHaveLength(0);
    expect(() => traffic.pinned(suspect.x, suspect.z)).not.toThrow();
    run(traffic, suspect, 1, 10, () => traffic.police.length === 1);
    const jacked = traffic.police[0];
    traffic.release(jacked);
    expect(traffic.police).toHaveLength(0);
    traffic.pursue(0, null);
    physics.remove(jacked.body);
    host.vehicles.splice(host.vehicles.indexOf(jacked), 1);
    for (const v of [...host.vehicles]) traffic.despawn(v);
  });

  it('stands down a car that stays stuck, and sends another in its place', () => {
    const traffic = new Traffic(physics, graph, host, 0);
    const suspect: Suspect = { ...MIDDLE, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
    run(traffic, suspect, 1, 10, () => traffic.police.length === 1);
    const stuck = traffic.police[0];
    (traffic as unknown as { drivers: Map<Vehicle, { wedges: number }> }).drivers.get(stuck)!.wedges = 3;
    expect(run(traffic, suspect, 1, 15, () => traffic.police.length === 1 && traffic.police[0] !== stuck)).toBe(true);
    expect(stuck.siren).toBe(false);
    traffic.pursue(0, null);
    for (const v of [...host.vehicles]) traffic.despawn(v);
  });

  it('takes the quickest of several dispatch spots by road', () => {
    const edge = (i: number) => graph.edges[i].p;
    const roads: TrafficHost = { ...host, route: (x) => (x < SIDE / 2 ? [x, 0, x, 500] : [x, 0, x, 50]) };
    const traffic = new Traffic(physics, graph, roads, 0) as unknown as { quickestEdge(x: number, z: number): number };
    let quick = 0;
    for (let n = 0; n < 40; n++) {
      const p = edge(traffic.quickestEdge(MIDDLE.x, MIDDLE.z)), m = (p.length / 2) >> 1;
      if (p[m * 2] >= SIDE / 2) quick++;
    }
    expect(quick).toBeGreaterThan(30);
  });

  it('never spawns a chase car in plain view of the suspect, even on a long edge running past them', () => {
    const traffic = new Traffic(physics, graph, host, 0);
    const spawn = (traffic as unknown as { spawn(edge: number, forced: typeof PATROL): { v: Vehicle } | undefined }).spawn.bind(traffic);
    const suspect: Suspect = { x: 140, z: 5, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: false, car: null };
    traffic.pursue(1, suspect);
    let placed = 0, refused = 0;
    for (let n = 0; n < 60; n++) {
      const d = spawn(1, PATROL);
      if (!d) {
        refused++;
        continue;
      }
      placed++;
      expect(Math.hypot(d.v.x - suspect.x, d.v.z - suspect.z)).toBeGreaterThanOrEqual(90);
      traffic.despawn(d.v);
    }
    expect(placed).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
    // Round a corner it may: old-town streets are too slow to come from further off.
    const wall = vi.spyOn(physics, 'castStatic').mockReturnValue(0);
    let close = false;
    for (let n = 0; n < 60; n++) {
      const d = spawn(1, PATROL);
      if (!d) continue;
      close ||= Math.hypot(d.v.x - suspect.x, d.v.z - suspect.z) < 90;
      traffic.despawn(d.v);
    }
    wall.mockRestore();
    expect(close).toBe(true);
    traffic.pursue(0, null);
  });

  it('cannot see you indoors', () => {
    const traffic = new Traffic(physics, graph, host, 0);
    const suspect: Suspect = { ...MIDDLE, vx: 0, vz: 0, speed: 60 / 3.6, ram: false, hidden: true, car: null };
    run(traffic, suspect, 1, 20, () => false);
    expect(traffic.police).toHaveLength(1);
    expect(traffic.spotted).toBe(false);
    traffic.pursue(0, null);
    for (const v of [...host.vehicles]) traffic.despawn(v);
  });
});
