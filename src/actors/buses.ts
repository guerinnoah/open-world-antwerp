import * as THREE from 'three';
import { lerpPose, type Pose } from '../core/util';
import type { Physics } from '../physics/physics';
import type { BusRun, LineSchedule } from '../world/cityData';
import type { Clock } from '../world/daylight';
import { cumulative, pointAt } from '../world/polyline';
import { AXLES, BUS_WIDTH as WIDTH, KINDS, LAYOUTS, SECTION_LENGTH, buildBus, type BusKind } from './busModel';
import type { TrafficHost } from './traffic';
import {
  Scheduler, SectionMeshes, addSections, moveSections, noseDistance, obstacleAhead, occupied, outlineDistance, removeSectioned, savePrev, serveStops,
  spawnPoint, stack, stopAfter, type Run, type Sectioned,
} from './transit';
import { ARTIC_SPEC, BUS_SPEC, Vehicle } from './vehicle';

const MAX_SPEED = 11;
const ACCEL = 1.3;
const BRAKE = 1.8;
const LATERAL = 2; // m/s²; ~12 km/h round a right angle
const SPAWN_MIN = 160;
const SPAWN_MAX = 420;
const DESPAWN = 550;
const PATIENCE = 6;
const HONK_AFTER = 1.2;
const OUT_OF_SIGHT = 150;
const LAYOVER = 40;
const LAYOVER_NEAR = 60;
const ARTICULATED = 0.35;
const OUT_OF_SERVICE = 6;

export interface Bus extends Sectioned {
  id: number;
  run: Run<BusRun>;
  blocked: number;
  waitingFor?: Bus;
  honkCooldown: number;
  layover: number;
  layout: BusKind[];
}

export class Buses {
  readonly buses: Bus[] = [];
  readonly honks: [number, number][] = [];
  readonly group = new THREE.Group();
  private runs: Run<BusRun>[];
  private spawnRuns: Run<BusRun>[];
  private vehicles: Vehicle[] = []; // out of service; colour = display row
  private spawnTimer = 0;
  private nextId = 0;
  private meshes: SectionMeshes<BusKind>;

  constructor(
    private physics: Physics,
    runs: BusRun[],
    private target: number,
    private host: TrafficHost,
    schedules: Record<string, LineSchedule> | undefined,
    clock: Clock,
  ) {
    this.runs = runs.map((r) => ({ ...r, cum: cumulative(r.p) }));
    this.meshes = new SectionMeshes(this.group, runs, KINDS, buildBus, () => target + OUT_OF_SERVICE);
    const scheduler = new Scheduler(schedules, clock, runs.map((r) => r.line));
    this.spawnRuns = this.runs.filter((r) => scheduler.active(r.line));
    this.target = scheduler.fleet(target);
  }

