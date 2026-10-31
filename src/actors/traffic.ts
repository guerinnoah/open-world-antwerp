import { weightedPick } from '../core/util';
import { RAPIER, type Physics } from '../physics/physics';
import type { NavGraph, Step } from '../world/navGraph';
import { lengthFrom, segmentDistance } from '../world/polyline';
import { extent } from './trackProbe';
import { VEHICLE_TYPES, Vehicle, isEmergency, isPolice, paintFor, type VehicleSpec } from './vehicle';

const SPAWN_MIN = 140;
const SPAWN_MAX = 300;
const DESPAWN = 340;
const TWO_WAY_LANE = 1.9; // m from the centreline
const CORNER_SPEED = 3.5; // m/s through a right angle
const DECEL = 3; // m/s²
const RESPONDING = 1.35; // × the speed limit
const PULL_OVER = 1.3; // m right
const OVERTAKE = 1.1; // m left
const CHASE_OVERTAKE = 2.2; // m left
const HEARD = 45; // m behind a siren
const SIGHT = 90; // m
const WITNESS = 60; // m
const CLOSE = 60; // m
const COP_SPAWN = [90, 180]; // m
const DISPATCH = 2; // s
const REROUTE = 1.5; // s
const MIN_REROUTE = 0.3; // s
const SEARCHED = 25; // m
const WET_STEP = 5; // m: quays have no wall to stop a car
const STOP_GAP = 7; // m, centre to centre
const BUST_RANGE = 14; // m, centre to centre
const STALL = 4; // s to make 6 m of progress
const DODGE = 1.8; // m
const CHASE_LIMIT = 1.6; // × the street's limit: flat out, narrow streets end in walls

const [PATROL_CAR, PATROL_VAN] = ['police', 'policevan'].map((n) => VEHICLE_TYPES.find(([s]) => s.name === n)![0]);

export interface Suspect {
  x: number;
  z: number;
  vx: number;
  vz: number;
  speed: number; // m/s
  ram: boolean;
  hidden: boolean; // indoors
  car: Vehicle | null; // not braked for when ramming
}

/** Once you stop they pull up instead, to arrest you. */
const ramming = (s: Suspect) => s.ram && Math.hypot(s.vx, s.vz) > 2;

interface Driver {
  id: number;
  v: Vehicle;
  pts: number[]; // flat [x, z, …]; `limits` and `i` index points, not floats
  limits: number[];
  i: number;
  last: Step;
  temper: number;
  stuck: number;
  bold: number; // s left ignoring obstacles after being stuck
  deadEnd: boolean;
  wedged: number;
  reversing: number;
  honkCooldown: number;
  yielding: number; // s
  overtaking: number; // s
  pull: number; // m off the lane, + = right
  chase: boolean;
  reroute: number; // s
  dodge: number; // s; the sign is the side, + = right
  wedges: number;
  anchor: [number, number, number]; // x, z, s since
  searching: [number, number] | null; // the sighting it's cruising round
}

export interface TrafficHost {
  readonly vehicles: Vehicle[];
  addVehicle(v: Vehicle): void;
  removeVehicle(v: Vehicle): void;
  /** Flat [x, z, …]; without it pursuers drive straight. */
  route?(x: number, z: number, heading: number, tx: number, tz: number): number[] | null;
  wet?(x: number, z: number): boolean;
}

