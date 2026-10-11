import type { GraphEdge } from '../world/cityData';
import type { NavGraph } from '../world/navGraph';
import { cumulative, pointAt, reversePolyline } from '../world/polyline';

export interface Snap {
  edge: number;
  s: number; // distance along the edge's polyline (m)
  x: number;
  z: number;
  dx: number;
  dz: number;
}

export interface Route {
  points: number[];
  length: number; // m
}

const ONE_WAY_PENALTY = 8; // wrong way down a one-way: only when no legal route gets there
const U_TURN = 15; // s
const ARRIVE = 20; // m
const REROUTE = 0.5; // s

export function snap(graph: NavGraph, x: number, z: number, max: number): Snap | null {
  const near = graph.nearest(x, z, max);
  if (!near) return null;
  const p = graph.edges[near.edge].p;
  let best = Infinity, run = 0;
  const out: Snap = { edge: near.edge, s: 0, x: p[0], z: p[1], dx: 1, dz: 0 };
  for (let k = 0; k < p.length - 2; k += 2) {
    const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1], l = Math.hypot(dx, dz);
    const t = l ? Math.max(0, Math.min(1, ((x - p[k]) * dx + (z - p[k + 1]) * dz) / (l * l))) : 0;
    const px = p[k] + t * dx, pz = p[k + 1] + t * dz, d = Math.hypot(x - px, z - pz);
    if (l && d < best) {
      best = d;
      Object.assign(out, { s: run + t * l, x: px, z: pz, dx: dx / l, dz: dz / l });
    }
    run += l;
  }
  return out;
}

/** The part of p between distances a and b; reversed when b < a. */
function between(p: number[], a: number, b: number): number[] {
  const cum = cumulative(p), lo = Math.min(a, b), hi = Math.max(a, b);
  const from = pointAt(p, cum, lo), to = pointAt(p, cum, hi), out = [from.x, from.z];
  for (let i = 1; i < cum.length - 1; i++) if (cum[i] > lo && cum[i] < hi) out.push(p[i * 2], p[i * 2 + 1]);
  out.push(to.x, to.z);
  return a <= b ? out : reversePolyline(out);
}

/** A* both ways down every edge; motor vehicles pay in time, and extra for wrong-way one-ways and U-turns. */
export class Router {
  private out: number[][] = []; // per node: steps as edge * 2 + (forward ? 1 : 0)
  private lengths: number[];
  private top: number; // fastest speed limit (m/s), for the A* bound
  private cost: Float64Array;
  private prev: Int32Array;
  private inEdge: Int32Array; // the edge each node was reached by, to charge for turning straight back down it

  constructor(private graph: NavGraph) {
    const n = graph.nodes.length / 2;
    for (let i = 0; i < n; i++) this.out.push([]);
    graph.edges.forEach((e, i) => {
      this.out[e.a].push(i * 2 + 1);
      this.out[e.b].push(i * 2);
    });
    this.lengths = graph.edges.map((e) => cumulative(e.p).at(-1)!);
    this.top = Math.max(...graph.edges.map((e) => e.s));
    this.cost = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.inEdge = new Int32Array(n);
  }