  update(dt: number, px: number, pz: number) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1;
      for (const b of [...this.buses]) {
        const d = noseDistance(b, px, pz);
        const done = b.run.end ? b.layover > 0 && d > (b.layover > LAYOVER ? LAYOVER_NEAR : OUT_OF_SIGHT) : b.s >= b.run.len;
        if (done || d > DESPAWN) this.remove(b);
      }
      if (this.buses.length < this.target) this.spawn(px, pz);
    }
    for (const b of this.buses) this.drive(b, dt);
  }

  savePrev() {
    savePrev(this.buses);
  }

  private spawn(px: number, pz: number) {
    const at = spawnPoint(this.spawnRuns, px, pz, SPAWN_MIN, SPAWN_MAX, 30, 40);
    if (!at) return;
    const [run, s] = at;
    const layout = LAYOUTS[Math.random() < ARTICULATED ? 1 : 0];
    const { offsets, length } = stack(layout, SECTION_LENGTH);
    if (s < length + 1) return;
    const bus: Bus = {
      id: this.nextId++, run, s, speed: MAX_SPEED * 0.5, nextStop: stopAfter(run, s), dwell: 0, blocked: 0, honkCooldown: 0,
      layover: 0, layout, offsets, length, row: this.meshes.row(run), sections: [], prev: [],
    };
    const poses = this.poses(bus);
    if (poses.some((pose, i) => occupied(this.physics, pose, SECTION_LENGTH[layout[i]] / 2 + 1, WIDTH / 2))) return;
    addSections(this.physics, bus, 'bus', poses, layout.map((kind) => SECTION_LENGTH[kind] / 2), WIDTH / 2);
    this.buses.push(bus);
  }

  private remove(b: Bus) {
    removeSectioned(this.physics, this.buses, b);
  }

  near(x: number, z: number, range: number): { bus: Bus; distance: number } | null {
    let best: Bus | null = null;
    let distance = range;
    for (const b of this.buses) {
      b.sections.forEach((body, i) => {
        const d = outlineDistance(body, SECTION_LENGTH[b.layout[i]] / 2, WIDTH / 2, x, z);
        if (d < distance) {
          distance = d;
          best = b;
        }
      });
    }
    return best ? { bus: best, distance } : null;
  }

  hijack(b: Bus): Vehicle {
    const lead = b.sections[0], at = lead.translation(), angle = lead.rotation();
    const v = new Vehicle(this.physics.world, b.layout.length > 1 ? ARTIC_SPEC : BUS_SPEC, b.row, at.x, at.y, angle);
    if (v.trailer) v.placeTrailer(b.sections[1].rotation());
    this.remove(b);
    for (const body of v.trailer ? [v.body, v.trailer.body] : [v.body]) {
      const a = body.rotation();
      body.setLinvel({ x: Math.cos(a) * b.speed, y: Math.sin(a) * b.speed }, true);
    }
    const parked = this.vehicles.filter((o) => !o.driven);
    if (parked.length >= OUT_OF_SERVICE - 1) this.host.removeVehicle(parked[0]);
    this.host.addVehicle(v);
    return v;
  }

  adopt(v: Vehicle) {
    if (!this.vehicles.includes(v)) this.vehicles.push(v);
  }

  forget(v: Vehicle) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }

  private poses(b: Bus): Pose[] {
    const poses: Pose[] = [];
    b.layout.forEach((kind, i) => {
      const len = SECTION_LENGTH[kind], [front, rear] = AXLES[kind];
      const mid = b.s - b.offsets[i];
      const r = pointAt(b.run.p, b.run.cum, mid - len / 2 + rear);
      let f: { x: number; z: number };
      if (kind === 'trailer') {
        const ahead = poses[i - 1], hitch = SECTION_LENGTH[b.layout[i - 1]] / 2;
        f = { x: ahead.x - Math.cos(ahead.angle) * hitch, z: ahead.z - Math.sin(ahead.angle) * hitch };
      } else f = pointAt(b.run.p, b.run.cum, mid + len / 2 - front);
      const angle = Math.atan2(f.z - r.z, f.x - r.x);
      const back = len / 2 - front;
      poses.push({ x: f.x - Math.cos(angle) * back, z: f.z - Math.sin(angle) * back, angle });
    });
    return poses;
  }

  private drive(b: Bus, dt: number) {
    let target = serveStops(b, Math.min(MAX_SPEED, this.cornerSpeed(b)), BRAKE, dt, () => 4 + Math.random() * 4);
    if (b.run.end) {
      const ahead = b.run.len - 1 - b.s;
      target = Math.min(target, Math.sqrt(2 * BRAKE * Math.max(ahead, 0)));
      if (ahead < 40 && b.speed < 0.5) b.layover += dt;
    }

    const { gap, owner, solid } = obstacleAhead(this.physics, b, b.s, 1, 3 + (b.speed * b.speed) / (2 * BRAKE) + 2, WIDTH / 2, 0.2);
    b.waitingFor = owner?.kind === 'bus' ? (owner.entity as Bus) : undefined;
    if (gap < Infinity) {
      // impatient: nudge cars and people; transit only in a bus deadlock (lower id goes)
      const transit = owner?.kind === 'bus' || owner?.kind === 'tram';
      const pushy = !transit || (b.waitingFor?.waitingFor === b && b.id < b.waitingFor.id);
      target = Math.min(target, b.blocked < PATIENCE || !pushy ? Math.max(0, (gap - 1.5) * 0.7) : 2);
      if (b.speed < 0.5) b.blocked += dt;
      if (b.blocked > HONK_AFTER && b.honkCooldown <= 0 && !transit) {
        const p = b.sections[0].translation();
        this.honks.push([p.x, p.y]);
        b.honkCooldown = 3 + Math.random() * 2;
      }
    } else b.blocked = 0;
    b.honkCooldown -= dt;

    b.speed += Math.max(-BRAKE * 1.5 * dt, Math.min(ACCEL * dt, target - b.speed));
    let move = b.speed * dt;
    if (solid && move > gap - 0.1) {
      move = Math.max(0, gap - 0.1);
      b.speed = 0;
    }
    b.s += move;
    moveSections(b, this.poses(b));
  }

  private cornerSpeed(b: Bus): number {
    let limit = Infinity;
    const reach = (b.speed * b.speed) / (2 * BRAKE) + 12;
    for (let d = 0; d <= reach; d += 4) {
      const a = pointAt(b.run.p, b.run.cum, b.s + d), c = pointAt(b.run.p, b.run.cum, b.s + d + 8);
      const turn = Math.abs(Math.atan2(a.dx * c.dz - a.dz * c.dx, a.dx * c.dx + a.dz * c.dz));
      if (turn < 0.05) continue;
      const corner = LATERAL * (8 / turn);
      limit = Math.min(limit, Math.sqrt(corner + 2 * BRAKE * d));
    }
    return limit;
  }

  render(alpha: number) {
    for (const b of this.buses) {
      b.sections.forEach((body, i) => {
        const p = body.translation();
        this.meshes.add(b.layout[i], lerpPose(b.prev[i], p.x, p.y, body.rotation(), alpha), 0, b.row);
      });
    }
    for (const v of this.vehicles) {
      this.meshes.add(v.trailer ? 'lead' : 'solo', lerpPose(v.prev, v.x, v.z, v.angle, alpha), -v.sink, v.colour);
      if (v.trailer) this.meshes.add('trailer', lerpPose(v.trailer.prev, v.trailer.x, v.trailer.z, v.trailer.angle, alpha), -v.sink, v.colour);
    }
    this.meshes.finish();
  }
}