export class Traffic {
  readonly honks: [number, number][] = [];
  sirens: Vehicle[] = []; // driven ones, refreshed with spawning
  police: Vehicle[] = []; // pursuers, refreshed with spawning
  spotted = false; // this step
  private suspect: Suspect | null = null;
  private lastSeen: [number, number] = [0, 0]; // pursuers only home in on what they can see
  private units = 0;
  private dispatch = 0;
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
    this.dispatch -= dt;
    if (initial || this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      for (const d of this.drivers.values()) {
        const dist = Math.hypot(d.v.x - px, d.v.z - pz);
        // Keeps getting stuck: swapped, out of sight, for a fresh one.
        if (dist > DESPAWN || (d.chase && d.wedges >= 3 && dist > SIGHT)) this.despawn(d.v);
        else if (isEmergency(d.v.spec) && !d.chase && Math.random() < 0.0025) this.respond(d, !d.v.siren);
      }
      if (this.units) this.callUnits(px, pz);
      this.police = [...this.drivers.values()].filter((d) => d.chase).map((d) => d.v);
      this.sirens = this.host.vehicles.filter((v) => v.siren && (v.driven || v.remote));
      for (let n = initial ? this.target * 3 : 2; n > 0 && this.drivers.size < this.target; n--) {
        this.spawn(px, pz, initial ? 40 : SPAWN_MIN);
      }
    }
    this.spotted = false;
    for (const d of this.drivers.values()) this.drive(d, dt);
  }

  pursue(units: number, suspect: Suspect | null) {
    if (units && !this.units && suspect) this.reveal(suspect.x, suspect.z);
    this.units = units;
    this.suspect = suspect;
    if (units || !this.police.length) return;
    for (const d of this.drivers.values()) {
      if (!d.chase) continue;
      d.chase = false;
      d.dodge = 0;
      if (d.v.siren) this.respond(d, false);
      this.rejoin(d);
    }
    this.police = [];
  }

  reveal(x: number, z: number) {
    this.lastSeen = [x, z];
  }

  witness(x: number, z: number): boolean {
    for (const d of this.drivers.values()) if (isPolice(d.v.spec) && this.sight(d.v, x, z, WITNESS) < Infinity) return true;
    return false;
  }

  pinned(x: number, z: number): boolean {
    return this.police.some((v) => Math.abs(v.forwardSpeed) < 3 && this.sight(v, x, z, BUST_RANGE) < Infinity);
  }

  /** Infinity when out of range or blocked. */
  private sight(v: Vehicle, x: number, z: number, range: number): number {
    const dx = x - v.x, dz = z - v.z, dist = Math.hypot(dx, dz);
    if (dist > range) return Infinity;
    if (dist < 1) return dist;
    return this.physics.castStatic(v.x, v.z, dx / dist, dz / dist, dist) < dist - 0.5 ? Infinity : dist;
  }

  /** Both sides of the car: a centre line of sight can still clip a corner. */
  private clearRun(v: Vehicle, x: number, z: number, dist: number): boolean {
    const dx = (x - v.x) / dist, dz = (z - v.z) / dist, half = v.spec.width / 2;
    return [-half, half].every((o) => this.physics.castStatic(v.x - dz * o, v.z + dx * o, dx, dz, dist) >= dist - 0.5) && this.dry(v.x, v.z, x, z);
  }

  private dry(x0: number, z0: number, x1: number, z1: number): boolean {
    if (!this.host.wet) return true;
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / WET_STEP);
    for (let k = 1; k <= n; k++) if (this.host.wet(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n)) return false;
    return true;
  }

  private callUnits(px: number, pz: number) {
    if (this.dispatch > 0 || this.police.length >= this.units) return;
    this.dispatch = DISPATCH;
    const [gx, gz] = this.lastSeen;
    let d: Driver | undefined, best = SIGHT * 2;
    for (const o of this.drivers.values()) {
      const dist = Math.hypot(o.v.x - gx, o.v.z - gz);
      if (!o.chase && isPolice(o.v.spec) && dist < best) [d, best] = [o, dist];
    }
    // Got well away: no more cars join.
    if (!d && Math.hypot(gx - px, gz - pz) < DESPAWN - COP_SPAWN[1]) {
      d = this.spawn(gx, gz, COP_SPAWN[0], COP_SPAWN[1], this.units >= 3 && Math.random() < 0.3 ? PATROL_VAN : PATROL_CAR);
    }
    if (!d) return;
    d.chase = true;
    d.reroute = d.yielding = d.overtaking = d.pull = d.dodge = d.wedges = 0;
    d.anchor = [d.v.x, d.v.z, 0];
    d.searching = null;
    if (!d.v.siren) this.respond(d, true);
  }

  private laneOffset(step: Step): number {
    return this.graph.edges[step.edge].o ? 0 : TWO_WAY_LANE;
  }

  private spawn(px: number, pz: number, minD: number, maxD = SPAWN_MAX, forced?: VehicleSpec): Driver | undefined {
    const edge = this.graph.randomEdgeNear(px, pz, minD, maxD, (i) => this.graph.edges[i].len > 12);
    if (edge < 0) return;
    const e = this.graph.edges[edge];
    const step: Step = { edge, forward: e.o ? true : Math.random() < 0.5 };
    // Facing the last sighting, not a U-turn.
    if (forced) {
      const n = this.graph.nodes, [gx, gz] = this.lastSeen;
      step.forward = Math.hypot(n[e.b * 2] - gx, n[e.b * 2 + 1] - gz) < Math.hypot(n[e.a * 2] - gx, n[e.a * 2 + 1] - gz);
    }
    const lane = this.graph.lane(step, this.laneOffset(step));
    const k = Math.floor(Math.random() * (lane.length / 2 - 1));
    const t = Math.random();
    const x = lane[k * 2] + (lane[k * 2 + 2] - lane[k * 2]) * t, z = lane[k * 2 + 1] + (lane[k * 2 + 3] - lane[k * 2 + 1]) * t;
    const angle = Math.atan2(lane[k * 2 + 3] - lane[k * 2 + 1], lane[k * 2 + 2] - lane[k * 2]);
    const spec = forced ?? weightedPick(VEHICLE_TYPES, VEHICLE_TYPES.map(([, w]) => w))[0];
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
      chase: false, reroute: 0, dodge: 0, wedges: 0, anchor: [x, z, 0], searching: null,
    };
    this.append(d, step, [x, z, ...lane.slice(k * 2 + 2)]);
    this.drivers.set(v, d);
    if (!forced && Math.random() < (spec.siren ?? 0)) this.respond(d, true);
    return d;
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
    const suspect = d.chase ? this.suspect : null;
    if (suspect) {
      const seen = suspect.hidden ? Infinity : this.sight(v, suspect.x, suspect.z, SIGHT);
      if (seen < Infinity) {
        this.spotted = true;
        this.reveal(suspect.x, suspect.z);
      }
      const at = d.anchor;
      if (Math.hypot(x - at[0], z - at[1]) > 6) d.anchor = [x, z, 0];
      else if ((at[2] += dt) > STALL && Math.hypot(suspect.x - x, suspect.z - z) > BUST_RANGE) {
        d.reversing = 1.2;
        this.sidestep(d);
      }
      d.reroute -= dt;
      if (seen < CLOSE && this.clearRun(v, suspect.x, suspect.z, seen)) {
        this.closeIn(d, suspect, seen, dt);
        return;
      }
      if (!this.hunt(d, seen < Infinity, suspect.speed)) return;
    } else this.extend(d);

    // Knocked off the route: measured to the current segment, not the next point, which can be far on long straights.
    if ((!suspect || d.searching) && segmentDistance(d.pts, d.i - 1, x, z) > 15) {
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
    d.dodge -= Math.sign(d.dodge) * Math.min(Math.abs(d.dodge), dt);
    const pull = d.yielding > 0 ? PULL_OVER : d.overtaking > 0 ? -(d.chase ? CHASE_OVERTAKE : OVERTAKE) : d.dodge ? Math.sign(d.dodge) * DODGE : 0;
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
    if (suspect && !ramming(suspect)) target = Math.min(target, this.pullUp(suspect, Math.hypot(suspect.x - x, suspect.z - z)));

    d.honkCooldown -= dt;
    if (d.bold <= 0) {
      const { gap, blocker, player } = this.obstacleAhead(v, x, z, a, speed);
      // Two AI cars blocking each other (crossing at a junction) would wait forever: a siren, then the lower id, goes first.
      const other = blocker && this.drivers.get(blocker);
      const first = other && (v.siren !== other.v.siren ? v.siren : other.id > d.id);
      const yieldsToUs = first && this.blocks(v, other);
      const rammingThem = suspect && ramming(suspect) && blocker && blocker === suspect.car;
      // The gap is to its near side, so this stops about 1.3 m short, as it always did behind a car.
      if (gap < Infinity && !yieldsToUs && !rammingThem) target = Math.min(target, Math.max(0, (gap - 1) * 0.9));
      const inTheWay = other && (other.yielding > 0 || (suspect && Math.abs(other.v.forwardSpeed) < 2));
      if (v.siren && inTheWay && gap < 25) {
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

    this.pedal(d, target, steer, dt);
  }

  private pedal(d: Driver, target: number, steer: number, dt: number) {
    const v = d.v, speed = v.forwardSpeed;
    if (d.reversing > 0) {
      d.reversing -= dt;
      v.controls = { steer: -steer, throttle: -0.7, handbrake: false };
      return;
    }
    d.wedged = target > 1 && Math.abs(speed) < 0.3 ? d.wedged + dt : 0;
    if (d.wedged > 2) {
      d.wedged = 0;
      d.reversing = 1.2;
      if (d.chase) this.sidestep(d);
    }
    const error = target - speed;
    const throttle = error > 0.3 ? Math.min(1, 0.25 + error / 3) : error < -0.3 ? Math.max(-1, error / 4 - 0.2) : 0.12;
    // boost: traffic isn't capped to the player's regular-speed limit — it already self-limits to each road's speed.
    v.controls = { steer, throttle: target < 0.3 && speed < 0.3 ? 0 : throttle, handbrake: target < 0.3 && speed < 0.5, boost: true };
  }

  private pullUp(s: Suspect, dist: number): number {
    return Math.min(s.speed, Math.hypot(s.vx, s.vz) + Math.max(0, dist - STOP_GAP) * 0.8);
  }

  /** To the last sighting, then cruising round it. False when there's nothing left to do this step. */
  private hunt(d: Driver, seen: boolean, speed: number): boolean {
    const v = d.v, [gx, gz] = this.lastSeen;
    if (seen || (d.searching && Math.hypot(d.searching[0] - gx, d.searching[1] - gz) > SEARCHED)) d.searching = null;
    else if (!d.searching && Math.hypot(gx - v.x, gz - v.z) < SEARCHED) {
      if (!this.graph.nearest(v.x, v.z, 40)) {
        v.controls = { steer: 0, throttle: 0, handbrake: true };
        return false;
      }
      d.searching = [gx, gz];
      this.rejoin(d);
    }
    if (d.searching) {
      this.extend(d);
      return true;
    }
    const off = d.i >= d.pts.length / 2 - 1 || segmentDistance(d.pts, d.i - 1, v.x, v.z) > 15;
    if (d.reroute <= 0 || (off && d.reroute < REROUTE - MIN_REROUTE)) this.routeTo(d, gx, gz, speed);
    return true;
  }

  private closeIn(d: Driver, s: Suspect, dist: number, dt: number) {
    const v = d.v, speed = v.forwardSpeed;
    // Aim ahead of them to cut across rather than trail.
    const lead = Math.min(dist / 15, 1.2);
    const ax = s.x + s.vx * lead - v.x, az = s.z + s.vz * lead - v.z;
    const fx = Math.cos(v.angle), fz = Math.sin(v.angle);
    const alpha = Math.atan2(-ax * fz + az * fx, ax * fx + az * fz);
    const steer = Math.max(-1, Math.min(1, alpha * 2.5));
    let target = ramming(s) ? Math.hypot(s.vx, s.vz) + 5 : this.pullUp(s, dist);
    if (Math.abs(alpha) > 1.2) target = Math.min(target, CORNER_SPEED + 2);
    // Too close behind to swing round: back up first.
    if (Math.abs(alpha) > 2 && dist < 12 && Math.abs(speed) < 2 && d.reversing <= 0) d.reversing = 0.9;
    this.pedal(d, target, steer, dt);
  }

  /** Else it backs off and drives into the same corner again. */
  private sidestep(d: Driver) {
    const v = d.v;
    d.wedges++;
    d.anchor = [v.x, v.z, 0]; // one count per stuck spell: the stall and wedge checks both land here
    let side = d.dodge > 0 ? -1 : 1, best = 6;
    for (const o of this.host.vehicles) {
      const dist = o === v ? Infinity : Math.hypot(o.x - v.x, o.z - v.z);
      if (dist < best) [best, side] = [dist, (o.x - v.x) * Math.sin(v.angle) - (o.z - v.z) * Math.cos(v.angle) > 0 ? 1 : -1];
    }
    d.dodge = side * 3.5;
  }

  private routeTo(d: Driver, gx: number, gz: number, speed: number) {
    const v = d.v;
    // Clear, dry and close: straight there.
    const dist = Math.hypot(gx - v.x, gz - v.z);
    const route = (dist > 1 && dist < SIGHT && this.clearRun(v, gx, gz, dist) ? null : this.host.route?.(v.x, v.z, v.angle, gx, gz)) ?? [];
    const n = route.length;
    // Off the road to a park or square, not into a dock.
    if (n ? this.dry(route[n - 2], route[n - 1], gx, gz) : this.dry(v.x, v.z, gx, gz)) route.push(gx, gz);
    // It starts where the car meets the road, which can be behind it after an off-road run.
    const fx = Math.cos(v.angle), fz = Math.sin(v.angle);
    let k = 0;
    for (; k < route.length - 2; k += 2) {
      const px = route[k] - v.x, pz = route[k + 1] - v.z, away = Math.hypot(px, pz);
      if (away > 8 && (away > 20 || px * fx + pz * fz > 0)) break;
    }
    d.pts = [v.x, v.z];
    for (let i = k; i < route.length; i += 2) {
      const n = d.pts.length;
      if (Math.hypot(route[i] - d.pts[n - 2], route[i + 1] - d.pts[n - 1]) >= 1) d.pts.push(route[i], route[i + 1]);
    }
    if (d.pts.length < 4) d.pts.push(v.x + fx * 5, v.z + fz * 5);
    d.limits = [];
    for (let i = 0; i < d.pts.length; i += 2) {
      const near = this.graph.nearest(d.pts[i], d.pts[i + 1], 8);
      d.limits.push(near ? Math.min(speed, this.graph.edges[near.edge].s * CHASE_LIMIT) : CORNER_SPEED * 2);
    }
    d.i = 1;
    d.deadEnd = false;
    d.reroute = REROUTE;
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
