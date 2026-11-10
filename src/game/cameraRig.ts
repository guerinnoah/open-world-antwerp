import * as THREE from 'three';
import { isBus, isMotorbike, isTruck, twoWheeled, type Vehicle } from '../actors/vehicle';
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
  eye?: number;
  eyeForward?: number; // first person: forward along `heading`, so the view sits in the cab
  room?: { free(x: number, z: number, dx: number, dz: number): number; confine(p: THREE.Vector3): void };
}

const MIN_PITCH = -0.05;
const MAX_PITCH = 1.1;
const WALK_FOLLOW = 1.5; // 1/s at run pace

const FP_PITCH = 0.95; // rad, first person
const PORTRAIT_PULL_BACK = 1.3; // × distance: an upright phone sees less to the sides
const INDOOR_FAR = 300; // m: past the street outside a shop window, so the city behind the walls isn't drawn

export class CameraRig {
  yaw = 0;
  pitch = 0.2;
  firstPerson = false;
  private manualTimer = 0;
  private distance = 6;
  private zoom = 1;
  readonly target = new THREE.Vector3();
  private position = new THREE.Vector3();
  private initialised = false;
  private minPitch = MIN_PITCH;
  private readonly outdoorFar: number;

  constructor(readonly camera: THREE.PerspectiveCamera, private physics: Physics) {
    this.outdoorFar = camera.far;
  }

  snap() {
    this.initialised = false;
  }

  look(dx: number, dy: number) {
    if (dx || dy) this.manualTimer = 1.6;
    this.yaw += dx;
    this.pitch = Math.max(this.minPitch, Math.min(MAX_PITCH, this.pitch + dy));
  }

  setFirstPerson(on: boolean) {
    if (on === this.firstPerson) return;
    this.firstPerson = on;
    this.pitch = on ? 0 : 0.2;
    this.minPitch = on ? -FP_PITCH : MIN_PITCH;
    this.snap();
  }

  update(focus: CameraFocus, dt: number) {
    this.manualTimer -= dt;
    const far = focus.room ? Math.min(INDOOR_FAR, this.outdoorFar) : this.outdoorFar;
    if (far !== this.camera.far) {
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
    if (this.firstPerson) return this.updateFirstPerson(focus, dt);
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
    const want = focus.distance * (this.camera.aspect < 1 ? PORTRAIT_PULL_BACK : 1) + focus.speed * 0.12;
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

  /** Pulled back by the vehicle's size; `alpha` interpolates between physics steps. */
  followVehicle(car: Vehicle, alpha: number, dt: number): { x: number; z: number; speed: number } {
    const x = car.prev.x + (car.x - car.prev.x) * alpha;
    const z = car.prev.z + (car.z - car.prev.z) * alpha;
    const speed = Math.abs(car.forwardSpeed);
    const v = car.body.linvel();
    const heading = speed > 2 && car.forwardSpeed > 0 ? Math.atan2(v.y, v.x) : car.angle;
    const bike = twoWheeled(car.spec), bus = isBus(car.spec), moto = isMotorbike(car.spec), truck = isTruck(car.spec);
    const distance = bike ? 4.4 : moto ? 5 : bus ? (car.trailer ? 17 : 14) : 6.5 + Math.max(0, car.spec.length - 4.75) * 1.3;
    const height = bike || moto ? 1.5 : bus ? 3.4 : Math.max(1.4, (car.spec.height ?? 0) - 0.2);
    // Eye at the front edge; above the roof of a bus or truck, which are solid.
    const bigFront = bus || truck;
    const eye = bigFront ? height + 0.25 : bike || moto ? 1.5 : Math.max(1.1, height - 0.2);
    const eyeForward = bike || moto ? 0.3 : car.spec.length / 2 - 0.25;
    this.update({ x, z, height, heading, speed, distance, eye, eyeForward }, dt);
    return { x, z, speed };
  }

  /** Eye at the front of the 7.2 m cab, just above the roof. */
  followTram(x: number, z: number, heading: number, speed: number, dt: number) {
    this.update({ x, z, height: 2.4, heading, speed, distance: 13, eye: 3.1, eyeForward: 3.35 }, dt);
  }

  private updateFirstPerson(focus: CameraFocus, dt: number) {
    if (focus.heading !== undefined && this.manualTimer <= 0) {
      const d = wrapAngle(focus.heading - this.yaw);
      if (focus.stride !== undefined) this.yaw += Math.sin(d) * Math.min(1, dt * WALK_FOLLOW * focus.stride);
      else this.yaw += d * Math.min(1, dt * 3);
    }
    const hx = focus.heading !== undefined ? Math.cos(focus.heading) : 0;
    const hz = focus.heading !== undefined ? Math.sin(focus.heading) : 0;
    const fwd = focus.eyeForward ?? 0;
    this.position.set(focus.x + hx * fwd, focus.eye ?? focus.height + 0.1, focus.z + hz * fwd);
    focus.room?.confine(this.position);
    const lp = -this.pitch, cl = Math.cos(lp); // pitch > 0 (dragged down) looks down; < 0 looks up
    this.target.set(this.position.x + Math.cos(this.yaw) * cl, this.position.y + Math.sin(lp), this.position.z + Math.sin(this.yaw) * cl);
    this.camera.position.copy(this.position);
    this.camera.lookAt(this.target);
    if (this.zoom !== 1) {
      this.zoom = 1;
      this.camera.zoom = 1;
      this.camera.updateProjectionMatrix();
    }
    this.initialised = true;
  }
}
