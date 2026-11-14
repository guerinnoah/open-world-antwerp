import * as THREE from 'three';
import { pick, wrapAngle } from '../core/util';
import { GROUP, RAPIER, WHEELS, groups, type Physics } from '../physics/physics';
import type { GraphEdge, Landmark } from '../world/cityData';
import type { NavGraph, Step } from '../world/navGraph';
import type { TrafficSignals } from '../world/signals';
import { along, cumulative, nearestSegment, offsetPolyline, pointAt, segmentDistance, trimPolyline } from '../world/polyline';
import { clipForSpeed, phaseStep, type Crowd } from './crowd';

const SPAWN_MIN = 30;
const SPAWN_MAX = 140;
const DESPAWN = 170;
const RADIUS = 0.3;
const FLEE_SPEED = 4.5; // m/s
const CLEAR_AHEAD = 25; // m
const CLEAR_SIDE = 2.5; // m
const KEEP_RIGHT = 0.35; // m, so opposite walkers pass
const CROSS_CHANCE = 0.35; // at a junction with a zebra crossing
const ZEBRA_REACH = 12; // m from the junction to the crossing's middle
const ZEBRA_KERB = 1; // m: ends pushed out of the road, so people wait on the pavement
const KERB = 0.5; // m short of the kerb when crossing
const SHARED_INSET = 0.6;
const OFF_PATH = 2.5;
const NO_PAVEMENT = 0.1;
const CENTRE_CORE = 150;
const CENTRE_EDGE = 900;
const CENTRE_SPINE = ['stadhuis', 'cathedral', 'boerentoren', 'centraal'];
const MAX_WEIGHT = 3; // main road (1) in the old town (×3)
const BUSY_REF = 600; // weighted m of pavement in range that `base` assumes
const MAX_CROWD = 2.2;

function streetWeight(e: GraphEdge, shared: boolean): number {
  if (e.sw?.[0] === 0 && e.sw[1] === 0 && !shared) return e.w >= 6 ? 0.8 : e.w >= 4 ? 0.1 : 0.2;
  return e.w >= 11 ? 1 : e.w >= 8 ? 0.6 : 0.2;
}

const distanceTo = (p: number[], x: number, z: number) => nearestSegment(p, x, z).d;

export type Zebra = [number, number, number, number]; // near end x, z, far end x, z

/**
 * A mapped zebra crossing (city.crossings) across the street (dx, dz) that leaves junction (nx, nz), on that street
 * rather than another arm of the junction, entered from the end nearer (x, z). Its ends are pushed out onto the pavement.
 */
export function zebraAcross(crossings: number[][], nx: number, nz: number, dx: number, dz: number, x: number, z: number): Zebra | null {
  let best: number[] | null = null, bestD = ZEBRA_REACH;
  const len = Math.hypot(dx, dz) || 1;
  for (const c of crossings) {
    const [ax, az, bx, bz] = [c[0], c[1], c[c.length - 2], c[c.length - 1]];
    const mx = (ax + bx) / 2 - nx, mz = (az + bz) / 2 - nz, d = Math.hypot(mx, mz);
    const span = Math.hypot(bx - ax, bz - az) || 1;
    // across the street, not along it, and on it: ahead of the junction
    if (d >= bestD || Math.abs(((bx - ax) * dx + (bz - az) * dz) / (span * len)) > 0.5 || mx * dx + mz * dz <= 0) continue;
    bestD = d;
    best = c;
  }
  if (!best) return null;
  const [ax, az, bx, bz] = [best[0], best[1], best[best.length - 2], best[best.length - 1]];
  const span = Math.hypot(bx - ax, bz - az) || 1, ux = ((bx - ax) / span) * ZEBRA_KERB, uz = ((bz - az) / span) * ZEBRA_KERB;
  const [a, b]: [number, number][] = [[ax - ux, az - uz], [bx + ux, bz + uz]];
  return Math.hypot(a[0] - x, a[1] - z) < Math.hypot(b[0] - x, b[1] - z) ? [...a, ...b] : [...b, ...a];
}

type State = 'walk' | 'down' | 'flee';

export interface Ped {
  body: RAPIER.RigidBody;
  pts: number[];
  i: number;
  last: Step;
  speed: number;
  state: State;
  timer: number;
  heading: number;
  phase: number;
  fall: number;
  prev: { x: number; z: number };
  avatar: number;
  away?: [number, number]; // else from the player
  zebra?: Zebra; // the crossing its path starts with
}