  route(start: Snap, goal: Snap, motor: boolean, heading: number | null = null): Route | null {
    const { edges, nodes } = this.graph, cost = this.cost, prev = this.prev, inEdge = this.inEdge;
    const rate = (e: GraphEdge, forward: boolean) => (motor ? 1 / e.s : 1) * (motor && e.o && !forward ? ONE_WAY_PENALTY : 1);
    const e0 = edges[start.edge], eg = edges[goal.edge];
    const len0 = this.lengths[start.edge], lenG = this.lengths[goal.edge];
    const ahead = heading === null || Math.cos(heading) * start.dx + Math.sin(heading) * start.dz >= 0;
    const turnFwd = motor && !ahead ? U_TURN : 0, turnBack = motor && ahead && heading !== null ? U_TURN : 0;

    cost.fill(Infinity);
    prev.fill(-1);
    const heap = new Heap();
    const slow = motor ? 1 / this.top : 1;
    const h = (node: number) => Math.hypot(nodes[node * 2] - goal.x, nodes[node * 2 + 1] - goal.z) * slow;
    const reverse = (node: number, edge: number) => (motor && inEdge[node] === edge ? U_TURN : 0);
    const seed = (node: number, c: number) => {
      if (c >= cost[node]) return;
      cost[node] = c;
      inEdge[node] = start.edge;
      heap.push(c + h(node), node);
    };
    seed(e0.b, (len0 - start.s) * rate(e0, true) + turnFwd);
    seed(e0.a, start.s * rate(e0, false) + turnBack);

    let best = Infinity, via = -1;
    if (start.edge === goal.edge) {
      const fwd = goal.s >= start.s;
      best = Math.abs(goal.s - start.s) * rate(e0, fwd) + (fwd ? turnFwd : turnBack);
    }
    while (heap.size) {
      const key = heap.top, node = heap.pop(), c = cost[node];
      if (key > c + h(node) + 1e-9) continue;
      if (key >= best) break;
      const arrive = Math.min(
        node === eg.a ? c + goal.s * rate(eg, true) + reverse(node, goal.edge) : Infinity,
        node === eg.b ? c + (lenG - goal.s) * rate(eg, false) + reverse(node, goal.edge) : Infinity,
      );
      if (arrive < best) {
        best = arrive;
        via = node;
      }
      for (const step of this.out[node]) {
        const e = edges[step >> 1], forward = (step & 1) === 1;
        const next = forward ? e.b : e.a, nc = c + this.lengths[step >> 1] * rate(e, forward) + reverse(node, step >> 1);
        if (nc < cost[next]) {
          cost[next] = nc;
          prev[next] = step;
          inEdge[next] = step >> 1;
          heap.push(nc + h(next), next);
        }
      }
    }
    if (best === Infinity) return null;
    if (via < 0) return finish(between(e0.p, start.s, goal.s));

    const pieces = [via === eg.a ? between(eg.p, 0, goal.s) : between(eg.p, lenG, goal.s)];
    let node = via;
    while (prev[node] >= 0) {
      const e = edges[prev[node] >> 1], forward = (prev[node] & 1) === 1;
      pieces.push(forward ? e.p : reversePolyline(e.p));
      node = forward ? e.a : e.b;
    }
    pieces.push(between(e0.p, start.s, node === e0.b ? len0 : 0));
    return finish(pieces.reverse().flat());
  }
}

function finish(points: number[]): Route {
  return { points, length: cumulative(points).at(-1)! };
}

class Heap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size() {
    return this.keys.length;
  }

  get top() {
    return this.keys[0];
  }

  push(key: number, val: number) {
    const k = this.keys, v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (k[up] <= key) break;
      k[i] = k[up];
      v[i] = v[up];
      i = up;
    }
    k[i] = key;
    v[i] = val;
  }

  pop(): number {
    const k = this.keys, v = this.vals, out = v[0];
    const key = k.pop()!, val = v.pop()!;
    if (!k.length) return out;
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= k.length) break;
      if (c + 1 < k.length && k[c + 1] < k[c]) c++;
      if (k[c] >= key) break;
      k[i] = k[c];
      v[i] = v[c];
      i = c;
    }
    k[i] = key;
    v[i] = val;
    return out;
  }
}

export class Gps {
  waypoint: { x: number; z: number; name: string; goals: (Snap | null)[] } | null = null;
  route: Route | null = null;
  private modes: { graph: NavGraph; router: Router }[];
  private timer = 0;

  constructor(drive: NavGraph, walk: NavGraph) {
    this.modes = [drive, walk].map((graph) => ({ graph, router: new Router(graph) }));
  }

  set(x: number, z: number): boolean {
    const goals = this.modes.map(({ graph }) => snap(graph, x, z, 250));
    if (!goals.some(Boolean)) return false;
    const road = goals[0] && this.modes[0].graph.edges[goals[0].edge];
    this.waypoint = { x, z, goals, name: road?.n ?? '' };
    this.route = null;
    this.timer = 0;
    return true;
  }

  clear() {
    this.waypoint = null;
    this.route = null;
  }

  get destination(): string {
    return this.waypoint?.name ?? '';
  }

  /** Returns true on arrival, which also clears the waypoint. */
  update(x: number, z: number, dt: number, motor: boolean, heading: number | null): boolean {
    const w = this.waypoint;
    if (!w) return false;
    if (w.goals.some((g) => g && Math.hypot(g.x - x, g.z - z) < ARRIVE)) {
      this.clear();
      return true;
    }
    if ((this.timer -= dt) > 0) return false;
    this.timer = REROUTE;
    this.route = null;
    for (const i of motor ? [0] : [1, 0]) { // on foot: the footpaths when they connect, else the roads
      const { graph, router } = this.modes[i], goal = w.goals[i], start = snap(graph, x, z, 250);
      if (goal && start && (this.route = router.route(start, goal, motor, heading))) break;
    }
    return false;
  }
}
