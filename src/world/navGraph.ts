import { pick } from '../core/util';
import type { GraphEdge, RoadGraph } from './cityData';
import { offsetPolyline, reversePolyline } from './polyline';

export interface Step {
  edge: number;
  forward: boolean;
}

const CELL = 50;

export class NavGraph {
  readonly edges: GraphEdge[];
  readonly nodes: number[];
  private out: Step[][];
  private grid = new Map<string, number[]>();
  private seen: Uint32Array; // per edge: last nearest() query that tested it; long edges sit in many cells
  private query = 0;

  constructor(graph: RoadGraph, directed: boolean) {
    this.edges = graph.edges;
    this.nodes = graph.nodes;
    this.out = Array.from({ length: graph.nodes.length / 2 }, () => []);
    graph.edges.forEach((e, i) => {
      this.out[e.a].push({ edge: i, forward: true });
      if (!directed || !e.o) this.out[e.b].push({ edge: i, forward: false });
      // Every cell under the segment's bbox, so nearest() finds the middle of long segments.
      const p = e.p;
      for (let k = 0; k < p.length - 2; k += 2) {
        const gx1 = Math.floor(Math.max(p[k], p[k + 2]) / CELL), gz1 = Math.floor(Math.max(p[k + 1], p[k + 3]) / CELL);
        for (let gx = Math.floor(Math.min(p[k], p[k + 2]) / CELL); gx <= gx1; gx++) {
          for (let gz = Math.floor(Math.min(p[k + 1], p[k + 3]) / CELL); gz <= gz1; gz++) {
            let list = this.grid.get(`${gx},${gz}`);
            if (!list) this.grid.set(`${gx},${gz}`, (list = []));
            if (list[list.length - 1] !== i) list.push(i);
          }
        }
      }
    });
    this.seen = new Uint32Array(graph.edges.length);
  }

  endNode({ edge, forward }: Step): number {
    return forward ? this.edges[edge].b : this.edges[edge].a;
  }

  options(node: number, from?: number): Step[] {
    const all = this.out[node];
    const onward = all.filter((s) => s.edge !== from);
    return onward.length ? onward : all;
  }

  lane({ edge, forward }: Step, offset: number): number[] {
    const p = this.edges[edge].p;
    return offsetPolyline(forward ? p : reversePolyline(p), offset);
  }

  nearest(x: number, z: number, max = 60): { edge: number; vertex: number; dist: number } | null {
    let best: { edge: number; vertex: number; dist: number } | null = null;
    const r = Math.ceil(max / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const q = ++this.query;
    for (let gx = cx - r; gx <= cx + r; gx++) {
      for (let gz = cz - r; gz <= cz + r; gz++) {
        for (const i of this.grid.get(`${gx},${gz}`) ?? []) {
          if (this.seen[i] === q) continue;
          this.seen[i] = q;
          const p = this.edges[i].p;
          for (let k = 0; k < p.length - 2; k += 2) {
            const dx = p[k + 2] - p[k], dz = p[k + 3] - p[k + 1];
            const t = Math.max(0, Math.min(1, ((x - p[k]) * dx + (z - p[k + 1]) * dz) / (dx * dx + dz * dz || 1)));
            const d = Math.hypot(x - p[k] - t * dx, z - p[k + 1] - t * dz);
            if (d < max && (!best || d < best.dist)) best = { edge: i, vertex: k / 2 + (t > 0.5 ? 1 : 0), dist: d };
          }
        }
      }
    }
    return best;
  }

  randomEdgeNear(x: number, z: number, minD: number, maxD: number, accept?: (edge: number) => boolean): number {
    const r = Math.ceil(maxD / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let tries = 0; tries < 40; tries++) {
      const gx = cx + Math.floor((Math.random() * 2 - 1) * r), gz = cz + Math.floor((Math.random() * 2 - 1) * r);
      const list = this.grid.get(`${gx},${gz}`);
      if (!list?.length) continue;
      const i = pick(list);
      const p = this.edges[i].p;
      const m = (p.length / 2) >> 1;
      const d = Math.hypot(p[m * 2] - x, p[m * 2 + 1] - z);
      if (d >= minD && d <= maxD && (!accept || accept(i))) return i;
    }
    return -1;
  }
}

/** On the pavement beside the nearest street, on the point's side: [x, z, heading]. */
export function kerbside(edges: GraphEdge[], x: number, z: number): [number, number, number] | null {
  let spot: [number, number, number] | null = null;
  let best = Infinity;
  for (const e of edges) {
    for (let i = 0; i < e.p.length - 2; i += 2) {
      const [x0, z0, x1, z1] = [e.p[i], e.p[i + 1], e.p[i + 2], e.p[i + 3]];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 4) continue;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const d = Math.hypot(mx - x, mz - z);
      if (d >= best) continue;
      best = d;
      const nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
      const side = (x - mx) * nx + (z - mz) * nz > 0 ? 1 : -1;
      spot = [mx + nx * side * (e.w / 2 + 1), mz + nz * side * (e.w / 2 + 1), Math.atan2(z1 - z0, x1 - x0)];
    }
  }
  return spot;
}
