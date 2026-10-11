import * as THREE from 'three';
import { wrapAngle } from '../core/util';
import type { Physics } from '../physics/physics';

interface CameraFocus {
  x: number;
  z: number;
  height: number;
  heading?: number;
  stride?: number; // 0..1 of run pace; on foot only
  speed: number;
  distance: number;
  sprint?: boolean;
  room?: { free(x: number, z: number, dx: number, dz: number): number; confine(p: THREE.Vector3): void; lookUp?: boolean };
}

const MIN_PITCH = -0.05;
const LOOK_UP = -0.75; // rad: in halls the camera may drop to the floor to look up at the vaults
const MAX_PITCH = 1.1;
const WALK_FOLLOW = 1.5; // 1/s at run pace

export class CameraRig {
  yaw = 0;
  pitch = 0.2;
  private manualTimer = 0;
  private distance = 6;
  private zoom = 1;
  readonly target = new THREE.Vector3();
  private position = new THREE.Vector3();
  private initialised = false;
  private minPitch = MIN_PITCH;

  constructor(readonly camera: THREE.PerspectiveCamera, private physics: Physics) {}

  snap() {
    this.initialised = false;
  }

  look(dx: number, dy: number) {
    if (dx || dy) this.manualTimer = 1.6;
    this.yaw += dx;
    this.pitch = Math.max(this.minPitch, Math.min(MAX_PITCH, this.pitch + dy));
  }

  update(focus: CameraFocus, dt: number) {
    this.manualTimer -= dt;
    this.minPitch = focus.room?.lookUp ? LOOK_UP : MIN_PITCH;
    if (this.pitch < this.minPitch) this.pitch += (this.minPitch - this.pitch) * Math.min(1, dt * 4);
    if (focus.heading !== undefined && this.manualTimer <= 0) {
      const d = wrapAngle(focus.heading - this.yaw);
      if (focus.stride !== undefined) {
        // sin, not d: running at the camera leaves it put instead of whipping it round
        this.yaw += Math.sin(d) * Math.min(1, dt * WALK_FOLLOW * focus.stride);
      } else {
        this.yaw += d * Math.min(1, dt * 3 * Math.min(focus.speed / 4, 1));
        this.pitch += (0.22 - this.pitch) * Math.min(1, dt * 1.5);
      }
    }

    const ahead = Math.min(focus.speed * 0.25, 6);
    const tx = focus.x + Math.cos(this.yaw) * ahead;
    const tz = focus.z + Math.sin(this.yaw) * ahead;
    const want = focus.distance + focus.speed * 0.12;
    const back = { x: -Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const horizontal = want * Math.cos(this.pitch);
    const free = focus.room ? focus.room.free(focus.x, focus.z, back.x, back.z) : this.physics.castStatic(focus.x, focus.z, back.x, back.z, horizontal + 0.5) - 0.5;
    const distance = Math.max(1.2, Math.min(want, free / Math.max(Math.cos(this.pitch), 0.1)));
    this.distance += (distance - this.distance) * Math.min(1, dt * (distance < this.distance ? 20 : 3));

    const h = this.distance * Math.cos(this.pitch);
    this.target.set(tx, focus.height + 0.6, tz);
    const desired = new THREE.Vector3(focus.x + back.x * h, focus.height + this.distance * Math.sin(this.pitch) + 0.6, focus.z + back.z * h);
    focus.room?.confine(desired);
    if (this.initialised) this.position.lerp(desired, Math.min(1, dt * 12));
    else this.position.copy(desired);
    this.initialised = true;
    focus.room?.confine(this.position);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);

    const zoom = focus.sprint ? 0.88 : 1;
    if (zoom !== this.zoom) {
      this.zoom += (zoom - this.zoom) * Math.min(1, dt * 4);
      if (Math.abs(zoom - this.zoom) < 1e-3) this.zoom = zoom;
      this.camera.zoom = this.zoom;
      this.camera.updateProjectionMatrix();
    }
  }
}
