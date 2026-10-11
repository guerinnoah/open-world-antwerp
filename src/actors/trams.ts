import * as THREE from 'three';
import { lerpPose, type Pose } from '../core/util';
import type { Physics } from '../physics/physics';
import type { TramRun } from '../world/cityData';
import { cumulative, pointAt } from '../world/polyline';
import { LAYOUTS, SECTION_LENGTH, TRAM_WIDTH as WIDTH, buildSection, type SectionKind } from './tramModel';
import {
  COLLIDES, SectionMeshes, addSections, moveSections, noseDistance, obstacleAhead, occupied, outlineDistance, removeSectioned, savePrev,
  serveStops, spawnPoint, stack, stopAfter, type Obstacle, type Run, type Sectioned,
} from './transit';

const MAX_SPEED = 11;
const ACCEL = 1.1;
const BRAKE = 1.6;
const DWELL = 7;
const SPAWN_MIN = 180;
const SPAWN_MAX = 450;
const DESPAWN = 600;
const OUT_OF_SIGHT = 150;
const LAYOVER = 40;
const PATIENCE = 4;
const PINNED = 0.3; // m a car or person may be pushed into the tram before it counts as pinned
const GIVE_UP = 20;
const NEARBY = 60;
const KINDS: SectionKind[] = ['cab', 'mid', 'rear'];

// Driven by the player (m/s, m/s²): an Albatros tops out at 85 km/h; steel on steel coasts a long way.
const HAND_MAX = 23.5;
const HAND_ACCEL = 2.8;
const HAND_REVERSE = 4;
const SERVICE_BRAKE = 3.2;
const EMERGENCY_BRAKE = 6; // the magnetic track brake
const COAST = 0.25;
const HANDOVER = 3;

interface TramControls {
  throttle: number;
  brake: boolean;
}

export interface Tram extends Sectioned {
  speed: number;
  blocked: number;
  hold: number;
  controls: TramControls | null;
  impact: number;
  stuck: number;
  waitingFor: Tram | null;
  layover: number;
  layout: SectionKind[];
}

export class Trams {
  readonly trams: Tram[] = [];
  readonly bells: [number, number][] = []; // where a tram rang its bell this step; drained by the game
  readonly group = new THREE.Group();
  private runs: Run[];
  private spawnTimer = 0;
  private meshes: SectionMeshes<SectionKind>;

  constructor(
    private physics: Physics,
    runs: TramRun[],
    private target: number,
  ) {
    this.runs = runs.map((r) => ({ ...r, cum: cumulative(r.p) }));
    this.meshes = new SectionMeshes(this.group, runs, KINDS, buildSection, (kind) => target * (kind === 'mid' ? 5 : 1));
  }

