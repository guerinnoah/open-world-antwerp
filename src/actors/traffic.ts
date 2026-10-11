import { weightedPick } from '../core/util';
import { RAPIER, type Physics } from '../physics/physics';
import type { NavGraph, Step } from '../world/navGraph';
import { lengthFrom, segmentDistance } from '../world/polyline';
import { extent } from './trackProbe';
import { VEHICLE_TYPES, Vehicle, isEmergency, paintFor } from './vehicle';

const SPAWN_MIN = 140;
const SPAWN_MAX = 300;
const DESPAWN = 340;
const TWO_WAY_LANE = 1.9; // m from the centreline to the lane centre on two-way roads
const CORNER_SPEED = 3.5; // m/s through a right-angle junction
const DECEL = 3; // m/s², comfortable braking
const RESPONDING = 1.35; // × the speed limit, siren on
const PULL_OVER = 1.3; // m to the right, for a siren behind
const OVERTAKE = 1.1; // m to the left, past cars pulling over
const HEARD = 45; // m: how far behind a siren gets drivers to pull over

interface Driver {
  id: number;
  v: Vehicle;
  pts: number[]; // flat [x, z, …]; `limits` and `i` index points, not floats
  limits: number[];
  i: number;
  last: Step;
  temper: number;
  stuck: number;
  bold: number; // s left ignoring obstacles after being stuck (pushes through bumps and parked cars)
  deadEnd: boolean;
  wedged: number;
  reversing: number;
  honkCooldown: number;
  yielding: number; // s left pulling over for a siren
  overtaking: number; // s left swinging out past cars that pull over (siren on)
  pull: number; // m off the lane, + = right
}

export interface TrafficHost {
  readonly vehicles: Vehicle[];
  addVehicle(v: Vehicle): void;
  removeVehicle(v: Vehicle): void;
}

export class Traffic {
  readonly honks: [number, number][] = [];
  sirens: Vehicle[] = []; // driven ones, refreshed with spawning
  private drivers = new Map<Vehicle, Driver>();
  private nextId = 0;
  private spawnTimer = 0;
  private box = new RAPIER.Cuboid(1, 1);

  constructor(
    private physics: Physics,
    private graph: NavGraph,
    private host: TrafficHost,
    private target: number,
  ) {}

  get count() {
    return this.drivers.size;
  }

  has(v: Vehicle) {
    return this.drivers.has(v);
  }

  release(v: Vehicle) {
    this.drivers.delete(v);
  }

  despawn(v: Vehicle) {
    this.drivers.delete(v);
    this.host.removeVehicle(v);
  }

  update(dt: number, px: number, pz: number, initial = false) {
    this.spawnTimer -= dt;
    if (initial || this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      for (const d of this.drivers.values()) {
        if (Math.hypot(d.v.x - px, d.v.z - pz) > DESPAWN) this.despawn(d.v);
        else if (isEmergency(d.v.spec) && Math.random() < 0.0025) this.respond(d, !d.v.siren);
      }
      this.sirens = this.host.vehicles.filter((v) => v.siren && (v.driven || v.remote));
      for (let n = initial ? this.target * 3 : 2; n > 0 && this.drivers.size < this.target; n--) {
        this.spawn(px, pz, initial ? 40 : SPAWN_MIN);
      }
    }
    for (const d of this.drivers.values()) this.drive(d, dt);
  }

  private laneOffset(step: Step): number {
    return this.graph.edges[step.edge].o ? 0 : TWO_WAY_LANE;
  }

