import { describe, expect, it } from 'vitest';
import type { Area, Building, CityData, Road } from '../src/world/cityData';
import {
  assembleRings, besideRoad, centroid, interiorPoint, pointInRing, polygonsOf, roadGrid, signedArea, type OsmElement, type Pt,
} from '../tools/map/geo';
import { latLonToLambert72 } from '../tools/map/lambert72';
import { extrudeBuildings } from '../src/world/buildings';
import { planRoof } from '../src/world/roofs';
import { BUILDING_LAYERS } from '../src/world/textures';
import { project } from '../src/world/projection';
import { buildGraphData } from '../tools/map/graph';
import { grbMatcher } from '../tools/map/grb';
import { posts, solid, splitOutlines, type Mass } from '../tools/map/massing';
import { logoItemsOf, placeSigns } from '../tools/map/signs';
import { facadeOf } from '../tools/map/palette';
import { streetDetail } from '../tools/map/street';
import { layWater } from '../tools/map/water';
import { WaterMap } from '../src/world/water';
import { inRing } from '../src/world/polyline';

const M_LON = project(51.2213, 4.4097)[0] / 0.01;
const M_LAT = -project(51.2313, 4.3997)[1] / 0.01;
const latLon = ([x, z]: Pt) => ({ lat: 51.2213 - z / M_LAT, lon: 4.3997 + x / M_LON });

function lambertDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const [x1, y1] = latLonToLambert72(lat1, lon1);
  const [x2, y2] = latLonToLambert72(lat2, lon2);
  return Math.hypot(x2 - x1, y2 - y1);
}

describe('project', () => {
  it('puts the Grote Markt at the origin, north at -z and east at +x', () => {
    expect(project(51.2213, 4.3997)).toEqual([0, -0]);
    const [x, z] = project(51.2289, 4.4048);
    expect(x).toBeGreaterThan(0);
    expect(z).toBeLessThan(0);
  });

  it('matches Lambert 72 distances across the slice to within 0.1%', () => {
    const [x, z] = project(51.2172, 4.4211);
    const d = lambertDistance(51.2213, 4.3997, 51.2172, 4.4211);
    expect(Math.abs(Math.hypot(x, z) - d) / d).toBeLessThan(0.001);
  });
});

describe('assembleRings', () => {
  it('joins member ways into one closed ring, reversing ways as needed', () => {
    const a: Pt[] = [[0, 0], [10, 0]];
    const b: Pt[] = [[10, 10], [10, 0]];
    const c: Pt[] = [[10, 10], [0, 10], [0, 0]];
    const rings = assembleRings([a, b, c]);
    expect(rings).toHaveLength(1);
    expect(rings[0][0]).toEqual(rings[0].at(-1));
    expect(Math.abs(signedArea(rings[0]))).toBe(100);
  });

  it('drops ways that never close', () => {
    expect(assembleRings([[[0, 0], [5, 0]], [[5, 0], [5, 5]]])).toEqual([]);
  });
});

describe('polygonsOf', () => {
  const way = (id: number, ring: Pt[]): OsmElement => ({ type: 'way', id, geometry: [...ring, ring[0]].map(latLon) });
  const square = (x: number, z: number, s: number): Pt[] => [[x, z], [x + s, z], [x + s, z + s], [x, z + s]];

  it('winds outer rings positive and holes negative, as extrudeBuildings expects, whichever way OSM drew them', () => {
    const [[outer]] = polygonsOf(way(1, square(0, 0, 10).reverse()));
    expect(outer).toHaveLength(4);
    expect(signedArea(outer)).toBeGreaterThan(0);

    const relation: OsmElement = {
      type: 'relation', id: 2, tags: { type: 'multipolygon', building: 'yes' },
      members: [
        { type: 'way', ref: 3, role: 'outer', geometry: way(3, square(0, 0, 10).reverse()).geometry },
        { type: 'way', ref: 4, role: 'outer', geometry: way(4, square(20, 0, 10)).geometry },
        { type: 'way', ref: 5, role: 'inner', geometry: way(5, square(23, 3, 4)).geometry },
      ],
    };
    const polygons = polygonsOf(relation);
    expect(polygons.map((rings) => rings.length).sort()).toEqual([1, 2]);
    const withHole = polygons.find((rings) => rings.length === 2)!;
    expect(signedArea(withHole[0])).toBeGreaterThan(0);
    expect(signedArea(withHole[1])).toBeLessThan(0);
    expect(withHole[0].every(([x]) => x > 19)).toBe(true);
  });
});

