import { describe, expect, it } from 'vitest';
import type { CityData, RoadGraph } from '../src/world/cityData';
import { NavGraph } from '../src/world/navGraph';
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
      trees: [50, 0.4, 30, -1.7, 101, 1, 50, 3, 300, 300],
      props: { lamps: [20, 1.5, 20, 2.5], benches: [], bollards: [], signals: [60, -0.5, 1.2, 60, -4, 1.2] },
      terraces: [70, 2.2, 0, 3, 70, 3, 0, 3],
    } as unknown as CityData;
    clearTramTracks(city, [{ p: [0, 0, 100, 0, 100, 100] }]);
    expect(city.trees).toEqual([50, 3, 300, 300]);
    expect(city.props.lamps).toEqual([20, 2.5]);
    expect(city.props.signals).toEqual([60, -4, 1.2]);
    expect(city.terraces).toEqual([70, 3, 0, 3]);
  });
});
