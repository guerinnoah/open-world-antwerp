import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { uploadFirst } from '../core/instancing';
import { coloured, weightedPick, wrapAngle } from '../core/util';
import { GROUP, RAPIER, WHEELS, groups, type Owner, type Physics } from '../physics/physics';
import type { NavGraph, Step } from '../world/navGraph';
import { lengthFrom, nearestSegment, segmentDistance, trimPolyline } from '../world/polyline';
import { BIKE } from './bikeGeometry';
import type { Crowd } from './crowd';
import { extent } from './trackProbe';
import { isVelo } from './bikes';
import { block, pose, ridePose, rod, type V3 } from './twoWheelers';
import type { Vehicle } from './vehicle';

const HALF_LENGTH = 0.85;
const HALF_WIDTH = 0.3;
const MASS = 95; // kg, bike and rider
const ACCEL = 0.9; // m/s²
const BRAKE = 3.5; // m/s²
const CORNER = 3; // m/s round a right angle
const AHEAD = 40; // m of route planned ahead
const MIN_COMPONENT = 1000; // m of connected network to spawn on: islands of path stay empty
const PASS_MARGIN = 0.35; // m between a rider and what they ride round
const KNOCK = 5.5; // m/s closing speed that throws a rider off
// Not walls or posts while riding: the routes keep clear of them, and a corner clipped by the map would wedge a rider for good.
const RIDING = groups(GROUP.BIKE, WHEELS | GROUP.PED);
const FALLEN = groups(GROUP.BIKE, GROUP.STATIC | WHEELS | GROUP.PED);

const STAND_LEAN = 0.1; // rad, a bike left on its stand
const PAINTS = [0x1b1c1e, 0x1b1c1e, 0x1b1c1e, 0x2d3034, 0x1d2b45, 0x23402f, 0x5a1f24, 0xd9d2c0, 0x7fa7c9, 0x8c8f93, 0x3a5a7a, 0xa8463b];

const R = BIKE.wheelRadius;
const BB: V3 = [BIKE.bb[0], BIKE.bb[1], 0];
const REAR: V3 = [BIKE.rearX, R, 0], FRONT: V3 = [BIKE.frontX, R, 0];
const HEAD_TOP: V3 = [0.36, 0.86, 0], HEAD_BOTTOM: V3 = [0.42, 0.66, 0];
const SEAT = new THREE.Vector2(...BIKE.seatTube).normalize();
const onSeatTube = (t: number): V3 => [BB[0] + SEAT.x * t, BB[1] + SEAT.y * t, 0];
const SEAT_TOP = onSeatTube(0.5);
const SADDLE = 0.92; // m: the seat mesh's saddle height, slid up the seat tube to each rider's
const BLACK = 0x151515, DARK = 0x2a2b2e, SILVER = 0xb9bdc1;

const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const tube = (a: V3, b: V3, r: number, hex = 0xffffff) => coloured(rod(a, b, r, 6), hex);
const box = (c: V3, size: V3, hex: number, rz = 0) => coloured(block(c, size, rz), hex);
const mudguard = (start: number, arc: number) => coloured(new THREE.TorusGeometry(R + 0.03, 0.014, 3, 12, arc).scale(1, 1, 3.2).rotateZ(start), 0xffffff);

/** White, so the instance colour is the paint. `open` = step-through. */
function frameGeometry(open: boolean): THREE.BufferGeometry {
  const head = (k: number) => lerp3(HEAD_BOTTOM, HEAD_TOP, k);
  const low: V3 = [0.12, 0.38, 0];
  const main = open
    ? [tube(BB, low, 0.024), tube(low, HEAD_BOTTOM, 0.024), tube(onSeatTube(0.25), [0.16, 0.5, 0], 0.018), tube([0.16, 0.5, 0], head(0.35), 0.018)]
    : [tube(BB, HEAD_BOTTOM, 0.024), tube(SEAT_TOP, head(0.85), 0.02)];
  return mergeGeometries([
    ...main,
    tube(BB, SEAT_TOP, 0.02), tube(HEAD_BOTTOM, HEAD_TOP, 0.026),
    ...[-1, 1].flatMap((s) => [
      tube(BB, [REAR[0], REAR[1], s * 0.05], 0.011), tube(SEAT_TOP, [REAR[0], REAR[1], s * 0.05], 0.01),
      tube(HEAD_BOTTOM, [FRONT[0], FRONT[1], s * 0.055], 0.013),
    ]),
    mudguard(0.4 * Math.PI, 0.8 * Math.PI).translate(...REAR), mudguard(0.15 * Math.PI, 0.72 * Math.PI).translate(...FRONT),
  ]);
}