describe('extrudeBuildings', () => {
  const square = { h: 40, c: 0xffffff, r: 0x000000, rings: [[0, 0, 10, 0, 10, 10, 0, 10]] };

  it('makes four outward-facing walls and an upward-facing roof', () => {
    const { position: p, index } = extrudeBuildings([square]);
    expect(index.length / 3).toBe(4 * 2 + 2);
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i], index[i + 1], index[i + 2]].map((v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const centre = [(a[0] + b[0] + c[0]) / 3 - 5, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3 - 5];
      const isRoof = a[1] === 40 && b[1] === 40 && c[1] === 40;
      if (isRoof) expect(n[1]).toBeGreaterThan(0);
      else expect(n[0] * centre[0] + n[2] * centre[2]).toBeGreaterThan(0);
    }
  });

  it('closes the underside of a raised floor, facing down', () => {
    const { position: p, normal, index } = extrudeBuildings([{ ...square, mh: 3, nw: 1 }]);
    expect(index.length / 3).toBe(4 * 2 + 2 + 2);
    const under = [...index].filter((v) => p[v * 3 + 1] === 3 && normal[v * 3 + 1] === -1);
    expect(under).toHaveLength(6);
  });

  it('draws windows on ordinary walls but not on roofs or plain landmark walls', () => {
    const windows = (surf: Float32Array) => [...surf].filter((_, i) => i % 2 === 1);
    expect(windows(extrudeBuildings([{ ...square, nw: 1 }]).surf).every((w) => w === 0)).toBe(true);
    const plain = windows(extrudeBuildings([square]).surf);
    expect(plain.filter((w) => w === 1)).toHaveLength(16);
    expect(plain.filter((w) => w === 0)).toHaveLength(4);
  });
});

