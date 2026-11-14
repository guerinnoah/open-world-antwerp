import { describe, expect, it } from 'vitest';
import type { CityData, RoadGraph } from '../src/world/cityData';
import { zebraAcross } from '../src/actors/pedestrians';
import { NavGraph } from '../src/world/navGraph';
import { TrafficSignals } from '../src/world/signals';
import { cumulative, offsetPolyline, pointAt } from '../src/world/polyline';
import { clearTramTracks } from '../src/world/trackClearance';
import { WaterMap } from '../src/world/water';

describe('offsetPolyline', () => {
  it('positive offsets go to the right of travel (heading east, right is +z / south)', () => {
    expect(offsetPolyline([0, 0, 10, 0], 2)).toEqual([0, 2, 10, 2]);
    expect(offsetPolyline([0, 0, 10, 0], -2)).toEqual([0, -2, 10, -2]);
  });

  it('keeps the lane width through a corner (mitred, not pinched)', () => {
    const [, , cx, cz] = offsetPolyline([0, 0, 10, 0, 10, 10], 1);
    expect(cx).toBeCloseTo(9);
    expect(cz).toBeCloseTo(1);
  });
});

describe('pointAt', () => {
  it('interpolates along the polyline and clamps at the ends', () => {
    const p = [0, 0, 10, 0, 10, 10];
    const cum = cumulative(p);
    expect(pointAt(p, cum, 15)).toMatchObject({ x: 10, z: 5, dx: 0, dz: 1 });
    expect(pointAt(p, cum, 99)).toMatchObject({ x: 10, z: 10 });
  });
});

describe('NavGraph', () => {
  const graph: RoadGraph = {
    nodes: [0, 0, 50, 0, 100, 0],
    edges: [
      { a: 0, b: 1, p: [0, 0, 50, 0], len: 50, s: 8, w: 7 },
      { a: 1, b: 2, p: [50, 0, 100, 0], len: 50, s: 8, w: 7, o: 1 },
    ],
  };

  it('only lets cars leave a node along one-way streets in their direction', () => {
    const drive = new NavGraph(graph, true);
    expect(drive.options(2)).toEqual([]);
    expect(drive.options(1, 0)).toEqual([{ edge: 1, forward: true }]);
  });

  it('lets pedestrians walk one-way streets both ways', () => {
    const walk = new NavGraph(graph, false);
    expect(walk.options(2)).toEqual([{ edge: 1, forward: false }]);
  });

  it('allows a U-turn only at a dead end', () => {
    const drive = new NavGraph(graph, true);
    expect(drive.options(0, 0)).toEqual([{ edge: 0, forward: true }]);
  });

  it('finds the nearest edge', () => {
    const drive = new NavGraph(graph, true);
    expect(drive.nearest(70, 3)).toMatchObject({ edge: 1, dist: 3 });
    expect(drive.nearest(70, 300, 20)).toBeNull();
  });

  it('finds the middle of a segment far longer than a grid cell', () => {
    const long = new NavGraph({ nodes: [0, 0, 300, 120], edges: [{ a: 0, b: 1, p: [0, 0, 300, 120], len: 323, s: 8, w: 7 }] }, true);
    expect(long.nearest(150, 60, 12)).toMatchObject({ edge: 0, dist: 0 });
    expect(long.nearest(150, 65, 12)?.dist).toBeCloseTo(5 * Math.cos(Math.atan2(120, 300)));
  });
});

describe('WaterMap', () => {
  const city = {
    areas: [{ k: 'water', rings: [[0, 0, 100, 0, 100, 100, 0, 100], [40, 40, 60, 40, 60, 60, 40, 60]] }],
  } as unknown as CityData;
  const water = new WaterMap(city);

  it('is wet inside the river and dry outside', () => {
    expect(water.contains(10, 10)).toBe(true);
    expect(water.contains(-5, 10)).toBe(false);
  });

  it('is dry on a bridge deck cut out of the water', () => {
    expect(water.contains(50, 50)).toBe(false);
  });
});

