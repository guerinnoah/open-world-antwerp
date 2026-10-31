import * as THREE from 'three';
import { wrapAngle } from '../core/util';
import type { RAPIER } from '../physics/physics';
import { clipForSpeed, phaseStep, type Crowd } from './crowd';
import { personBody } from './pedestrians';
import { isMotorbike, twoWheeled, type Vehicle } from './vehicle';

const RUN = 4.2; // m/s ≈ 15 km/h; SPRINT ≈ 25 km/h
const SPRINT = 7;
const SPRINT_SECONDS = 6; // s of sprint on full stamina
const RECOVER_SECONDS = 12;
const RECOVER_THRESHOLD = 0.3; // once spent, refill to this before sprinting again
const RADIUS = 0.35;
const SWIM = 1.2;
const SWIM_SPRINT = 2;
const TREAD_DEPTH = 1.3;
const SWIM_LEAN = 1.15;
const SWIM_RISE = 0.58;
const PUNCH_TIME = 0.45; // s; with PUNCH_LANDS, the baked clip's timing
const PUNCH_LANDS = 0.15;
export const MAX_HEALTH = 100;
const REGEN_DELAY = 6;
const REGEN = 2.5; // health/s
const CRASH_FLOOR = 5; // m/s lost that doesn't hurt
const CRASH_HURT = 0.1; // per (m/s)² beyond CRASH_FLOOR, family car
const FAMILY_CAR = 1300;
export const TRAM_EXPOSURE = 0.35;

export function exposure(v: Vehicle): number {
  if (twoWheeled(v.spec) || isMotorbike(v.spec)) return 2.5;
  return Math.min(1.15, Math.max(TRAM_EXPOSURE, Math.sqrt(FAMILY_CAR / v.body.mass())));
}

export function crashHurt(dv: number, k: number): number {
  return CRASH_HURT * k * Math.max(0, dv - CRASH_FLOOR) ** 2;
}

export const PLAYER_LOOK = 'Male_Adult_08';

export class Player {
  readonly body: RAPIER.RigidBody;
  readonly object = new THREE.Group(); // not drawn: the crowd draws the avatar at its transform
  prev: { x: number; z: number };
  heading = 0; // Rapier angle: forward = (cos, sin)
  down = 0;
  swimming = false;
  sink = 0;
  punch = 0;
  landed = false;
  avatar = 0;
  health = MAX_HEALTH;
  stamina = 1; // 0..1
  private exhausted = false;
  private phase = 0;
  private aim = 0;
  private lean = 0;
  private unhurt = 0;

  constructor(world: RAPIER.World, x: number, z: number) {
    this.body = personBody(world, x, z, RADIUS, 80, 0);
    this.prev = { x, z };
  }

  get x() {
    return this.body.translation().x;
  }
  get z() {
    return this.body.translation().y;
  }
  get sprinting() {
    const v = this.body.linvel();
    return Math.hypot(v.x, v.y) > RUN + 1;
  }
  get stride() {
    const v = this.body.linvel();
    return Math.min(1, Math.hypot(v.x, v.y) / RUN);
  }

  savePrev() {
    this.prev.x = this.x;
    this.prev.z = this.z;
  }

  startPunch(aim: number): boolean {
    if (this.punch > 0 || this.down > 0 || this.swimming) return false;
    this.punch = PUNCH_TIME;
    this.aim = aim;
    return true;
  }

  /** True if this kills. */
  hurt(amount: number, felt = true): boolean {
    if (amount <= 0 || this.health <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    if (felt) this.unhurt = 0;
    return this.health === 0;
  }

  recover(dt: number) {
    this.unhurt += dt;
    if (this.health > 0 && this.unhurt > REGEN_DELAY) this.health = Math.min(MAX_HEALTH, this.health + REGEN * dt);
  }

  revive() {
    this.health = MAX_HEALTH;
    this.unhurt = 0;
  }

  exert(demand: boolean, dt: number): boolean {
    const on = demand && !this.exhausted;
    if (on) {
      this.stamina = Math.max(0, this.stamina - dt / SPRINT_SECONDS);
      if (this.stamina === 0) this.exhausted = true;
    } else {
      this.stamina = Math.min(1, this.stamina + dt / RECOVER_SECONDS);
      if (this.exhausted && this.stamina >= RECOVER_THRESHOLD) this.exhausted = false;
    }
    return on;
  }

  step(forward: number, right: number, sprint: boolean, cameraYaw: number, dt: number) {
    if (this.down > 0) {
      this.down -= dt;
      forward = right = this.punch = 0;
    }
    this.landed = false;
    if (this.punch > 0) {
      const before = PUNCH_TIME - this.punch;
      this.punch = Math.max(0, this.punch - dt);
      this.landed = before < PUNCH_LANDS && PUNCH_TIME - this.punch >= PUNCH_LANDS;
      forward = right = 0;
      this.heading += wrapAngle(this.aim - this.heading) * Math.min(1, 25 * dt);
    }
    const fx = Math.cos(cameraYaw), fz = Math.sin(cameraYaw);
    let mx = fx * forward - fz * right;
    let mz = fz * forward + fx * right;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const sprinting = this.exert(sprint && len > 0.1, dt);
    const speed = this.swimming ? (sprinting ? SWIM_SPRINT : SWIM) : sprinting ? SPRINT : RUN;
    const v = this.body.linvel();
    const k = Math.min(1, (this.swimming ? 3 : 12) * dt);
    this.body.setLinvel({ x: v.x + (mx * speed - v.x) * k, y: v.y + (mz * speed - v.y) * k }, true);
    if (len > 0.1) {
      this.heading += wrapAngle(Math.atan2(mz, mx) - this.heading) * Math.min(1, 14 * dt);
    }
    this.sink += ((this.swimming ? TREAD_DEPTH : 0) - this.sink) * Math.min(1, 6 * dt);
  }

  place(x: number, z: number, heading: number) {
    this.body.setTranslation({ x, y: z }, true);
    this.body.setLinvel({ x: 0, y: 0 }, true);
    this.body.setEnabled(true);
    this.object.visible = true;
    this.heading = heading;
    this.down = this.sink = this.lean = this.punch = 0;
    this.swimming = false;
    this.prev = { x, z };
  }

  hide() {
    this.body.setEnabled(false);
    this.object.visible = false;
  }

  render(alpha: number, dt: number, crowd: Crowd) {
    const x = this.prev.x + (this.x - this.prev.x) * alpha;
    const z = this.prev.z + (this.z - this.prev.z) * alpha;
    const v = this.body.linvel();
    const speed = this.down > 0 ? 0 : Math.hypot(v.x, v.y);
    this.lean += ((this.swimming && speed > 0.8 ? 1 : 0) - this.lean) * Math.min(1, 5 * dt);
    this.object.position.set(x, this.down > 0 ? 0.25 : -this.sink * (1 - this.lean * SWIM_RISE), z);
    this.object.rotation.y = -this.heading;
    this.object.rotation.z = this.down > 0 ? -Math.PI / 2 : -this.lean * SWIM_LEAN;

    const clip = clipForSpeed(speed);
    this.phase += phaseStep(crowd.clip(this.avatar, clip), speed, dt);
    if (!this.object.visible) return;
    this.object.updateMatrix();
    if (this.punch > 0) crowd.add(this.avatar, this.object.matrix, 'punch', 1 - this.punch / PUNCH_TIME);
    else crowd.add(this.avatar, this.object.matrix, clip, this.phase);
  }
}