describe('massing', () => {
  const rect = (x0: number, z0: number, x1: number, z1: number): Pt[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const mass = (ring: Pt[], h: number, extra: Partial<Building> = {}, canopy = false): Mass => ({
    b: { h, c: 0, r: 0, rings: [ring.flat()], ...extra }, outer: ring, rings: [ring], isPart: true, canopy,
  });
  const outline = { ...mass(rect(0, 0, 20, 10), 12), isPart: false };
  const areaOf = (m: Mass) => Math.abs(signedArea(m.outer));

  it('keeps the part of an outline its parts leave uncovered, instead of dropping the whole building', () => {
    const tower = mass(rect(0, 0, 5, 10), 30);
    const { replaced, masses } = splitOutlines([outline], [tower], () => 11);
    expect(replaced.has(outline)).toBe(true);
    expect(masses).toHaveLength(1);
    expect(masses[0].b.h).toBe(11);
    expect(areaOf(masses[0])).toBeCloseTo(150);
  });

  it('fills in the ground floor under a part that starts in the air, but not under a canopy', () => {
    const upper = mass(rect(0, 0, 20, 10), 20, { mh: 8 });
    const { masses } = splitOutlines([outline], [upper], () => 12);
    expect(masses).toHaveLength(1);
    expect(masses[0].b).toMatchObject({ h: 8 });
    expect(masses[0].b.mh).toBeUndefined();
    expect(splitOutlines([outline], [mass(rect(0, 0, 20, 10), 4, { mh: 3.6 }, true)], () => 12).masses).toHaveLength(0);
  });

  it('only fills what no lower part already holds up', () => {
    const plinth = mass(rect(0, 0, 10, 10), 6);
    const upper = mass(rect(0, 0, 20, 10), 20, { mh: 6 });
    const fill = splitOutlines([outline], [plinth, upper], () => 12).masses;
    expect(fill).toHaveLength(1);
    expect(areaOf(fill[0])).toBeCloseTo(100);
  });

  it('drops slivers that would stand as lone walls, but keeps a bus shelter', () => {
    expect(solid([rect(0, 0, 44, 0.34)])).toBe(false);
    expect(solid([rect(0, 0, 0.7, 0.6)])).toBe(false);
    expect(solid([rect(0, 0, 3.8, 1.05)])).toBe(true);
  });

  it('puts posts under a free-standing canopy, but none where it rests on a building or over the road', () => {
    const canopy = mass(rect(0, 0, 10, 6), 4, { mh: 3.6 }, true);
    expect(posts([canopy], [], () => true)).toHaveLength(6);
    const wall = mass(rect(0, -8, 10, 0), 9);
    const held = posts([canopy], [wall], () => true);
    expect(held).toHaveLength(3);
    for (const p of held) expect(p.rings[0][1]).toBeGreaterThan(5);
    expect(posts([canopy], [], ([x]) => x > 4)).toHaveLength(4);
    expect(posts([canopy], [], () => true)[0]).toMatchObject({ h: 3.6, nw: 1 });
  });

  it('stands posts at the corners of a curved canopy, not at every vertex of the curve', () => {
    const round: Pt[] = Array.from({ length: 48 }, (_, i) => [Math.cos((i / 48) * Math.PI * 2) * 8, Math.sin((i / 48) * Math.PI * 2) * 8]);
    const n = posts([mass(round, 5, { mh: 4.6 }, true)], [], () => true).length;
    expect(n).toBeGreaterThanOrEqual(5);
    expect(n).toBeLessThanOrEqual(12);
  });
});

describe('pitched roofs', () => {
  const house = { h: 15, c: 0xffffff, r: 0x000000, rings: [[0, 0, 6, 0, 6, 14, 0, 14]] };
  const block = { h: 15, c: 0xffffff, r: 0x000000, rings: [[0, 0, 12, 0, 12, 20, 0, 20]] };

  it('gives narrow houses a gable along their depth, walls stopping at the eaves', () => {
    const plan = planRoof(house)!;
    expect(['gable', 'stepped']).toContain(plan.kind);
    expect(plan.width).toBeCloseTo(6);
    expect(Math.abs(plan.uz)).toBeCloseTo(1);
    expect(plan.ridge).toBe(15);
    expect(plan.eaves).toBe(12);
  });

  it('gives wider buildings a hip roof, and keeps odd shapes, courtyards and towers flat', () => {
    expect(planRoof(block)!.kind).toBe('hip');
    expect(planRoof({ ...block, h: 60 })).toBeNull();
    expect(planRoof({ ...block, rings: [...block.rings, [4, 4, 4, 8, 8, 8, 8, 4]] })).toBeNull();
    expect(planRoof({ ...house, rings: [[0, 0, 6, 0, 6, 1, 1, 1, 1, 14, 0, 14]] })).toBeNull();
  });

  it('builds roof slopes that face up and out, topping out at the measured height', () => {
    for (const b of [house, block]) {
      const { position: p, index, surf } = extrudeBuildings([b]);
      let top = 0;
      for (let i = 0; i < index.length; i += 3) {
        const v = [index[i], index[i + 1], index[i + 2]].map((k) => [p[k * 3], p[k * 3 + 1], p[k * 3 + 2]]);
        top = Math.max(top, ...v.map((q) => q[1]));
        const isSlope = ['slate', 'tiles'].includes(BUILDING_LAYERS[surf[index[i] * 2]]);
        if (!isSlope) continue;
        const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
        const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
        expect(e1[2] * e2[0] - e1[0] * e2[2]).toBeGreaterThan(0);
      }
      expect(top).toBeGreaterThanOrEqual(15);
      expect(top).toBeLessThanOrEqual(15.8); // stepped gables poke just above the ridge
    }
  });
});

describe('drive graph', () => {
  it('reverses oneway=-1 ways, so the one-way edge runs a → b with the traffic', () => {
    const pts: Pt[] = [[0, 0], [50, 0], [100, 0]];
    const way: OsmElement = { type: 'way', id: 1, tags: { highway: 'residential', oneway: '-1' }, nodes: [1, 2, 3], geometry: pts.map(latLon) };
    const { drive } = buildGraphData({ elements: [way], buildings: [], inBounds: () => true, roadWidth: () => 7 });
    expect(drive.edges).toHaveLength(1);
    const [e] = drive.edges;
    expect(e.o).toBe(1);
    expect(e.p[0]).toBeCloseTo(100, 0);
    expect(e.p.at(-2)).toBeCloseTo(0, 0);
    expect(drive.nodes[e.a * 2]).toBeCloseTo(100, 0);
    expect(drive.nodes[e.b * 2]).toBeCloseTo(0, 0);
  });
});

describe('bike graph', () => {
  let id = 0;
  const way = (tags: Record<string, string>, z = 0): OsmElement => {
    const pts: Pt[] = [[0, z], [50, z], [100, z]];
    return { type: 'way', id: ++id, tags, nodes: [id * 10, id * 10 + 1, id * 10 + 2], geometry: pts.map(latLon) };
  };
  const bike = (...ways: OsmElement[]) => buildGraphData({ elements: ways, buildings: [], inBounds: () => true, roadWidth: () => 7 }).bike!;

  it('rides both ways down a one-way street open to bicycles, keeping clear of cars on the centreline', () => {
    const [e] = bike(way({ highway: 'residential', oneway: 'yes', 'oneway:bicycle': 'no' })).edges;
    expect(e.o).toBeUndefined();
    expect(e.l).toBeGreaterThanOrEqual(1.35);
  });

  it('keeps off footways and closed roads, and only rarely onto a road whose track is mapped beside it', () => {
    const g = bike(
      way({ highway: 'footway' }, 0), way({ highway: 'residential', bicycle: 'no' }, 20),
      way({ highway: 'secondary', bicycle: 'use_sidepath' }, 40), way({ highway: 'cycleway' }, 60),
    );
    expect(g.edges).toHaveLength(2);
    const [road, track] = g.edges;
    expect(road.q).toBeLessThan(0.1);
    expect(track.q).toBeGreaterThan(2);
    expect(track.l).toBeLessThan(1);
  });
});

describe('bus runs', () => {
  const LAT = 51.2213;
  const node = (id: number, lon: number) => ({ id, lat: LAT, lon });
  const street = (id: number, nodes: { id: number; lat: number; lon: number }[], tags: Record<string, string>): OsmElement => ({
    type: 'way', id, tags: { highway: 'residential', ...tags }, nodes: nodes.map((n) => n.id), geometry: nodes.map(({ lat, lon }) => ({ lat, lon })),
  });
  const [a, b, c, d, e] = [node(1, 4.4), node(2, 4.40125), node(3, 4.4025), node(4, 4.40375), node(5, 4.405)];
  const twoWay = street(10, [a, b, c], {});
  const oneWay = street(11, [c, d, e], { oneway: 'yes', 'oneway:bus': 'no' });
  const route = (id: number, ways: OsmElement[], reverse: boolean, platform?: { lat: number; lon: number }): OsmElement => ({
    type: 'relation', id, tags: { route: 'bus', ref: '17', to: 'Somewhere', colour: '#EF7D00' },
    members: [
      ...(platform ? [{ type: 'node', ref: 99, role: 'platform', ...platform }] : []),
      ...(reverse ? [...ways].reverse() : ways).map((w) => ({ type: 'way', ref: w.id, role: '', geometry: w.geometry })),
    ],
  });
  const runs = (relation: OsmElement) =>
    buildGraphData({ elements: [twoWay, oneWay, relation], buildings: [], inBounds: () => true, roadWidth: () => 7 }).buses;
  const sideAt = (p: number[], x: number) => {
    for (let i = 0; i < p.length - 2; i += 2) {
      if ((p[i] - x) * (p[i + 2] - x) <= 0) return p[i + 1] + ((p[i + 3] - p[i + 1]) * (x - p[i])) / (p[i + 2] - p[i] || 1);
    }
    return NaN;
  };

  it('keeps right on two-way streets and to the middle of a one-way, easing between them', () => {
    const [run] = runs(route(1, [twoWay, oneWay], false));
    expect(run).toMatchObject({ line: '17', colour: 0xef7d00, to: 'Somewhere', end: 1 });
    const [x0] = project(LAT, 4.4), [x1] = project(LAT, 4.405), [joint] = project(LAT, 4.4025);
    expect(run.p[0]).toBeCloseTo(x0, 0);
    expect(run.p[run.p.length - 2]).toBeCloseTo(x1, 0);
    expect(sideAt(run.p, joint - 40)).toBeCloseTo(1.9, 1);
    expect(sideAt(run.p, joint + 40)).toBeCloseTo(0, 1);
    const eased = sideAt(run.p, joint + 4);
    expect(eased).toBeGreaterThan(0);
    expect(eased).toBeLessThan(1.9);
  });

  it('takes the contraflow lane running against a one-way, and stops at its platform', () => {
    const platform = { lat: LAT - 0.00005, lon: 4.4035 };
    const [run] = runs(route(2, [twoWay, oneWay], true, platform));
    const [x] = project(LAT, 4.4035), [start] = project(LAT, 4.405);
    expect(sideAt(run.p, x)).toBeCloseTo(-1.9, 1);
    expect(sideAt(run.p, project(LAT, 4.401)[0])).toBeCloseTo(-1.9, 1);
    expect(run.stops).toHaveLength(1);
    expect(run.stops[0]).toBeCloseTo(start - x, 0);
  });

  it('does not end at a terminus where the route runs off the map', () => {
    const elements = [twoWay, oneWay, route(3, [twoWay, oneWay], false)];
    const [run] = buildGraphData({ elements, buildings: [], inBounds: ([x]) => x < project(LAT, 4.4045)[0], roadWidth: () => 7 }).buses;
    expect(run.end).toBeUndefined();
  });
});

describe('sign logos', () => {
  it('only goes to public institutions, museums and independents, never chains or offices', () => {
    expect(logoItemsOf({ name: 'MAS', tourism: 'museum', wikidata: 'Q104723730' })).toEqual(['Q104723730']);
    expect(logoItemsOf({ name: 'Delhaize', shop: 'supermarket', wikidata: 'Q1', 'brand:wikidata': 'Q1184173' })).toEqual([]);
    expect(logoItemsOf({ name: 'Basic-Fit', leisure: 'fitness_centre', brand: 'Basic-Fit', wikidata: 'Q40165577' })).toEqual([]);
    expect(logoItemsOf({ name: 'Kruidvat Meir', shop: 'chemist', wikidata: 'Q2226366' })).toEqual([]);
    expect(logoItemsOf({ name: 'McKinsey & Company', office: 'company', wikidata: 'Q310207' })).toEqual([]);
  });

  it("falls back to the operator's logo only for public and cultural places", () => {
    expect(logoItemsOf({ name: 'Stadscampus', amenity: 'university', 'operator:wikidata': 'Q175241' })).toEqual(['Q175241']);
    expect(logoItemsOf({ name: 'Hof', amenity: 'university', wikidata: 'Q9;Q8', 'operator:wikidata': 'Q175241' })).toEqual(['Q9', 'Q175241']);
    expect(logoItemsOf({ name: 'Bakkerij', shop: 'bakery', 'operator:wikidata': 'Q123' })).toEqual([]);
  });
});

describe('roadGrid', () => {
  it('finds a long straight street from the middle of its only segment', () => {
    const road: Road = { k: 'minor', w: 7, p: [0, 0, 400, 0] };
    const near = roadGrid([road], 40);
    expect(near([200, 5])).toEqual([road]);
    expect(besideRoad([200, 5], near([200, 5]), 8)).toBe(true);
    expect(near([200, 200])).toEqual([]);
  });
});

describe('street detail', () => {
  const ns: Road = { k: 'minor', w: 7, p: [0, -100, 0, 100] };
  const ew: Road = { k: 'minor', w: 7, p: [0, 0, 200, 0] };
  const signal: OsmElement = { type: 'node', id: 1, tags: { highway: 'traffic_signals' }, ...latLon([0, 30]) };
  const detail = (roads: Road[], elements: OsmElement[] = [signal]) => streetDetail(elements, roads, () => true, () => true).props;
  const poles = (s: number[]) => [0, 3].map((i) => ({ x: s[i], z: s[i + 1], angle: s[i + 2] }));

  it('puts a signal pole on each kerb of a north-south road, facing opposite ways along it', () => {
    const { signals } = detail([ns]);
    expect(signals).toHaveLength(6);
    const [a, b] = poles(signals);
    expect([a.x, b.x].sort((p, q) => p - q)).toEqual([-4.2, 4.2]);
    for (const { angle } of [a, b]) {
      expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI);
      expect(Math.abs(Math.cos(angle))).toBeLessThan(0.01);
    }
    expect(Math.abs(Math.sin(a.angle) + Math.sin(b.angle))).toBeLessThan(0.01);
  });

  it('keeps signal poles and generated lamps out of the cross street at a junction', () => {
    const atJunction: OsmElement = { ...signal, ...latLon([0, 0]) };
    const { signals, lamps } = detail([ns, ew], [atJunction]);
    expect(signals).toHaveLength(6);
    expect(lamps.length).toBeGreaterThan(10);
    for (let i = 0; i < signals.length; i += 3) expect(besideRoad([signals[i], signals[i + 1]], [ns, ew], 0)).toBe(false);
    for (let i = 0; i < lamps.length; i += 2) expect(besideRoad([lamps[i], lamps[i + 1]], [ns, ew], 0)).toBe(false);
  });
});