export function personBody(world: RAPIER.World, x: number, z: number, radius: number, mass: number, damping: number): RAPIER.RigidBody {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, z).lockRotations().setLinearDamping(damping));
  world.createCollider(
    RAPIER.ColliderDesc.ball(radius)
      .setDensity(mass / (Math.PI * radius * radius))
      .setFriction(0)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setCollisionGroups(groups(GROUP.PED, GROUP.STATIC | WHEELS | GROUP.PED)),
    body,
  );
  return body;
}

export class Pedestrians {
  readonly peds: Ped[] = [];
  private spawnTimer = 0;
  private matrix = new THREE.Matrix4();
  private quat = new THREE.Quaternion();
  private fallQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  private pos = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private target: number;
  private weight: Float32Array;
  private mid: Float32Array;
  /** Per walk edge: [left, right] looking a → b (m; 0 = centreline, -1 = none). */
  private sides: Float32Array;
  private trim: Float32Array;

  constructor(
    private physics: Physics,
    private graph: NavGraph,
    roads: NavGraph,
    private base: number,
    private view: number,
    private crowd: Crowd,
    landmarks: Landmark[],
    private crossings: number[][] = [],
    private signals?: TrafficSignals,
  ) {
    this.target = base;
    const spine = CENTRE_SPINE.flatMap((id) => {
      const l = landmarks.find((m) => m.id === id);
      return l ? [l.x, l.z] : [];
    });
    const alongRoad = (p: number[], test: (d: number, w: number) => boolean) => {
      const cum = cumulative(p), len = cum[cum.length - 1];
      const at = (f: number) => {
        const q = pointAt(p, cum, len * f), near = roads.nearest(q.x, q.z, 8);
        return !!near && test(near.dist, roads.edges[near.edge].w);
      };
      return at(0.5) && (at(0.3) || at(0.7));
    };
    this.weight = new Float32Array(graph.edges.length);
    this.mid = new Float32Array(graph.edges.length * 2);
    this.sides = new Float32Array(graph.edges.length * 2);
    this.trim = new Float32Array(graph.nodes.length / 2);
    graph.edges.forEach((e, i) => {
      const m = (e.p.length / 2) >> 1;
      const x = (this.mid[i * 2] = e.p[m * 2]), z = (this.mid[i * 2 + 1] = e.p[m * 2 + 1]);
      let [left, right] = e.sw ?? [0, 0];
      const shared = left === 0 && right === 0 && e.w >= 6 && alongRoad(e.p, (d) => d < 1);
      if (shared) left = right = e.w / 2 - SHARED_INSET;
      else if ((left !== 0 || right !== 0) && e.len > 20) {
        // dual carriageways: the map puts the inner pavement on the other one
        if (left > 0 && alongRoad(offsetPolyline(e.p, -left), (d, w) => d < w / 2 + 0.3)) left = -1;
        if (right > 0 && alongRoad(offsetPolyline(e.p, right), (d, w) => d < w / 2 + 0.3)) right = -1;
      }
      this.sides[i * 2] = left;
      this.sides[i * 2 + 1] = right;
      const centre = 1 - THREE.MathUtils.smoothstep(distanceTo(spine, x, z), CENTRE_CORE, CENTRE_EDGE);
      this.weight[i] = streetWeight(e, shared) * (1 + 2 * centre) * (left < 0 && right < 0 ? NO_PAVEMENT : 1);
      if (left !== 0 || right !== 0) {
        this.trim[e.a] = Math.max(this.trim[e.a], e.w / 2 + KERB);
        this.trim[e.b] = Math.max(this.trim[e.b], e.w / 2 + KERB);
      }
    });
  }

  private crowdAt(x: number, z: number): number {
    let busy = 0;
    for (let i = 0; i < this.weight.length; i++) {
      if ((this.mid[i * 2] - x) ** 2 + (this.mid[i * 2 + 1] - z) ** 2 < SPAWN_MAX ** 2) busy += this.graph.edges[i].len * this.weight[i];
    }
    return Math.round(this.base * THREE.MathUtils.clamp(busy / BUSY_REF, 1, MAX_CROWD));
  }