  private spawn(px: number, pz: number, minD: number) {
    const edge = this.graph.randomEdgeNear(px, pz, minD, SPAWN_MAX, (i) => this.graph.edges[i].len > 12);
    if (edge < 0) return;
    const e = this.graph.edges[edge];
    const step: Step = { edge, forward: e.o ? true : Math.random() < 0.5 };
    const lane = this.graph.lane(step, this.laneOffset(step));
    const k = Math.floor(Math.random() * (lane.length / 2 - 1));
    const t = Math.random();
    const x = lane[k * 2] + (lane[k * 2 + 2] - lane[k * 2]) * t, z = lane[k * 2 + 1] + (lane[k * 2 + 3] - lane[k * 2 + 1]) * t;
    const angle = Math.atan2(lane[k * 2 + 3] - lane[k * 2 + 1], lane[k * 2 + 2] - lane[k * 2]);
    const [spec] = weightedPick(VEHICLE_TYPES, VEHICLE_TYPES.map(([, w]) => w));
    if (this.physics.boxOverlaps(x, z, angle, spec.length / 2 + 2, spec.width / 2 + 0.3)) return;
    // Cars spawned this frame aren't in Rapier's query structures until the next step: check them directly.
    for (const other of this.drivers.keys()) if (Math.hypot(other.x - x, other.z - z) < 12) return;

    const v = new Vehicle(this.physics.world, spec, paintFor(spec), x, z, angle);
    v.driven = true;
    const speed = e.s * 0.7;
    v.body.setLinvel({ x: Math.cos(angle) * speed, y: Math.sin(angle) * speed }, true);
    this.host.addVehicle(v);
    const d: Driver = {
      id: this.nextId++, v, pts: [], limits: [], i: 1, last: step, temper: 0.85 + Math.random() * 0.2,
      stuck: 0, bold: 0, deadEnd: false, wedged: 0, reversing: 0, honkCooldown: 0, yielding: 0, overtaking: 0, pull: 0,
    };
    this.append(d, step, [x, z, ...lane.slice(k * 2 + 2)]);
    this.drivers.set(v, d);
    if (Math.random() < (spec.siren ?? 0)) this.respond(d, true);
  }

  private respond(d: Driver, on: boolean) {
    d.v.siren = on;
    const k = on ? RESPONDING : 1 / RESPONDING;
    d.temper *= k;
    for (let i = 0; i < d.limits.length; i++) d.limits[i] *= k;
  }

  private sirenBehind(v: Vehicle): boolean {
    for (const s of this.sirens) {
      if (s === v) continue;
      const c = Math.cos(s.angle), n = Math.sin(s.angle);
      const rx = v.x - s.x, rz = v.z - s.z;
      const ahead = rx * c + rz * n;
      if (ahead > 0 && ahead < HEARD && Math.abs(-rx * n + rz * c) < 4 && Math.cos(v.angle - s.angle) > 0.5) return true;
    }
    return false;
  }

  private append(d: Driver, step: Step, lane = this.graph.lane(step, this.laneOffset(step))) {
    const limit = this.graph.edges[step.edge].s * d.temper;
    for (let i = 0; i < lane.length; i += 2) {
      const n = d.pts.length;
      if (n && Math.hypot(lane[i] - d.pts[n - 2], lane[i + 1] - d.pts[n - 1]) < 1) continue;
      d.pts.push(lane[i], lane[i + 1]);
      d.limits.push(limit);
    }
    d.last = step;
  }

  private extend(d: Driver) {
    let ahead = lengthFrom(d.pts, d.i);
    while (ahead < 80 && !d.deadEnd) {
      const node = this.graph.endNode(d.last);
      const options = this.graph.options(node, d.last.edge);
      if (!options.length) {
        d.deadEnd = true;
        break;
      }
      const n = d.pts.length;
      const hx = d.pts[n - 2] - d.pts[n - 4], hz = d.pts[n - 1] - d.pts[n - 3];
      const weights = options.map((s) => {
        const p = this.graph.edges[s.edge].p;
        const m = p.length;
        const [dx, dz] = s.forward ? [p[2] - p[0], p[3] - p[1]] : [p[m - 4] - p[m - 2], p[m - 3] - p[m - 1]];
        const cos = (hx * dx + hz * dz) / ((Math.hypot(hx, hz) || 1) * (Math.hypot(dx, dz) || 1));
        return 1 + Math.max(cos, 0) * 2;
      });
      const before = d.pts.length / 2 - 1;
      this.append(d, weightedPick(options, weights));
      ahead += lengthFrom(d.pts, before);
    }
    if (d.i > 24) {
      const drop = d.i - 2;
      d.pts.splice(0, drop * 2);
      d.limits.splice(0, drop);
      d.i -= drop;
    }
  }