describe('placeSigns', () => {
  const b: Building = { h: 10, c: 0, r: 0, rings: [[0, 0, 12, 0, 12, 10, 0, 10]] };
  const outline = { b, outer: [[0, 0], [12, 0], [12, 10], [0, 10]] as Pt[] };
  const shop = (id: number, name: string, x: number): OsmElement => ({ type: 'node', id, tags: { shop: 'clothes', name }, ...latLon([x, 0.5]) });

  it('never leaves two signs overlapping on one wall', () => {
    const names = ['Shop', 'Some Rather Long Shop Name', 'Bakker', 'Kapper Jan', 'Mode', 'Optiek Van Dyck'];
    const xs = [6.5, 4, 9, 10, 1, 6];
    const { signs } = placeSigns(names.map((n, i) => shop(i, n, xs[i])), new Map([[b, 0]]), () => [outline], () => true, () => undefined);
    expect(signs.map((s) => s[5])).toEqual(expect.arrayContaining(['Shop', 'Some Rather Long Shop Name', 'Bakker']));
    const spans = signs
      .filter((s) => s[1] === 0)
      .map(([, , t, width]) => [t * 12 - width / 2, t * 12 + width / 2])
      .sort((p, q) => p[0] - q[0]);
    expect(spans).toHaveLength(signs.length);
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThan(spans[i - 1][1] - 0.05);
    for (const [s0, s1] of spans) {
      expect(s0).toBeGreaterThanOrEqual(0);
      expect(s1).toBeLessThanOrEqual(12);
    }
  });
});