  update(dt: number, px: number, pz: number, initial = false) {
    this.spawnTimer -= dt;
    if (initial || this.spawnTimer <= 0) {
      this.spawnTimer = 0.3;
      this.target = this.crowdAt(px, pz);
      for (let i = this.peds.length - 1; i >= 0; i--) {
        const p = this.peds[i], t = p.body.translation();
        if (Math.hypot(t.x - px, t.y - pz) > DESPAWN) this.remove(p);
      }
      for (let n = initial ? this.target * 4 : Math.max(3, Math.ceil(this.target / 40)); n > 0 && this.peds.length < this.target; n--) {
        this.spawn(px, pz, initial ? 8 : SPAWN_MIN);
      }
    }
    for (const p of this.peds) this.step(p, dt, px, pz);
  }

  savePrev() {
    for (const p of this.peds) {
      const t = p.body.translation();
      p.prev.x = t.x;
      p.prev.z = t.y;
    }
  }

  remove(p: Ped) {
    this.physics.remove(p.body);
    this.peds.splice(this.peds.indexOf(p), 1);
  }

  knockDown(p: Ped, dx: number, dz: number, speed: number) {
    if (p.state === 'down') return;
    p.state = 'down';
    p.away = undefined;
    p.timer = 2.2 + Math.random();
    p.fall = Math.atan2(dz, dx);
    const len = Math.hypot(dx, dz) || 1;
    const fling = Math.min(speed * 0.6, 9);
    p.body.setLinvel({ x: (dx / len) * fling, y: (dz / len) * fling }, true);
    p.body.collider(0).setCollisionGroups(groups(GROUP.PED, GROUP.STATIC | GROUP.PED)); // no WHEELS: cars don't drag them
  }

  inFront(x: number, z: number, angle: number, range: number, cone: number): Ped | null {
    let best: Ped | null = null, bestD = range;
    for (const p of this.peds) {
      if (p.state === 'down') continue;
      const t = p.body.translation();
      const dx = t.x - x, dz = t.y - z, d = Math.hypot(dx, dz);
      if (d >= bestD) continue;
      const off = Math.atan2(dz, dx) - angle;
      if (Math.abs(wrapAngle(off)) > cone) continue;
      best = p;
      bestD = d;
    }
    return best;
  }

