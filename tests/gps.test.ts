import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Router, snap } from '../src/game/gps';
import type { GraphData, RoadGraph } from '../src/world/cityData';
import { NavGraph } from '../src/world/navGraph';

// one-way 0 → 1 along the bottom, two-way detour over node 2
const triangle: RoadGraph = {
  nodes: [0, 0, 100, 0, 50, 80],
  edges: [
    { a: 0, b: 1, p: [0, 0, 100, 0], len: 100, s: 10, w: 6, o: 1 },
    { a: 1, b: 2, p: [100, 0, 50, 80], len: 94.3, s: 10, w: 6 },
    { a: 2, b: 0, p: [50, 80, 0, 0], len: 94.3, s: 10, w: 6 },
  ],
};

const BLOCK = [0, 0, 40, 0, 40, 30, 0, 30];

function plan(graph: NavGraph, from: [number, number], to: [number, number], motor: boolean, heading: number | null = null) {
  return new Router(graph).route(snap(graph, ...from, 50)!, snap(graph, ...to, 50)!, motor, heading);
}

describe('gps router', () => {
  const graph = new NavGraph(triangle, true);

  it('drives with a one-way', () => {
    const r = plan(graph, [10, 1], [90, 1], true)!;
    expect(r.points).toEqual([10, 0, 90, 0]);
    expect(r.length).toBeCloseTo(80);
  });

  it('takes the detour rather than go the wrong way down a one-way', () => {
    const r = plan(graph, [90, 1], [10, 1], true)!;
    expect(r.points.slice(0, 2)).toEqual([90, 0]);
    expect(r.points.slice(-2)).toEqual([10, 0]);
    expect(r.points).toContain(80);
    expect(r.length).toBeCloseTo(10 + 94.34 * 2 + 10, 0);
  });

  it('walks straight down the one-way', () => {
    expect(plan(graph, [90, 1], [10, 1], false)!.length).toBeCloseTo(80);
  });

  it('prefers going round the block to a U-turn when driving', () => {
    const block = new NavGraph({
      nodes: BLOCK,
      edges: [[0, 1], [1, 2], [2, 3], [3, 0]].map(([a, b]) => {
        const p = [BLOCK[a * 2], BLOCK[a * 2 + 1], BLOCK[b * 2], BLOCK[b * 2 + 1]];
        return { a, b, p, len: Math.hypot(p[2] - p[0], p[3] - p[1]), s: 10, w: 6 };
      }),
    }, true);
    // goal 20 m behind: facing +x goes round (120 m), facing -x straight back
    expect(plan(block, [30, 1], [10, 1], true, 0)!.length).toBeCloseTo(120);
    expect(plan(block, [30, 1], [10, 1], true, Math.PI)!.length).toBeCloseTo(20);
  });

  it('routes Centraal to the Grote Markt on the real map', () => {
    const data = JSON.parse(readFileSync('public/map/graph.json', 'utf8')) as GraphData;
    const drive = new NavGraph(data.drive, true);
    const r = plan(drive, [1491, 372], [12, 2], true)!;
    expect(r).not.toBeNull();
    const straight = Math.hypot(1491 - 12, 372 - 2);
    expect(r.length).toBeGreaterThan(straight);
    expect(r.length).toBeLessThan(straight * 1.8);
    for (let i = 2; i < r.points.length; i += 2) {
      expect(Math.hypot(r.points[i] - r.points[i - 2], r.points[i + 1] - r.points[i - 1])).toBeLessThan(300);
    }
  });
});