describe('GRB heights', () => {
  // vertex centroid falls in the courtyard, where a taller neighbour stands
  const u: Pt[] = [[0, 0], [30, 0], [30, 20], [20, 20], [20, 5], [10, 5], [10, 20], [0, 20]];
  const courtyard: Pt[] = [[10, 5], [20, 5], [20, 20], [10, 20]];

  it('picks a point inside L- and U-shaped outlines, not their vertex centroid', () => {
    const l: Pt[] = [[0, 0], [4, 0], [4, 16], [20, 16], [20, 20], [0, 20]];
    for (const ring of [u, l]) {
      expect(pointInRing(centroid(ring), ring)).toBe(false);
      expect(pointInRing(interiorPoint(ring), ring)).toBe(true);
    }
  });

  it('matches a concave building to its own GRB footprint, not the neighbour under its centroid', () => {
    const match = grbMatcher([{ outer: courtyard, height: 20 }, { outer: u, height: 10 }]);
    expect(match(u)?.height).toBe(10);
    expect(match(courtyard)?.height).toBe(20);
  });

  it("ignores a GRB footprint far bigger or smaller than the outline: it is another building's height", () => {
    const block: Pt[] = [[0, 0], [40, 0], [40, 40], [0, 40]];
    const shed: Pt[] = [[1, 1], [4, 1], [4, 4], [1, 4]];
    expect(grbMatcher([{ outer: block, height: 30 }])(shed)).toBeUndefined();
    expect(grbMatcher([{ outer: shed, height: 3 }])(block)).toBeUndefined();
  });

  it('measures how much of an overhang stands on ground-level buildings', () => {
    const overhang: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const halfUnder: Pt[] = [[0, 0], [5, 0], [5, 10], [0, 10]];
    expect(grbMatcher([{ outer: overhang, height: 12, type: 'verdieping' }])(overhang)).toMatchObject({ height: 12, type: 'verdieping', ground: 0 });
    const match = grbMatcher([{ outer: overhang, height: 12, type: 'verdieping' }, { outer: halfUnder, height: 9 }]);
    expect(match(overhang)?.ground).toBeCloseTo(0.5);
  });
});