  clearWay(x: number, z: number, angle: number) {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const p of this.peds) {
      if (p.state === 'down') continue;
      const t = p.body.translation(), rx = t.x - x, rz = t.y - z;
      const ahead = rx * c + rz * s, side = -rx * s + rz * c;
      if (ahead < 0 || ahead > CLEAR_AHEAD || Math.abs(side) > CLEAR_SIDE) continue;
      p.state = 'flee';
      p.timer = 1.5;
      p.away = side < 0 ? [s, -c] : [-s, c];
    }
  }

  scare(x: number, z: number, radius: number) {
    for (const p of this.peds) {
      const t = p.body.translation();
      if (p.state === 'walk' && Math.hypot(t.x - x, t.y - z) < radius) {
        p.state = 'flee';
        p.timer = 4 + Math.random() * 3;
      }
    }
  }

  spawnFleeing(x: number, z: number, avatar?: number): Ped {
    const p = this.create(x, z, { edge: 0, forward: true }, []);
    p.state = 'flee';
    p.timer = 6;
    if (avatar !== undefined) p.avatar = avatar;
    return p;
  }

  private spawn(px: number, pz: number, minD: number) {
    const edge = this.graph.randomEdgeNear(
      px, pz, minD, SPAWN_MAX, (i) => this.graph.edges[i].len > 6 && Math.random() * MAX_WEIGHT < this.weight[i],
    );
    if (edge < 0) return;
    const step: Step = { edge, forward: Math.random() < 0.5 };
    const lane = this.laneFor(step);
    if (!lane) return;
    const k = Math.floor(Math.random() * (lane.length / 2 - 1));
    const x = lane[k * 2] + (lane[k * 2 + 2] - lane[k * 2]) * Math.random();
    const z = lane[k * 2 + 1] + (lane[k * 2 + 3] - lane[k * 2 + 1]) * Math.random();
    if (this.physics.boxOverlaps(x, z, 0, RADIUS + 0.2, RADIUS + 0.2)) return;
    this.create(x, z, step, lane, k + 1);
  }

  private create(x: number, z: number, last: Step, pts: number[], i = 1): Ped {
    const body = personBody(this.physics.world, x, z, RADIUS, 70, 2);
    const p: Ped = {
      body, pts, i, last, speed: 1.1 + Math.random() * 0.5, state: 'walk', timer: 0, heading: 0, phase: Math.random(),
      fall: 0, prev: { x, z }, avatar: this.crowd.pick(),
    };
    this.physics.owners.set(body.collider(0).handle, { kind: 'ped', entity: p });
    this.peds.push(p);
    return p;
  }

  private pickStep(options: Step[]): Step {
    let r = Math.random() * options.reduce((sum, s) => sum + this.weight[s.edge], 0);
    for (const s of options) if ((r -= this.weight[s.edge]) <= 0) return s;
    return options[options.length - 1];
  }

  /** The walkable lanes along a step: one per side with a pavement, or a line within a shared street. */
  private lanes(step: Step): number[][] {
    const e = this.graph.edges[step.edge];
    const l = this.sides[step.edge * 2], r = this.sides[step.edge * 2 + 1];
    const sides = step.forward ? [l, r] : [r, l];
    return [0, 1].filter((s) => sides[s] >= 0).map((s) => {
      const off = sides[s] === 0 ? (Math.random() - 0.5) * Math.max(1.5, (e.w - 2) * 0.8) : sides[s];
      return this.graph.lane(step, (s === 1 ? off : -off) + KEEP_RIGHT);
    });
  }

  /** Given a position, the same side of the street; without one, either. */
  private laneFor(step: Step, x?: number, z?: number): number[] | null {
    const lanes = this.lanes(step);
    if (!lanes.length) return null;
    const lane = x === undefined || z === undefined || lanes.length < 2 ? pick(lanes) : lanes.sort((a, b) => distanceTo(a, x, z) - distanceTo(b, x, z))[0];
    return this.atKerbs(lane, step);
  }

  /** To the other pavement over a mapped zebra at this junction, if there is one: across it end to end, then on along. */
  private crossing(step: Step, x: number, z: number): { pts: number[]; zebra: Zebra } | null {
    const lanes = this.lanes(step);
    const e = this.graph.edges[step.edge], n = step.forward ? e.a : e.b, p = e.p, m = p.length;
    const [dx, dz] = step.forward ? [p[2] - p[0], p[3] - p[1]] : [p[m - 4] - p[m - 2], p[m - 3] - p[m - 1]];
    const zebra = lanes.length === 2 ? zebraAcross(this.crossings, this.graph.nodes[n * 2], this.graph.nodes[n * 2 + 1], dx, dz, x, z) : null;
    if (!zebra) return null;
    const far = this.atKerbs(lanes.sort((a, b) => distanceTo(b, x, z) - distanceTo(a, x, z))[0], step);
    return { pts: [...zebra, ...far.slice((nearestSegment(far, zebra[2], zebra[3]).k + 1) * 2)], zebra };
  }

  private kerbLane(step: Step): number[] {
    return this.atKerbs(this.graph.lane(step, Math.max(0, this.graph.edges[step.edge].w / 2 - SHARED_INSET)), step);
  }

  private atKerbs(lane: number[], step: Step): number[] {
    const e = this.graph.edges[step.edge];
    return trimPolyline(lane, this.trim[step.forward ? e.a : e.b], this.trim[this.graph.endNode(step)]);
  }

  private step(p: Ped, dt: number, px: number, pz: number) {
    const t = p.body.translation();
    const v = p.body.linvel();
    let wantX = 0, wantZ = 0, speed = 0;

    if (p.state === 'down') {
      p.timer -= dt;
      if (p.timer <= 0) {
        p.state = 'flee';
        p.timer = 5;
        p.body.collider(0).setCollisionGroups(groups(GROUP.PED, GROUP.STATIC | WHEELS | GROUP.PED));
      }
    } else if (p.state === 'flee') {
      p.timer -= dt;
      [wantX, wantZ] = p.away ?? [t.x - px, t.y - pz];
      speed = FLEE_SPEED;
      if (p.timer <= 0) this.rejoin(p);
    } else {
      let n = p.pts.length / 2;
      if (p.i >= n) {
        const options = this.graph.options(this.graph.endNode(p.last), p.last.edge);
        const next = this.pickStep(options);
        const cross = Math.random() < CROSS_CHANCE ? this.crossing(next, t.x, t.y) : null;
        const lane = cross?.pts ?? this.laneFor(next, t.x, t.y) ?? this.kerbLane(next);
        p.zebra = cross?.zebra;
        p.pts = lane;
        p.i = 0;
        p.last = next;
        n = lane.length / 2;
      }
      wantX = p.pts[p.i * 2] - t.x;
      wantZ = p.pts[p.i * 2 + 1] - t.y;
      const d = Math.hypot(wantX, wantZ);
      const z = p.zebra;
      // At the kerb of a crossing in a signalled junction: wait for the cars on that street to get red.
      const waiting = p.i === 0 && !!z && d < 1.2 && !!this.signals && !this.signals.walk((z[0] + z[2]) / 2, (z[1] + z[3]) / 2, z[1] - z[3], z[2] - z[0]);
      p.timer = Math.hypot(v.x, v.y) < 0.3 * p.speed && !waiting ? p.timer + dt : 0;
      if (waiting) wantX = wantZ = 0;
      else if (p.i > 0 && segmentDistance(p.pts, p.i - 1, t.x, t.y) > OFF_PATH) this.rejoin(p);
      else if (d < 0.8 || p.timer > 2) {
        p.i++;
        p.timer = 0;
      } else if (p.timer > 0.4) {
        const x = wantX;
        wantX -= wantZ;
        wantZ += x;
      }
      speed = waiting ? 0 : p.speed;
    }

    if (p.state !== 'down') {
      const len = Math.hypot(wantX, wantZ) || 1;
      const k = Math.min(1, 8 * dt);
      p.body.setLinvel({ x: v.x + ((wantX / len) * speed - v.x) * k, y: v.y + ((wantZ / len) * speed - v.y) * k }, true);
    }
    const moving = Math.hypot(v.x, v.y);
    if (moving > 0.3 && p.state !== 'down') {
      p.heading += wrapAngle(Math.atan2(v.y, v.x) - p.heading) * Math.min(1, 10 * dt);
    }
    p.phase += phaseStep(this.crowd.clip(p.avatar, clipForSpeed(moving)), moving, dt);
  }

  private rejoin(p: Ped) {
    p.away = p.zebra = undefined;
    const t = p.body.translation();
    const near = this.graph.nearest(t.x, t.y, 40);
    if (!near) {
      p.state = 'flee';
      p.timer = 2;
      return;
    }
    const e = this.graph.edges[near.edge].p, v = Math.min(near.vertex, e.length / 2 - 2), vel = p.body.linvel();
    const ahead = (e[v * 2 + 2] - e[v * 2]) * vel.x + (e[v * 2 + 3] - e[v * 2 + 1]) * vel.y;
    const step: Step = { edge: near.edge, forward: ahead ? ahead > 0 : Math.random() < 0.5 };
    const lane = this.laneFor(step, t.x, t.y) ?? this.kerbLane(step);
    const { k } = nearestSegment(lane, t.x, t.y);
    const s = along(lane[k * 2], lane[k * 2 + 1], lane[k * 2 + 2], lane[k * 2 + 3], t.x, t.y);
    p.pts = [
      lane[k * 2] + (lane[k * 2 + 2] - lane[k * 2]) * s, lane[k * 2 + 1] + (lane[k * 2 + 3] - lane[k * 2 + 1]) * s,
      ...lane.slice(k * 2 + 2),
    ];
    p.i = 0;
    p.last = step;
    p.state = 'walk';
  }

  render(alpha: number, camera: THREE.Vector3) {
    for (const p of this.peds) {
      const t = p.body.translation();
      const x = p.prev.x + (t.x - p.prev.x) * alpha, z = p.prev.z + (t.y - p.prev.z) * alpha;
      if ((x - camera.x) ** 2 + (z - camera.z) ** 2 > this.view ** 2) continue;
      const distance = Math.hypot(x - camera.x, z - camera.z);
      if (p.state === 'down') {
        this.quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -p.fall).multiply(this.fallQuat);
        this.matrix.compose(this.pos.set(x, 0.2, z), this.quat, this.one);
        this.crowd.add(p.avatar, this.matrix, 'idle', 0, distance);
      } else {
        this.quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -p.heading);
        this.matrix.compose(this.pos.set(x, 0, z), this.quat, this.one);
        const v = p.body.linvel();
        this.crowd.add(p.avatar, this.matrix, clipForSpeed(Math.hypot(v.x, v.y)), p.phase, distance);
      }
    }
  }
}