describe('clearTramTracks', () => {
  it('drops trees and street furniture a tram would hit, and keeps what stands beside the track', () => {
    const city = {
      trees: [50, 0.4, 0, 20, 30, -1.7, 0, 30, 101, 1, 0, 40, 50, 3, 2, 100, 300, 300, 1, 50],
      props: { lamps: [20, 1.5, 20, 2.5], benches: [], bollards: [], signals: [60, -0.5, 1.2, 60, -4, 1.2] },
      terraces: [70, 2.2, 0, 3, 70, 3, 0, 3],
    } as unknown as CityData;
    clearTramTracks(city, [{ p: [0, 0, 100, 0, 100, 100] }]);
    expect(city.trees).toEqual([50, 3, 2, 100, 300, 300, 1, 50]);
    expect(city.props.lamps).toEqual([20, 2.5]);
    expect(city.props.signals).toEqual([60, -4, 1.2]);
    expect(city.terraces).toEqual([70, 3, 0, 3]);
  });
});

describe('zebraAcross', () => {
  // A street leaving the junction at (0, 0) eastwards; a zebra across it 6 m along, one along it, one behind the junction.
  const across = [6, -4, 6, 4];
  const along = [2, 5, 10, 5];
  const behind = [-6, -4, -6, 4];

  it('finds the crossing on the street being entered, ends pushed out onto the pavement, near end first', () => {
    expect(zebraAcross([along, behind, across], 0, 0, 1, 0, 0, -5)).toEqual([6, -5, 6, 5]);
    expect(zebraAcross([across], 0, 0, 1, 0, 0, 5)).toEqual([6, 5, 6, -5]);
  });

  it('ignores crossings along the street, on another arm or too far from the junction', () => {
    expect(zebraAcross([along], 0, 0, 1, 0, 0, -5)).toBeNull();
    expect(zebraAcross([behind], 0, 0, 1, 0, 0, -5)).toBeNull();
    expect(zebraAcross([[40, -4, 40, 4]], 0, 0, 1, 0, 0, -5)).toBeNull();
  });
});

describe('TrafficSignals', () => {
  // A crossroads of 7 m streets at (20, 0); a second junction node 12 m east (a split junction); and a lone light at x 200.
  const nodes = [20, 0, 0, 0, 60, 0, 20, -40, 20, 40, 32, 0, 32, 40];
  const edge = (a: number, b: number) => ({ a, b, p: [nodes[a * 2], nodes[a * 2 + 1], nodes[b * 2], nodes[b * 2 + 1]], len: 1, s: 14, w: 7 });
  const drive = { nodes, edges: [edge(0, 1), edge(0, 5), edge(5, 2), edge(0, 3), edge(0, 4), edge(5, 6)] };
  // Eastbound pole (on its right, +z) by the first node; southbound pole by the second; a mid-block eastbound pole.
  const signals = new TrafficSignals([14, 4.2, 0, 28, -6, Math.PI / 2, 200, 3, 0], drive, 300);
  const at = (s: number) => signals.update(s * 1000);
  const times = Array.from({ length: 92 }, (_, i) => i / 2); // one full cycle, every 0.5 s
  const when = (pole: number, light: string) => times.find((s) => (at(s), signals.light(pole) === light))!;

  it('runs a split junction as one, never giving both axes green, with an all-red gap', () => {
    for (const s of times) {
      at(s);
      expect(signals.light(0) === 'red' || signals.light(1) === 'red').toBe(true);
    }
    expect(times.some((s) => (at(s), signals.light(0) === 'red' && signals.light(1) === 'red'))).toBe(true);
  });

  it('stops traffic short of the junction box on red, nose first, and not on green or for other headings', () => {
    at(when(0, 'red'));
    // The merged box's centre is (26, 0); its stop line 6 + 3.5 + 1.5 m before it, at x 15; nose 2.5 m ahead.
    expect(signals.stopAhead(0, 1.9, 0, 10, 3, 2.5)).toBeCloseTo(12.5);
    expect(signals.stopAhead(0, 1.9, Math.PI, 10, 3, 2.5)).toBe(Infinity);
    expect(signals.stopAhead(20, 1.9, 0, 10, 3, 2.5)).toBe(Infinity); // already in the junction: carry on
    at(when(0, 'green'));
    expect(signals.stopAhead(0, 1.9, 0, 10, 3, 2.5)).toBe(Infinity);
  });

  it('stops traffic just short of a light away from junctions', () => {
    at(when(2, 'red'));
    expect(signals.stopAhead(180, 0, 0, 10, 3, 2)).toBeCloseTo(16.5);
  });

  it('lets people cross a street only while its traffic has red', () => {
    for (const s of times) {
      at(s);
      expect(signals.walk(15, 0, 1, 0)).toBe(signals.light(0) === 'red');
    }
    expect(signals.walk(500, 500, 1, 0)).toBe(true); // no lights there
  });
});