describe('facadeOf', () => {
  const rand = () => 0.5;

  it('keeps colours and materials that OSM tags', () => {
    const tags = { building: 'yes', 'building:material': 'brick', 'building:colour': '#bb9999', 'roof:colour': 'black' };
    expect(facadeOf(tags, 12, 100, true, rand)).toEqual({ c: 0xbb9999, r: 0x3a3836, m: 1 });
  });

  it('builds churches in stone and leaves rendered walls without a material', () => {
    expect(facadeOf({ building: 'church' }, 20, 800, true, rand).m).toBe(3);
    expect(facadeOf({ building: 'yes', 'building:material': 'plaster' }, 12, 100, true, rand)).not.toHaveProperty('m');
  });
});

describe('layWater', () => {
  const square = (x0: number, z0: number, x1: number, z1: number): Pt[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
  const flatSquare = (x0: number, z0: number, x1: number, z1: number) => [x0, z0, x1, z0, x1, z1, x0, z1];
  const bounds = [square(-500, -500, 500, 500)];
  const inArea = (a: Area, x: number, z: number) => a.rings.reduce((inside, r) => inside !== inRing(r, x, z), false);
  const covered = (areas: Area[], k: Area['k'], x: number, z: number) => areas.some((a) => a.k === k && inArea(a, x, z));

  it("shows a park's pond instead of drawing grass over it", () => {
    const park: Area = { k: 'green', rings: [flatSquare(0, 0, 100, 100)] };
    const out = layWater([[square(40, 40, 60, 60)]], bounds, [], [park]);
    expect(covered(out, 'water', 50, 50)).toBe(true);
    expect(covered(out, 'green', 50, 50)).toBe(false);
    expect(covered(out, 'green', 10, 10)).toBe(true);
  });

  it('keeps piers, pontoons and paths over the water dry, and the water around them wet', () => {
    const pier: Road = { k: 'foot', w: 2.5, p: [0, -50, 0, 50] };
    const pontoon: Area = { k: 'plaza', rings: [flatSquare(30, -10, 50, 10)] };
    const out = layWater([[square(-100, -20, 100, 20)]], bounds, [pier], [pontoon]);
    const water = new WaterMap({ areas: out } as CityData);
    expect(water.contains(0, 0)).toBe(false);
    expect(water.contains(40, 0)).toBe(false);
    expect(water.contains(-20, 0)).toBe(true);
    expect(water.contains(70, 0)).toBe(true);
  });
});