  update(dt: number, px: number, pz: number) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1;
      for (const t of [...this.trams]) {
        if (t.controls || !this.trams.includes(t)) continue;
        const d = noseDistance(t, px, pz);
        // Two trams waiting on each other (nose to nose on single track) don't wait GIVE_UP: the farther one goes.
        const other = t.waitingFor?.waitingFor === t && t.stuck > 8 && !t.waitingFor.controls ? t.waitingFor : null;
        // At the end of the track it lays over until out of sight, like a bus at its terminus.
        const done = t.layover > 0 && d > (t.layover > LAYOVER ? NEARBY : OUT_OF_SIGHT);
        if (other && noseDistance(other, px, pz) > d) this.remove(other);
        else if (done || d > DESPAWN || (t.stuck > GIVE_UP && d > NEARBY) || other) this.remove(t);
      }
      if (this.trams.length < this.target) this.spawn(px, pz);
    }
    for (const t of this.trams) this.drive(t, dt);
  }

  savePrev() {
    savePrev(this.trams);
  }

  private spawn(px: number, pz: number) {
    const at = spawnPoint(this.runs, px, pz, SPAWN_MIN, SPAWN_MAX, 45, 60);
    if (!at) return;
    const [run, s] = at;
    if (this.trams.some((t) => t.run.p === run.p && Math.abs(t.s - s) < 80)) return;

    const layout = LAYOUTS[Math.random() < 0.55 ? 0 : 1]; // Antwerp runs both lengths, about as many long as short
    const { offsets, length } = stack(layout, SECTION_LENGTH);
    if (s < length + 1) return;
    const tram: Tram = {
      run, s, speed: MAX_SPEED * 0.6, nextStop: stopAfter(run, s), dwell: 0, blocked: 0, hold: 0,
      controls: null, impact: 0, stuck: 0, waitingFor: null, layover: 0, layout, offsets, length, row: this.meshes.row(run), sections: [], prev: [],
    };
    const poses = this.poses(tram);
    if (poses.some((pose, i) => occupied(this.physics, pose, SECTION_LENGTH[layout[i]] / 2 + 1, WIDTH / 2 + 0.2, COLLIDES))) return;
    // Collision events, so the game hears the player's tram ploughing into cars.
    addSections(this.physics, tram, 'tram', poses, layout.map((kind) => SECTION_LENGTH[kind] / 2), WIDTH / 2, true);
    this.trams.push(tram);
  }

  remove(t: Tram) {
    removeSectioned(this.physics, this.trams, t);
    // Its partner in a deadlock would otherwise pick it again in the same despawn tick.
    for (const o of this.trams) if (o.waitingFor === t) o.waitingFor = null;
    t.waitingFor = null;
  }

  near(x: number, z: number, range: number): { tram: Tram; distance: number } | null {
    let best: Tram | null = null;
    let distance = range;
    for (const t of this.trams) {
      t.sections.forEach((body, i) => {
        const p = body.translation();
        if (Math.abs(p.x - x) > 10 || Math.abs(p.y - z) > 10) return;
        const d = outlineDistance(body, SECTION_LENGTH[t.layout[i]] / 2, WIDTH / 2, x, z);
        if (d < distance) {
          distance = d;
          best = t;
        }
      });
    }
    return best ? { tram: best, distance } : null;
  }

  board(t: Tram) {
    t.controls = { throttle: 0, brake: false };
    t.dwell = t.blocked = t.hold = t.impact = t.stuck = t.layover = 0;
    t.waitingFor = null;
  }

  leave(t: Tram) {
    t.controls = null;
    t.speed = t.impact = t.dwell = t.blocked = 0;
    t.hold = HANDOVER;
    t.nextStop = stopAfter(t.run, t.s);
  }

  pose(t: Tram, i: number, alpha: number): Pose {
    const body = t.sections[i], p = body.translation();
    return lerpPose(t.prev[i], p.x, p.y, body.rotation(), alpha);
  }

  private poses(t: Tram): Pose[] {
    return t.layout.map((kind, i) => {
      const mid = t.s - t.offsets[i], half = SECTION_LENGTH[kind] / 2;
      const a = pointAt(t.run.p, t.run.cum, mid + half - 0.6);
      const b = pointAt(t.run.p, t.run.cum, mid - half + 0.6);
      return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, angle: Math.atan2(a.z - b.z, a.x - b.x) };
    });
  }

  private drive(t: Tram, dt: number) {
    t.impact = 0;
    if (t.controls) {
      this.driveByHand(t, t.controls, dt);
      return;
    }
    let target = MAX_SPEED;

    if (t.hold > 0) {
      t.hold -= dt;
      target = 0;
      if (t.hold <= 0) this.ring(t);
    }

    const dwelling = t.dwell > 0;
    target = serveStops(t, target, BRAKE, dt, () => DWELL);
    if (dwelling && t.dwell <= 0) this.ring(t);
    const end = t.run.len - t.s;
    target = Math.min(target, Math.sqrt(2 * BRAKE * Math.max(end, 0)));
    if (end < 40 && t.speed < 0.5) t.layover += dt;

    const ahead = this.obstacle(t, 1, 3 + (t.speed * t.speed) / (2 * BRAKE) + 2);
    const shove = !ahead.solid && t.blocked >= PATIENCE;
    if (ahead.gap < Infinity) {
      target = Math.min(target, shove ? 2.5 : Math.max(0, (ahead.gap - 1.5) * 0.7));
      const before = t.blocked;
      if (t.speed < 0.5) t.blocked += dt;
      const ding = (before === 0 && t.blocked > 0) || Math.floor(t.blocked / 2.5) > Math.floor(before / 2.5);
      if (ding && !ahead.solid) this.ring(t);
    } else t.blocked = 0;
    t.waitingFor = ahead.owner?.kind === 'tram' ? (ahead.owner.entity as Tram) : null;
    t.stuck = ahead.gap < 1.5 && t.speed < 0.5 && (ahead.solid || ahead.gap < -PINNED + 0.05) ? t.stuck + dt : 0;

    t.speed += Math.max(-BRAKE * 1.5 * dt, Math.min(ACCEL * dt, target - t.speed));
    t.s = Math.min(Math.max(t.s + this.advance(t, ahead, t.speed * dt, dt), t.length), t.run.len);
    moveSections(t, this.poses(t));
  }

  private advance(t: Tram, ahead: Obstacle, move: number, dt: number): number {
    const speed = Math.abs(move) / dt;
    if (speed > 0.1) {
      // Shunt touching cars along and aside: their handbrake and tyres would hold them on the rails against a push.
      for (const { body, dx, dz, side } of ahead.touching) {
        const v = body.linvel();
        const nx = -dz * side, nz = dx * side;
        const along = Math.max(v.x * dx + v.y * dz, speed + 0.3);
        const aside = Math.max(v.x * nx + v.y * nz, 1.5 + speed * 0.35);
        body.setLinvel({ x: dx * along + nx * aside, y: dz * along + nz * aside }, true);
      }
    }
    const limit = ahead.solid ? ahead.gap - 0.1 : ahead.gap + PINNED;
    if (Math.abs(move) <= limit) return move;
    t.impact = Math.max(t.impact, Math.abs(t.speed));
    t.speed = 0;
    return Math.sign(move) * Math.max(0, limit);
  }

  private driveByHand(t: Tram, { throttle, brake }: TramControls, dt: number) {
    const v = t.speed;
    let a: number;
    if (brake) a = -Math.sign(v) * Math.min(Math.abs(v) / dt, EMERGENCY_BRAKE);
    else if (throttle > 0.05) a = v < -0.1 ? SERVICE_BRAKE * throttle : HAND_ACCEL * throttle * Math.max(0, 1 - (v / HAND_MAX) ** 2);
    else if (throttle < -0.05) {
      a = v > 0.1 ? -SERVICE_BRAKE * -throttle : -HAND_ACCEL * 0.5 * -throttle * Math.max(0, 1 + v / HAND_REVERSE);
    } else a = -Math.sign(v) * Math.min(Math.abs(v) / dt, COAST);
    t.speed += a * dt;

    const dir = t.speed < 0 ? -1 : 1;
    const s = t.s + this.advance(t, this.obstacle(t, dir, Math.abs(t.speed) * dt + 1), t.speed * dt, dt);
    const end = Math.max(t.length, Math.min(t.run.len, s));
    if (end !== s) {
      t.impact = Math.max(t.impact, Math.abs(t.speed));
      t.speed = 0;
    }
    t.s = end;
    moveSections(t, this.poses(t));
  }

  private ring(t: Tram) {
    const p = t.sections[0].translation();
    this.bells.push([p.x, p.y]);
  }

  private obstacle(t: Tram, dir: 1 | -1, look: number): Obstacle {
    return obstacleAhead(this.physics, t, dir > 0 ? t.s : t.s - t.length, dir, look, WIDTH / 2, 0.4);
  }

  render(alpha: number) {
    for (const t of this.trams) t.sections.forEach((_, i) => this.meshes.add(t.layout[i], this.pose(t, i, alpha), 0, t.row));
    this.meshes.finish();
  }
}
