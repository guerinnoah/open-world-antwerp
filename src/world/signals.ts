import * as THREE from 'three';
import { stableRandom } from '../core/util';
import type { RoadGraph } from './cityData';

const AT_JUNCTION = 30; // m from a pole to the junction node it serves
const MERGE = 20; // m: junction nodes this close are one junction (dual carriageways)
const MIDBLOCK = 20; // m: poles away from junctions this close share a controller
const STOP_BACK = 1.5; // m before the junction's edge, or before a mid-block pole
const GREEN = 18; // s
const AMBER = 3; // s
const ALL_RED = 2; // s
const HALF = GREEN + AMBER + ALL_RED; // one road axis's turn
const AHEAD = 60; // m a driver looks for a light
const SIDE = 12; // m right of the driver's line a mid-block pole can stand
const FACING = 0.85; // cos: the light faces this driver
const CELL = 64;
const LENS_Y = [2.95, 2.67, 2.39]; // red, amber, green: the lenses in props.ts MODELS.signal
const LENS = [0xff2a1f, 0xffb21a, 0x2bdc5a];
const RED = 0, AMBER_LIGHT = 1, GREEN_LIGHT = 2;

export type Light = 'red' | 'amber' | 'green';
const NAMES: Light[] = ['red', 'amber', 'green'];

interface Pole {
  x: number;
  z: number;
  angle: number; // heading of the traffic it controls (it stands on that traffic's right)
  junction: number;
  phase: 0 | 1; // which road axis
  out: boolean; // knocked over
}

interface Junction {
  x: number;
  z: number;
  setback: number; // m from the centre back to the stop line; 0 for a mid-block light
  axis: number;
  offset: number; // s
  poles: number[];
}

/**
 * Fixed-time lights on the OSM signal poles. Poles are grouped by the drive-graph junction they stand at, so one
 * junction has one controller, which gives its two road axes green in turn. Drivers stop at a line just short of the
 * junction; lights away from junctions (pedestrian crossings) stop traffic just short of the pole.
 */
export class TrafficSignals {
  readonly group = new THREE.Group();
  private poles: Pole[] = [];
  private junctions: Junction[] = [];
  private grid = new Map<number, number[]>(); // pole indices by their stop point
  private lenses: THREE.InstancedMesh;
  private shown: number[] = [];
  private now = 0; // s
  private matrix = new THREE.Matrix4();
  private lens = new THREE.Matrix4();
  private colour = new THREE.Color();