  private drive(d: Driver, dt: number) {
    const v = d.v;
    const x = v.x, z = v.z, a = v.angle;
    const fx = Math.cos(a), fz = Math.sin(a);
    const speed = v.forwardSpeed;
    this.extend(d);

    // Knocked off the route: measured to the current segment, not the next point, which can be far on long straights.
    if (segmentDistance(d.pts, d.i - 1, x, z) > 15) {
      this.rejoin(d);
      return;
    }

    const look = 4 + Math.abs(speed) * 0.5;
    const n = d.pts.length / 2;
    if (d.deadEnd && d.i >= n - 1) {
      this.despawn(v);
      return;
    }
    while (d.i < n - 1 && Math.hypot(d.pts[d.i * 2] - x, d.pts[d.i * 2 + 1] - z) < look) d.i++;

    if (!v.siren && this.sirens.length && this.sirenBehind(v)) d.yielding = 1.5;
    d.yielding -= dt;
    d.overtaking -= dt;
    const pull = d.yielding > 0 ? PULL_OVER : d.overtaking > 0 ? -OVERTAKE : 0;
    d.pull += (pull - d.pull) * Math.min(1, 1.8 * dt);
    let dx = d.pts[d.i * 2] - x, dz = d.pts[d.i * 2 + 1] - z;
    if (Math.abs(d.pull) > 0.05) {
      const ux = d.pts[d.i * 2] - d.pts[d.i * 2 - 2], uz = d.pts[d.i * 2 + 1] - d.pts[d.i * 2 - 1];
      const len = Math.hypot(ux, uz) || 1;
      dx -= (uz / len) * d.pull;
      dz += (ux / len) * d.pull;
    }
    const alpha = Math.atan2(-dx * fz + dz * fx, dx * fx + dz * fz);
    const steer = Math.max(-1, Math.min(1, alpha * 2.2));

    let target = d.limits[d.i];
    let dist = Math.hypot(dx, dz);
    for (let j = d.i; j < n - 1 && dist < 45; j++) {
      const ax = d.pts[j * 2] - d.pts[j * 2 - 2], az = d.pts[j * 2 + 1] - d.pts[j * 2 - 1];
      const bx = d.pts[j * 2 + 2] - d.pts[j * 2], bz = d.pts[j * 2 + 3] - d.pts[j * 2 + 1];
      const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      if (turn > 0.35) {
        const corner = d.limits[j] + (CORNER_SPEED - d.limits[j]) * Math.min(turn / 1.6, 1);
        target = Math.min(target, Math.sqrt(corner * corner + 2 * DECEL * Math.max(dist - 4, 0)));
      }
      dist += Math.hypot(bx, bz);
    }
    target = Math.min(target, Math.abs(alpha) > 0.6 ? CORNER_SPEED + 1 : target);
    if (d.yielding > 0) target = Math.min(target, 3);

    d.honkCooldown -= dt;
    if (d.bold <= 0) {
      const { gap, blocker, player } = this.obstacleAhead(v, x, z, a, speed);
      // Two AI cars blocking each other (crossing at a junction) would wait forever: a siren, then the lower id, goes first.
      const other = blocker && this.drivers.get(blocker);
      const first = other && (v.siren !== other.v.siren ? v.siren : other.id > d.id);
      const yieldsToUs = first && this.blocks(v, other);
      // The gap is to its near side, so this stops about 1.3 m short, as it always did behind a car.
      if (gap < Infinity && !yieldsToUs) target = Math.min(target, Math.max(0, (gap - 1) * 0.9));
      if (v.siren && other && other.yielding > 0 && gap < 25) {
        d.overtaking = 1.5;
        target = Math.max(target, Math.min(3, gap - 1.5));
      }
      if (player && d.stuck > 1.2 && d.honkCooldown <= 0) {
        this.honks.push([x, z]);
        d.honkCooldown = 3 + Math.random() * 2;
      }
    }
    d.bold -= dt;
    if (target < 0.5 && Math.abs(speed) < 0.5) {
      d.stuck += dt;
      if (d.stuck > (v.siren ? 1.5 : 3.5)) {
        d.bold = 2.5;
        d.stuck = 0;
      }
    } else d.stuck = 0;

    if (d.reversing > 0) {
      d.reversing -= dt;
      v.controls = { steer: -steer, throttle: -0.7, handbrake: false };
      return;
    }
    d.wedged = target > 1 && Math.abs(speed) < 0.3 ? d.wedged + dt : 0;
    if (d.wedged > 2) {
      d.wedged = 0;
      d.reversing = 1.2;
    }

    const error = target - speed;
    const throttle = error > 0.3 ? Math.min(1, 0.25 + error / 3) : error < -0.3 ? Math.max(-1, error / 4 - 0.2) : 0.12;
    v.controls = { steer, throttle: target < 0.3 && speed < 0.3 ? 0 : throttle, handbrake: target < 0.3 && speed < 0.5 };
  }