function trimGeometry(): THREE.BufferGeometry {
  const [gx, gy, gz] = BIKE.grip;
  const stem: V3 = [0.33, 1.0, 0];
  return mergeGeometries([
    tube(HEAD_TOP, stem, 0.014, SILVER),
    ...[-1, 1].flatMap((s) => [
      tube(stem, [0.31, 1.0, s * 0.16], 0.011, BLACK), tube([0.31, 1.0, s * 0.16], [gx + 0.03, gy - 0.005, s * (gz - 0.04)], 0.011, BLACK),
      tube([gx + 0.03, gy - 0.005, s * (gz - 0.04)], [gx - 0.03, gy + 0.005, s * (gz + 0.05)], 0.017, BLACK),
      tube([-0.84, 0.7, s * 0.08], [-0.3, 0.72, s * 0.08], 0.008, BLACK), tube([-0.8, 0.7, s * 0.08], [REAR[0], REAR[1], s * 0.06], 0.007, BLACK),
    ]),
    box([(BB[0] + REAR[0]) / 2, (BB[1] + REAR[1]) / 2 + 0.01, 0.075], [0.62, 0.09, 0.02], BLACK, Math.atan2(REAR[1] - BB[1], REAR[0] - BB[0]) + Math.PI),
    box([HEAD_TOP[0] + 0.07, 0.8, 0], [0.05, 0.05, 0.06], 0xfff4d8),
    box([-0.86, 0.69, 0], [0.03, 0.04, 0.06], 0xff2a1a),
  ]);
}

function seatGeometry(): THREE.BufferGeometry {
  const post = onSeatTube((SADDLE - 0.05 - BB[1]) / SEAT.y);
  return mergeGeometries([tube(onSeatTube(0.3), post, 0.014, SILVER), box([post[0] - 0.02, post[1] + 0.03, 0], [0.27, 0.06, 0.17], BLACK)]);
}

function wheelGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    coloured(new THREE.TorusGeometry(R - 0.022, 0.022, 4, 18), BLACK),
    coloured(new THREE.TorusGeometry(R - 0.048, 0.01, 3, 18), SILVER),
    coloured(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 6).rotateX(Math.PI / 2), DARK),
    ...[0, 1, 2].map((k) => coloured(new THREE.BoxGeometry(0.005, 2 * (R - 0.055), 0.005).rotateZ((k * Math.PI) / 3), SILVER)),
  ]);
}

/** Same layout as the Velo bike's (bikes.ts): the baked 'ride' clip's feet follow it. */
function crankGeometry(): THREE.BufferGeometry {
  const c = BIKE.crank;
  return mergeGeometries([
    coloured(new THREE.CylinderGeometry(0.09, 0.09, 0.008, 12).rotateX(Math.PI / 2).translate(0, 0, 0.05), DARK),
    box([0, c / 2, 0.075], [0.03, c, 0.012], SILVER),
    box([0, -c / 2, -0.075], [0.03, c, 0.012], SILVER),
    box([0, c, BIKE.pedalZ], [0.09, 0.025, 0.09], BLACK),
    box([0, -c, -BIKE.pedalZ], [0.09, 0.025, 0.09], BLACK),
  ]);
}

export interface Rider {
  body: RAPIER.RigidBody;
  pts: number[]; // flat [x, z, …] of the route ahead; `caps` and `i` index points
  caps: number[];
  i: number;
  last: Step;
  deadEnd: boolean;
  cruise: number;
  speed: number;
  heading: number; // Rapier angle
  roll: number;
  pedals: number; // crank turns
  spin: number;
  avatar: number;
  /** Paint (sRGB); odd = step-through frame, so a stolen bike's vehicle colour carries its look, over the network too. */
  colour: number;
  down: number; // s left lying in the road
  fall: number;
  lie: number; // m from the bike to the fallen rider, short of any wall
  stuck: number;
  wedged: number;
  bold: number; // s left pushing through whatever is in the way
  pull: number; // m off the route, + = right
  passing: { collider: RAPIER.Collider; pull: number; timer: number } | null;
  bell: number;
  prev: { x: number; z: number; angle: number };
}