  /** `signals`: city.props.signals, flat [x, z, angle, …]; `view`: m beyond which the lit lenses aren't drawn, as the poles. */
  constructor(signals: number[], drive: RoadGraph, view: number) {
    const nodeOf = junctionNodes(drive);
    const byNode = new Map<number, number>();
    for (let i = 0; i < signals.length; i += 3) {
      const [x, z, angle] = [signals[i], signals[i + 1], signals[i + 2]];
      const node = nodeOf(x, z);
      let j = node !== null ? (byNode.get(node.group) ?? -1) : this.junctions.findIndex((c) => !c.setback && Math.hypot(c.x - x, c.z - z) < MIDBLOCK);
      if (j < 0) {
        // Offsets hashed from the position: junctions don't switch in step, and every visitor sees the same lights.
        j = this.junctions.push({ ...(node ?? { x, z, setback: 0 }), axis: angle, offset: stableRandom(node?.x ?? x, node?.z ?? z) * 2 * HALF, poles: [] }) - 1;
        if (node) byNode.set(node.group, j);
      }
      const c = this.junctions[j];
      c.poles.push(this.poles.push({ x, z, angle, junction: j, phase: Math.abs(Math.sin(angle - c.axis)) < 0.5 ? 0 : 1, out: false }) - 1);
    }
    this.poles.forEach((p, i) => {
      const [sx, sz] = this.stopPoint(p);
      const key = cell(sx, sz);
      this.grid.set(key, [...(this.grid.get(key) ?? []), i]);
    });
    const material = new THREE.MeshBasicMaterial({ toneMapped: false });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>\ntransformed *= step(distance(instanceMatrix[3].xz, cameraPosition.xz), ${view.toFixed(1)});`);
    };
    this.lenses = new THREE.InstancedMesh(new THREE.BoxGeometry(0.025, 0.15, 0.15), material, this.poles.length);
    this.lenses.frustumCulled = false; // spread over the whole map: its bounding sphere would never cull anyway
    this.group.add(this.lenses);
    this.group.name = 'trafficSignals';
    this.shown = this.poles.map(() => -1);
    this.update(Date.now());
  }

  light(i: number): Light {
    return NAMES[this.state(i)];
  }

  /**
   * m from a driver's nose to the nearest stop line ahead whose light says stop; Infinity if none. `setback`: m from the
   * driver's position to its nose. Amber only stops a driver who can still do so comfortably.
   */
  stopAhead(x: number, z: number, angle: number, speed: number, decel: number, setback: number): number {
    const c = Math.cos(angle), s = Math.sin(angle);
    const cx = Math.floor((x + c * AHEAD / 2) / CELL), cz = Math.floor((z + s * AHEAD / 2) / CELL);
    let best = Infinity;
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gz = cz - 1; gz <= cz + 1; gz++) {
        for (const i of this.grid.get(gx * 4096 + gz) ?? []) {
          const p = this.poles[i];
          if (p.out || Math.cos(angle - p.angle) < FACING) continue;
          const j = this.junctions[p.junction], [sx, sz] = this.stopPoint(p);
          const ahead = (sx - x) * c + (sz - z) * s - setback;
          if (ahead < -0.5 || ahead > AHEAD || ahead >= best) continue; // past the line: already in, carry on
          // On this approach: the junction's centre near the driver's line, or a mid-block pole on its right.
          const side = j.setback ? Math.abs((j.z - z) * c - (j.x - x) * s) : (p.z - z) * c - (p.x - x) * s;
          if (j.setback ? side > j.setback : side < 0 || side > SIDE) continue;
          const light = this.state(i);
          if (light === GREEN_LIGHT || (light === AMBER_LIGHT && (speed * speed) / (2 * decel) > ahead)) continue;
          best = Math.max(ahead, 0);
        }
      }
    }
    return best;
  }

  /** May a pedestrian cross the street running (dx, dz) at (x, z)? Not while the nearest junction gives that street green or amber. */
  walk(x: number, z: number, dx: number, dz: number): boolean {
    const angle = Math.atan2(dz, dx);
    let j: Junction | null = null, best = Infinity;
    for (const c of this.junctions) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < best && d < c.setback + 15) [j, best] = [c, d];
    }
    return !j || j.poles.every((i) => this.poles[i].out || Math.abs(Math.cos(angle - this.poles[i].angle)) < FACING || this.state(i) === RED);
  }

  /** A pole knocked over (props.ts setBroken): its lights go out and stop controlling traffic. */
  knock(i: number, out: boolean) {
    this.poles[i].out = out;
    this.shown[i] = -2;
  }

  /** `ms`: wall-clock time. Moves each pole's lit lens when its light changes. */
  update(ms: number) {
    this.now = ms / 1000;
    let changed = false;
    for (let i = 0; i < this.poles.length; i++) {
      const p = this.poles[i], k = p.out ? -1 : this.state(i);
      if (k === this.shown[i]) continue;
      this.shown[i] = k;
      changed = true;
      if (k < 0) this.matrix.makeScale(0, 0, 0);
      else this.matrix.makeRotationY(-p.angle).setPosition(p.x, 0, p.z).multiply(this.lens.makeTranslation(-0.145, LENS_Y[k], 0));
      this.lenses.setMatrixAt(i, this.matrix);
      if (k >= 0) this.lenses.setColorAt(i, this.colour.setHex(LENS[k]));
    }
    if (!changed) return;
    this.lenses.instanceMatrix.needsUpdate = true;
    if (this.lenses.instanceColor) this.lenses.instanceColor.needsUpdate = true;
  }

  private state(i: number): number {
    const p = this.poles[i];
    const t = (((this.now + this.junctions[p.junction].offset - p.phase * HALF) % (2 * HALF)) + 2 * HALF) % (2 * HALF);
    return t < GREEN ? GREEN_LIGHT : t < GREEN + AMBER ? AMBER_LIGHT : RED;
  }

  /** Where traffic heading the pole's way stops: short of the junction box, or short of a mid-block pole. */
  private stopPoint(p: Pole): [number, number] {
    const j = this.junctions[p.junction], c = Math.cos(p.angle), s = Math.sin(p.angle);
    return j.setback ? [j.x - c * j.setback, j.z - s * j.setback] : [p.x - c * STOP_BACK, p.z - s * STOP_BACK];
  }
}

const cell = (x: number, z: number) => Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);

/** The junction a pole serves: drive-graph nodes where three or more edges meet, close ones merged into one box. */
function junctionNodes(drive: RoadGraph): (x: number, z: number) => { group: number; x: number; z: number; setback: number } | null {
  const degree = new Map<number, number>(), width = new Map<number, number>();
  for (const e of drive.edges) {
    for (const n of [e.a, e.b]) {
      degree.set(n, (degree.get(n) ?? 0) + 1);
      width.set(n, Math.max(width.get(n) ?? 0, e.w));
    }
  }
  const nodes = [...degree].filter(([, d]) => d >= 3).map(([n]) => n);
  const at = (n: number) => [drive.nodes[n * 2], drive.nodes[n * 2 + 1]];
  // Merge nodes within MERGE of each other (union-find), so a junction of two carriageways is one box.
  const parent = new Map(nodes.map((n) => [n, n]));
  const root = (n: number): number => (parent.get(n) === n ? n : root(parent.get(n)!));
  for (let i = 0; i < nodes.length; i++) {
    for (let k = i + 1; k < nodes.length; k++) {
      const [ax, az] = at(nodes[i]), [bx, bz] = at(nodes[k]);
      if (Math.abs(ax - bx) < MERGE && Math.abs(az - bz) < MERGE && Math.hypot(ax - bx, az - bz) < MERGE) parent.set(root(nodes[i]), root(nodes[k]));
    }
  }
  const boxes = new Map<number, { x: number; z: number; members: number[] }>();
  for (const n of nodes) {
    const r = root(n), box = boxes.get(r) ?? { x: 0, z: 0, members: [] };
    box.members.push(n);
    boxes.set(r, box);
  }
  const groups = new Map<number, { group: number; x: number; z: number; setback: number }>();
  for (const [r, box] of boxes) {
    const pts = box.members.map(at);
    const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, z = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const reach = Math.max(...pts.map(([px, pz]) => Math.hypot(px - x, pz - z)));
    groups.set(r, { group: r, x, z, setback: reach + Math.max(...box.members.map((n) => width.get(n)!)) / 2 + STOP_BACK });
  }
  return (x, z) => {
    let best: number | null = null, d = AT_JUNCTION;
    for (const n of nodes) {
      const [nx, nz] = at(n), e = Math.hypot(nx - x, nz - z);
      if (e < d) [best, d] = [n, e];
    }
    return best === null ? null : groups.get(root(best))!;
  };
}