  private blocks(v: Vehicle, other: Driver): boolean {
    const o = other.v, a = o.angle;
    const rx = v.x - o.x, rz = v.z - o.z;
    const ahead = rx * Math.cos(a) + rz * Math.sin(a);
    const side = -rx * Math.sin(a) + rz * Math.cos(a);
    return ahead > 0 && ahead < o.spec.length / 2 + 4 + Math.max(o.forwardSpeed, 0) * 1.3 + v.spec.length && Math.abs(side) < 2;
  }

  private obstacleAhead(v: Vehicle, x: number, z: number, a: number, speed: number): { gap: number; blocker?: Vehicle; player: boolean } {
    const len = 4 + Math.max(speed, 0) * 1.3;
    const half = v.spec.length / 2;
    const fx = Math.cos(a), fz = Math.sin(a);
    this.box.halfExtents = { x: len / 2, y: 0.95 };
    let gap = Infinity;
    let blocker: Vehicle | undefined;
    let player = false;
    this.physics.world.intersectionsWithShape(
      { x: x + fx * (half + len / 2), y: z + fz * (half + len / 2) },
      a,
      this.box,
      (collider) => {
        // To its near side: a fixed half car length off its centre put the back of a 12 m bus 5 m too far away.
        const p = collider.translation();
        const g = (p.x - x) * fx + (p.y - z) * fz - half - extent(collider, fx, fz);
        if (g < gap) {
          gap = g;
          const owner = this.physics.owners.get(collider.handle);
          blocker = owner?.kind === 'vehicle' ? (owner.entity as Vehicle) : undefined;
          player = owner?.kind === 'player' || (!!blocker && blocker.driven && !this.drivers.has(blocker));
        }
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_FIXED,
      undefined,
      undefined,
      v.body,
    );
    return { gap, blocker, player };
  }

  private rejoin(d: Driver) {
    const near = this.graph.nearest(d.v.x, d.v.z, 40);
    if (!near) {
      this.despawn(d.v);
      return;
    }
    const e = this.graph.edges[near.edge];
    const fx = Math.cos(d.v.angle), fz = Math.sin(d.v.angle);
    const ex = e.p[e.p.length - 2] - e.p[0], ez = e.p[e.p.length - 1] - e.p[1];
    const step: Step = { edge: near.edge, forward: e.o ? true : ex * fx + ez * fz >= 0 };
    const lane = this.graph.lane(step, this.laneOffset(step));
    const vertex = step.forward ? near.vertex : e.p.length / 2 - 1 - near.vertex;
    d.pts = [];
    d.limits = [];
    d.i = 1;
    d.deadEnd = false;
    this.append(d, step, [d.v.x, d.v.z, ...lane.slice(Math.min(vertex + 1, lane.length / 2 - 1) * 2)]);
  }
}
