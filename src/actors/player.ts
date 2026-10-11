import * as THREE from 'three';
import { wrapAngle } from '../core/util';
import type { RAPIER } from '../physics/physics';
import { clipForSpeed, phaseStep, type Crowd } from './crowd';
import { personBody } from './pedestrians';

const RUN = 6.5;
const SPRINT = 11;
const RADIUS = 0.35;
const SWIM = 2.4;
const SWIM_SPRINT = 3.6;
const TREAD_DEPTH = 1.3;
const SWIM_LEAN = 1.15;
const SWIM_RISE = 0.58;
const PUNCH_TIME = 0.45; // s, and PUNCH_LANDS when the fist lands: the baked clip's timing
const PUNCH_LANDS = 0.15;

export class Player {
  readonly body: RAPIER.RigidBody;
  readonly object = new THREE.Group(); // not drawn itself: carries the transform the crowd draws the avatar at
  prev: { x: number; z: number };
  heading = 0; // Rapier angle: forward = (cos, sin)
  down = 0;
  swimming = false;
  sink = 0;
  punch = 0;
  landed = false;
  avatar = 0;
  private phase = 0;
  private aim = 0;
  private lean = 0;

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
    const speed = this.swimming ? (sprint ? SWIM_SPRINT : SWIM) : sprint ? SPRINT : RUN;
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