export class Cyclists {
  readonly group = new THREE.Group();
  readonly riders: Rider[] = [];
  readonly bells: [number, number][] = [];
  private spawnable: Uint8Array;
  private spawnTimer = 0;
  private probe = new RAPIER.Cuboid(1, 1);
  private frames: THREE.InstancedMesh[];
  private trim: THREE.InstancedMesh;
  private seat: THREE.InstancedMesh;
  private wheels: THREE.InstancedMesh;
  private cranks: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private part = new THREE.Matrix4();
  private tint = new THREE.Color();
  private counts = [0, 0];
  private drawn = 0;
  private quat = new THREE.Quaternion();
  private fallQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  private pos = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(
    private physics: Physics,
    private graph: NavGraph,
    private crowd: Crowd,
    private target: number,
    private view: number,
  ) {
    this.group.name = 'cyclists';
    this.spawnable = this.mainNetwork();
    const capacity = target + 32; // room for bikes stolen and left standing
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25 });
    const mesh = (g: THREE.BufferGeometry, count: number) => {
      const m = new THREE.InstancedMesh(g, material, count);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      return m;
    };
    this.frames = [false, true].map((open) => {
      const m = mesh(frameGeometry(open), capacity);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      return m;
    });
    this.trim = mesh(trimGeometry(), capacity);
    this.seat = mesh(seatGeometry(), capacity);
    this.wheels = mesh(wheelGeometry(), capacity * 2);
    this.cranks = mesh(crankGeometry(), capacity);
  }

  private mainNetwork(): Uint8Array {
    const n = this.graph.nodes.length / 2;
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    for (const e of this.graph.edges) parent[find(e.a)] = find(e.b);
    const size = new Map<number, number>();
    for (const e of this.graph.edges) size.set(find(e.a), (size.get(find(e.a)) ?? 0) + e.len);
    return Uint8Array.from(this.graph.edges, (e) => ((size.get(find(e.a)) ?? 0) >= MIN_COMPONENT ? 1 : 0));
  }

  update(dt: number, px: number, pz: number, initial = false) {
    this.spawnTimer -= dt;
    if (initial || this.spawnTimer <= 0) {
      this.spawnTimer = 0.3;
      for (const r of [...this.riders]) {
        const t = r.body.translation();
        if (Math.hypot(t.x - px, t.y - pz) > this.view + 100) this.remove(r);
      }
      for (let n = initial ? this.target * 4 : 2; n > 0 && this.riders.length < this.target; n--) {
        this.spawn(px, pz, initial ? 10 : this.view * 0.7);
      }
    }
    for (const r of [...this.riders]) this.ride(r, dt);
  }

  savePrev() {
    for (const r of this.riders) {
      const t = r.body.translation();
      r.prev.x = t.x;
      r.prev.z = t.y;
      r.prev.angle = r.heading;
    }
  }

  remove(r: Rider) {
    this.physics.remove(r.body);
    this.riders.splice(this.riders.indexOf(r), 1);
  }

  /** Nearest rider within `range` m, on the bike or knocked off it. */
  nearest(x: number, z: number, range: number): Rider | null {
    let best: Rider | null = null;
    for (const r of this.riders) {
      const t = r.body.translation(), d = Math.hypot(t.x - x, t.y - z);
      if (d < range) {
        range = d;
        best = r;
      }
    }
    return best;
  }

  /** Takes the bike from its rider, who drops out of the traffic: where it is, how fast it's going, and who rode it. */
  steal(r: Rider): { x: number; z: number; heading: number; speed: number; colour: number; avatar: number } {
    const t = r.body.translation();
    const taken = { x: t.x, z: t.y, heading: r.heading, speed: r.down > 0 ? 0 : r.speed, colour: r.colour, avatar: r.avatar };
    this.remove(r);
    return taken;
  }

  /** (vx, vz) in m/s; true if it threw the rider off. */
  hit(r: Rider, x: number, z: number, vx: number, vz: number, light: boolean): boolean {
    // Our own velocity as we rode into it: the body's is already after the shove.
    const t = r.body.translation(), ox = Math.cos(r.heading) * r.speed, oz = Math.sin(r.heading) * r.speed;
    const dx = t.x - x, dz = t.y - z, d = Math.hypot(dx, dz) || 1;
    const closing = ((vx - ox) * dx + (vz - oz) * dz) / d;
    if (r.down > 0 || closing < (light ? KNOCK + 1 : KNOCK)) return false;
    this.knockDown(r, vx, vz, Math.hypot(vx, vz));
    return true;
  }

  private knockDown(r: Rider, dx: number, dz: number, speed: number) {
    if (r.down > 0) return;
    r.down = 3 + Math.random() * 1.5;
    r.fall = Math.atan2(dz, dx);
    r.speed = 0;
    r.passing = null;
    // The bike goes over away from the blow.
    r.roll = Math.sin(r.fall - r.heading) >= 0 ? 0.3 : -0.3;
    const len = Math.hypot(dx, dz) || 1, fling = Math.min(speed * 0.5, 6);
    r.body.collider(0).setCollisionGroups(FALLEN);
    r.body.setLinearDamping(3);
    r.body.setLinvel({ x: (dx / len) * fling, y: (dz / len) * fling }, true);
  }

  private lane(step: Step): { pts: number[]; cap: number } {
    const e = this.graph.edges[step.edge];
    const off = e.l ?? 0;
    // Cut back by the offset at both ends, so turns meet the next street's lane instead of overshooting the kerb.
    return { pts: trimPolyline(this.graph.lane(step, off), Math.min(off, 4), Math.min(off, 4)), cap: e.s };
  }

  private spawn(px: number, pz: number, minD: number) {
    const edges = this.graph.edges;
    const edge = this.graph.randomEdgeNear(
      px, pz, minD, this.view + 60, (i) => this.spawnable[i] === 1 && edges[i].len > 10 && Math.random() * 3 < (edges[i].q ?? 1),
    );
    if (edge < 0) return;
    const step: Step = { edge, forward: edges[edge].o ? true : Math.random() < 0.5 };
    const { pts, cap } = this.lane(step);
    if (pts.length < 4) return;
    const k = Math.floor(Math.random() * (pts.length / 2 - 1));
    const t = Math.random();
    const x = pts[k * 2] + (pts[k * 2 + 2] - pts[k * 2]) * t, z = pts[k * 2 + 1] + (pts[k * 2 + 3] - pts[k * 2 + 1]) * t;
    const angle = Math.atan2(pts[k * 2 + 3] - pts[k * 2 + 1], pts[k * 2 + 2] - pts[k * 2]);
    if (this.physics.boxOverlaps(x, z, angle, HALF_LENGTH + 0.6, HALF_WIDTH + 0.2)) return;
    for (const other of this.riders) {
      const o = other.body.translation();
      if (Math.hypot(o.x - x, o.y - z) < 8) return;
    }

    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, z).setRotation(angle).lockRotations().setLinearDamping(0.5),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(HALF_LENGTH, HALF_WIDTH)
        .setDensity(MASS / (4 * HALF_LENGTH * HALF_WIDTH))
        .setFriction(0.2)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setCollisionGroups(RIDING),
      body,
    );
    const cruise = 4.2 + Math.random() * 1.8;
    const avatar = this.crowd.pick();
    const r: Rider = {
      body, pts: [x, z], caps: [cap], i: 1, last: step, deadEnd: false, cruise, speed: Math.min(cruise, cap) * 0.8,
      heading: angle, roll: 0, pedals: Math.random(), spin: 0, avatar,
      colour: (PAINTS[Math.floor(Math.random() * PAINTS.length)] & ~1) | (Math.random() < 0.5 ? 1 : 0),
      down: 0, fall: 0, lie: 0, stuck: 0, wedged: 0, bold: 0, pull: 0, passing: null, bell: 0, prev: { x, z, angle },
    };
    this.append(r, pts.slice(k * 2 + 2), cap, step);
    body.setLinvel({ x: Math.cos(angle) * r.speed, y: Math.sin(angle) * r.speed }, true);
    this.physics.owners.set(body.collider(0).handle, { kind: 'cyclist', entity: r });
    this.riders.push(r);
  }

  private append(r: Rider, pts: number[], cap: number, step: Step) {
    for (let i = 0; i < pts.length; i += 2) {
      const n = r.pts.length;
      if (n && Math.hypot(pts[i] - r.pts[n - 2], pts[i + 1] - r.pts[n - 1]) < 0.5) continue;
      r.pts.push(pts[i], pts[i + 1]);
      r.caps.push(cap);
    }
    r.last = step;
  }

  private extend(r: Rider) {
    let ahead = lengthFrom(r.pts, r.i - 1);
    while (ahead < AHEAD && !r.deadEnd) {
      const options = this.graph.options(this.graph.endNode(r.last), r.last.edge);
      if (!options.length) {
        r.deadEnd = true;
        break;
      }
      const n = r.pts.length;
      const hx = n >= 4 ? r.pts[n - 2] - r.pts[n - 4] : Math.cos(r.heading), hz = n >= 4 ? r.pts[n - 1] - r.pts[n - 3] : Math.sin(r.heading);
      const weights = options.map((s) => {
        const e = this.graph.edges[s.edge], p = e.p, m = p.length;
        const [dx, dz] = s.forward ? [p[2] - p[0], p[3] - p[1]] : [p[m - 4] - p[m - 2], p[m - 3] - p[m - 1]];
        const cos = (hx * dx + hz * dz) / ((Math.hypot(hx, hz) || 1) * (Math.hypot(dx, dz) || 1));
        return (e.q ?? 1) * (1 + Math.max(cos, 0) * 2) * (s.edge === r.last.edge ? 0.05 : 1);
      });
      const before = r.pts.length / 2 - 1;
      const next = weightedPick(options, weights);
      const { pts, cap } = this.lane(next);
      this.append(r, pts, cap, next);
      ahead += lengthFrom(r.pts, before);
    }
    if (r.i > 16) {
      const drop = r.i - 2;
      r.pts.splice(0, drop * 2);
      r.caps.splice(0, drop);
      r.i -= drop;
    }
  }

  private ride(r: Rider, dt: number) {
    const t = r.body.translation(), v = r.body.linvel();
    const x = t.x, z = t.y;
    if (r.down > 0) {
      r.down -= dt;
      r.roll += ((Math.sign(r.roll) || 1) * 1.45 - r.roll) * Math.min(1, 8 * dt);
      r.lie = Math.max(0, (this.physics.castSolid(x, z, Math.cos(r.fall), Math.sin(r.fall), 1.3)?.dist ?? 1.3) - 0.4);
      if (r.down <= 0) {
        r.body.collider(0).setCollisionGroups(RIDING);
        r.body.setLinearDamping(0.5);
        r.roll = 0;
        this.rejoin(r);
      }
      return;
    }
    this.extend(r);
    let n = r.pts.length / 2;
    if (n < 2 || (r.deadEnd && r.i >= n - 1)) {
      this.remove(r);
      return;
    }
    if (segmentDistance(r.pts, r.i - 1, x, z) > 8) {
      if (!this.rejoin(r)) return;
      this.extend(r);
      n = r.pts.length / 2;
      if (n < 2) {
        this.remove(r);
        return;
      }
    }
    const fx = Math.cos(r.heading), fz = Math.sin(r.heading);
    const forward = v.x * fx + v.y * fz;
    // Something solid stopped us: carry on from the speed we really have.
    if (forward < r.speed - 1) r.speed = Math.max(0, forward + 0.5);

    const look = 1.5 + r.speed * 0.45;
    while (r.i < n - 1 && Math.hypot(r.pts[r.i * 2] - x, r.pts[r.i * 2 + 1] - z) < look) r.i++;

    if (r.passing) {
      const p = r.passing;
      p.timer -= dt;
      const c = p.collider.isValid() ? p.collider.translation() : null;
      if (!c || p.timer <= 0 || (c.x - x) * fx + (c.y - z) * fz < -(extent(p.collider, fx, fz) + HALF_LENGTH + 1)) r.passing = null;
    }
    r.pull += ((r.passing?.pull ?? 0) - r.pull) * Math.min(1, 2.5 * dt);
    let dx = r.pts[r.i * 2] - x, dz = r.pts[r.i * 2 + 1] - z;
    if (Math.abs(r.pull) > 0.05) {
      const ux = r.pts[r.i * 2] - r.pts[r.i * 2 - 2], uz = r.pts[r.i * 2 + 1] - r.pts[r.i * 2 - 1];
      const len = Math.hypot(ux, uz) || 1;
      dx -= (uz / len) * r.pull;
      dz += (ux / len) * r.pull;
    }
    const err = wrapAngle(Math.atan2(dz, dx) - r.heading);

    let target = Math.min(r.cruise, r.caps[r.i]);
    let dist = Math.hypot(dx, dz);
    for (let j = r.i; j < n - 1 && dist < 25; j++) {
      const ax = r.pts[j * 2] - r.pts[j * 2 - 2], az = r.pts[j * 2 + 1] - r.pts[j * 2 - 1];
      const bx = r.pts[j * 2 + 2] - r.pts[j * 2], bz = r.pts[j * 2 + 3] - r.pts[j * 2 + 1];
      const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      if (turn > 0.35) {
        const corner = r.cruise + (CORNER - r.cruise) * Math.min(turn / 1.6, 1);
        target = Math.min(target, Math.sqrt(corner * corner + 2 * BRAKE * 0.6 * Math.max(dist - 2, 0)));
      }
      dist += Math.hypot(bx, bz);
    }
    if (Math.abs(err) > 0.9) target = Math.min(target, 2);
    if (r.deadEnd) target = Math.min(target, Math.sqrt(2 * BRAKE * 0.5 * lengthFrom(r.pts, r.i - 1)));

    r.bell -= dt;
    if (r.bold <= 0) {
      const gap = this.lookAhead(r, x, z, fx, fz);
      if (gap < Infinity) target = Math.min(target, Math.max(0, (gap - 0.8) * 1.2));
    }
    r.bold -= dt;
    r.stuck = target < 0.3 && r.speed < 0.3 ? r.stuck + dt : 0;
    if (r.stuck > 4) {
      r.bold = 2;
      r.stuck = 0;
    }
    r.wedged = target > 1 && forward < 0.3 ? r.wedged + dt : Math.max(0, r.wedged - dt);
    if (r.wedged > 6) {
      this.remove(r);
      return;
    }
    if (r.bold > 0) target = Math.max(target, 1.2);

    const was = r.speed;
    r.speed = target > r.speed ? Math.min(target, r.speed + ACCEL * dt) : Math.max(target, r.speed - BRAKE * dt);
    if (r.speed >= was - 0.01 && r.speed > 0.3) r.pedals += (r.speed * dt) / BIKE.development;
    r.spin += (r.speed * dt) / R;

    // No tighter than a ~2 m radius, so it leans into bends rather than pivoting.
    const maxTurn = (r.speed + 0.6) / 2.2;
    const yaw = Math.max(-maxTurn, Math.min(maxTurn, err * 3.5));
    r.heading = wrapAngle(r.heading + yaw * dt);
    const lean = Math.max(-0.45, Math.min(0.45, Math.atan((r.speed * yaw) / 9.81)));
    r.roll += (lean - r.roll) * Math.min(1, 5 * dt);
    r.body.setRotation(r.heading, true);
    const k = Math.min(1, 12 * dt);
    const wx = Math.cos(r.heading) * r.speed, wz = Math.sin(r.heading) * r.speed;
    r.body.setLinvel({ x: v.x + (wx - v.x) * k, y: v.y + (wz - v.y) * k }, true);
  }

  /** Gap ahead (m); may also start a pass round what's there. */
  private lookAhead(r: Rider, x: number, z: number, fx: number, fz: number): number {
    const len = 2.5 + r.speed * 1.2;
    const near: { gap: number; hit: RAPIER.Collider | null } = { gap: Infinity, hit: null };
    this.probe.halfExtents = { x: len / 2, y: 0.4 };
    this.physics.world.intersectionsWithShape(
      { x: x + fx * (HALF_LENGTH + len / 2), y: z + fz * (HALF_LENGTH + len / 2) },
      r.heading,
      this.probe,
      (collider) => {
        if (collider === r.passing?.collider) return true;
        const p = collider.translation();
        const along = (p.x - x) * fx + (p.y - z) * fz;
        // Alongside isn't in the way: two riders side by side would otherwise each wait for the other.
        if (along < 0.4) return true;
        const g = along - HALF_LENGTH - extent(collider, fx, fz);
        if (g < near.gap) {
          near.gap = g;
          near.hit = collider;
        }
        return true;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      r.body,
    );
    const { gap, hit } = near;
    if (!hit) return gap;
    const owner = this.physics.owners.get(hit.handle);
    if ((owner?.kind === 'ped' || owner?.kind === 'player') && gap < 6 && r.bell <= 0) {
      this.bells.push([x, z]);
      r.bell = 5 + Math.random() * 4;
    }
    if (!r.passing && gap < 4 + r.speed && this.passable(r, owner)) this.startPass(r, hit, x, z, fx, fz, gap);
    return gap;
  }

  private passable(r: Rider, owner: Owner | undefined): boolean {
    if (!owner) return false;
    if (owner.kind === 'ped' || owner.kind === 'player') return true;
    if (owner.kind === 'cyclist') {
      const o = owner.entity as Rider;
      return o.down > 0 || o.speed < r.cruise - 1;
    }
    // Parked cars, and traffic that has stood still a while; never one pulling away.
    if (owner.kind === 'vehicle') {
      const v = owner.entity as Vehicle;
      return !v.remote && Math.abs(v.forwardSpeed) < (v.driven ? (r.stuck > 2 ? 0.3 : -1) : 0.5);
    }
    return false;
  }

  private startPass(r: Rider, hit: RAPIER.Collider, x: number, z: number, fx: number, fz: number, gap: number) {
    const c = hit.translation();
    const across = -(c.x - x) * fz + (c.y - z) * fx;
    const reach = extent(hit, -fz, fx) + HALF_WIDTH + PASS_MARGIN;
    const left = across - reach, right = across + reach;
    const v = hit.parent()?.linvel();
    const oncoming = !!v && v.x * fx + v.y * fz < -0.5;
    // Overtake on the left, as traffic does, and keep right of whatever comes the other way; else the shorter way round.
    const rightFirst = oncoming || Math.abs(right) * 1.6 < Math.abs(left);
    for (const pull of rightFirst ? [right, left] : [left, right]) {
      if (Math.abs(pull) > 2.6) continue;
      const len = gap + 2 * extent(hit, fx, fz) + HALF_LENGTH + 2;
      this.probe.halfExtents = { x: len / 2, y: HALF_WIDTH + 0.15 };
      let clear = true;
      this.physics.world.intersectionsWithShape(
        { x: x + fx * (len / 2) - fz * pull, y: z + fz * (len / 2) + fx * pull },
        r.heading,
        this.probe,
        (other) => (clear = other === hit),
        RAPIER.QueryFilterFlags.EXCLUDE_FIXED | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        undefined,
        undefined,
        r.body,
      );
      if (clear) {
        r.passing = { collider: hit, pull, timer: 8 };
        return;
      }
    }
  }

  /** False if there's no route near enough and the rider is gone. */
  private rejoin(r: Rider): boolean {
    const t = r.body.translation();
    const near = this.graph.nearest(t.x, t.y, 30);
    if (!near) {
      this.remove(r);
      return false;
    }
    const e = this.graph.edges[near.edge];
    const v = Math.min(near.vertex, e.p.length / 2 - 2);
    const ahead = (e.p[v * 2 + 2] - e.p[v * 2]) * Math.cos(r.heading) + (e.p[v * 2 + 3] - e.p[v * 2 + 1]) * Math.sin(r.heading);
    const step: Step = { edge: near.edge, forward: e.o ? true : ahead >= 0 };
    const { pts, cap } = this.lane(step);
    const { k } = nearestSegment(pts, t.x, t.y);
    r.pts = [t.x, t.y];
    r.caps = [cap];
    r.i = 1;
    r.deadEnd = false;
    r.passing = null;
    this.append(r, pts.slice(Math.min(k + 1, pts.length / 2 - 1) * 2), cap, step);
    return true;
  }

  /** Riders, and the private bikes that are vehicles now: stolen and left standing, or ridden by the player or another player. */
  render(alpha: number, camera: THREE.Vector3, vehicles: Vehicle[], riding: Vehicle | null, avatar: number) {
    this.drawn = this.counts[0] = this.counts[1] = 0;
    for (const r of this.riders) {
      const t = r.body.translation();
      const x = r.prev.x + (t.x - r.prev.x) * alpha, z = r.prev.z + (t.y - r.prev.z) * alpha;
      const distance = Math.hypot(x - camera.x, z - camera.z);
      if (distance > this.view) continue;
      const heading = r.prev.angle + wrapAngle(r.heading - r.prev.angle) * alpha;
      const m = pose(this.matrix, x, Math.abs(Math.sin(r.roll)) * HALF_WIDTH * (r.down > 0 ? 1 : 0), z, heading, r.roll);
      if (!this.draw(m, r.colour, this.crowd.saddle(r.avatar), r.spin, r.pedals)) break;
      if (r.down > 0) {
        this.quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -r.fall).multiply(this.fallQuat);
        this.matrix.compose(this.pos.set(x + Math.cos(r.fall) * r.lie, 0.2, z + Math.sin(r.fall) * r.lie), this.quat, this.one);
        this.crowd.add(r.avatar, this.matrix, 'idle', 0, distance);
      } else this.crowd.add(r.avatar, m, 'ride', r.pedals, distance);
    }
    for (const v of vehicles) {
      if (v.spec.name !== 'bike' || isVelo(v)) continue;
      if (Math.hypot(v.x - camera.x, v.z - camera.z) > this.view) continue;
      const m = ridePose(this.matrix, v, alpha, v === riding || v.remote ? v.roll : STAND_LEAN);
      if (!this.draw(m, v.colour, v === riding ? this.crowd.saddle(avatar) : SADDLE, v.wheelSpin, v.pedals)) break;
      // Another player's rider comes with their avatar (net/multiplayer.ts).
      if (v === riding) this.crowd.add(avatar, m, 'ride', v.pedals, Math.hypot(v.x - camera.x, v.z - camera.z));
    }
    for (const [k, frame] of this.frames.entries()) {
      frame.count = this.counts[k];
      uploadFirst(frame.instanceMatrix, this.counts[k]);
      uploadFirst(frame.instanceColor, this.counts[k]);
    }
    const n = this.drawn;
    for (const [mesh, count] of [[this.trim, n], [this.seat, n], [this.wheels, n * 2], [this.cranks, n]] as const) {
      mesh.count = count;
      uploadFirst(mesh.instanceMatrix, count);
    }
  }

  /** One bike at `m`; false when there's no room left. */
  private draw(m: THREE.Matrix4, colour: number, saddle: number, spin: number, pedals: number): boolean {
    const n = this.drawn;
    if (n >= this.trim.instanceMatrix.count) return false;
    const open = colour & 1;
    const f = this.counts[open]++;
    this.frames[open].setMatrixAt(f, m);
    this.frames[open].setColorAt(f, this.tint.setHex(colour & ~1));
    this.trim.setMatrixAt(n, m);
    const rise = (saddle - SADDLE) / SEAT.y;
    this.seat.setMatrixAt(n, this.part.multiplyMatrices(m, this.local.makeTranslation(SEAT.x * rise, SEAT.y * rise, 0)));
    this.local.makeRotationZ(-spin).setPosition(REAR[0], REAR[1], 0);
    this.wheels.setMatrixAt(n * 2, this.part.multiplyMatrices(m, this.local));
    this.local.setPosition(FRONT[0], FRONT[1], 0);
    this.wheels.setMatrixAt(n * 2 + 1, this.part.multiplyMatrices(m, this.local));
    this.local.makeRotationZ(-pedals * Math.PI * 2).setPosition(BB[0], BB[1], 0);
    this.cranks.setMatrixAt(n, this.part.multiplyMatrices(m, this.local));
    this.drawn++;
    return true;
  }
}
