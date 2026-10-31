import type { Pose } from '../core/util';
import { GROUP, RAPIER, WHEELS, groups } from '../physics/physics';
import { BIKE } from './bikeGeometry';
import { AXLES, BUS_WIDTH, SECTION_LENGTH } from './busModel';
import { MOPED, MOTORBIKE } from './motorbikeGeometry';
import { SCOOTER } from './scooterGeometry';

export interface VehicleSpec {
  name:
    | 'city' | 'hatch' | 'estate' | 'sedan' | 'suv' | 'van' | 'bike' | 'scooter' | 'bus' | 'artic' | 'motorbike' | 'moped'
    | 'police' | 'policevan' | 'taxi' | 'ambulance' | 'truck' | 'firetruck';
  model: number; // index in vehicleModels.ts; -1 = drawn elsewhere
  label?: string;
  length: number;
  width: number;
  height?: number;
  paints?: number[];
  siren?: number; // chance it's on a call when spawned
  maxSpeed: number;
  accel: number; // m/s² at rest, fading quadratically to 0 at maxSpeed (m/s)
  sprintSpeed?: number; // m/s with Shift; default maxSpeed
  mass?: number;
  pivot?: number; // m behind centre: long vehicles turn about the rear axle
  trailer?: { length: number; axle: number; mass: number };
}

/** m/s² and m/s; grip 1/s (lower = drift); yaw rad/s at full lock. */
interface Handling {
  brake: number;
  reverseSpeed: number;
  reverseAccel: number;
  coast: number;
  grip: number;
  handbrakeGrip: number;
  yawLow: number;
  yawHigh: number;
}

export const WHEEL_RADIUS = 0.34;
const CAR: Handling = { brake: 16, reverseSpeed: 8, reverseAccel: 5, coast: 1.2, grip: 14, handbrakeGrip: 1.4, yawLow: 2.3, yawHigh: 0.95 };
const BUS: Handling = { brake: 7, reverseSpeed: 4, reverseAccel: 1.5, coast: 0.5, grip: 9, handbrakeGrip: 2.5, yawLow: 0.8, yawHigh: 0.32 };
const TRUCK: Handling = { brake: 9, reverseSpeed: 5, reverseAccel: 2.5, coast: 0.7, grip: 11, handbrakeGrip: 2.2, yawLow: 1.2, yawHigh: 0.45 };
const HANDLING: Partial<Record<VehicleSpec['name'], Handling>> = {
  bike: { brake: 6.5, reverseSpeed: 1.4, reverseAccel: 2, coast: 0.3, grip: 22, handbrakeGrip: 4, yawLow: 2.6, yawHigh: 1.25 },
  scooter: { brake: 8, reverseSpeed: 1, reverseAccel: 1.5, coast: 0.6, grip: 24, handbrakeGrip: 5, yawLow: 3, yawHigh: 1.6 },
  motorbike: { brake: 11, reverseSpeed: 1, reverseAccel: 1.5, coast: 0.9, grip: 18, handbrakeGrip: 2.5, yawLow: 2.5, yawHigh: 0.85 },
  moped: { brake: 8, reverseSpeed: 1, reverseAccel: 1.5, coast: 0.8, grip: 20, handbrakeGrip: 3.5, yawLow: 2.8, yawHigh: 1.3 },
  bus: BUS,
  artic: BUS,
  truck: TRUCK,
  firetruck: TRUCK,
};
const TRAILER_GRIP = 12;
const AFLOAT: Handling = { brake: 2.5, reverseSpeed: 3, reverseAccel: 1.5, coast: 1.5, grip: 2.5, handbrakeGrip: 1.5, yawLow: 1.1, yawHigh: 0.7 };
const AFLOAT_SPEED = 0.3;
const NORMAL_TOP = 55 / 3.6; // m/s; Shift unlocks the real top speed
const WATER_DRAG = 2.5;

export const BIKE_SPEC: VehicleSpec = { name: 'bike', model: -1, length: 1.75, width: 0.6, maxSpeed: 24 / 3.6, sprintSpeed: 32 / 3.6, accel: 2.8, mass: 100 };
export const SCOOTER_SPEC: VehicleSpec = { name: 'scooter', model: -1, length: 1.15, width: 0.55, maxSpeed: 25 / 3.6, accel: 3, mass: 105 };
export const MOTORBIKE_SPEC: VehicleSpec = { name: 'motorbike', model: -1, length: 2.1, width: 0.8, maxSpeed: 180 / 3.6, accel: 10, mass: 270 };
export const MOPED_SPEC: VehicleSpec = { name: 'moped', model: -1, length: 1.8, width: 0.7, maxSpeed: 45 / 3.6, accel: 3, mass: 190 };

export const BUS_SPEC: VehicleSpec = {
  name: 'bus', model: -1, length: SECTION_LENGTH.solo, width: BUS_WIDTH, maxSpeed: 80 / 3.6, accel: 1.9, mass: 12000,
  pivot: SECTION_LENGTH.solo / 2 - AXLES.solo[1],
};
export const ARTIC_SPEC: VehicleSpec = {
  name: 'artic', model: -1, length: SECTION_LENGTH.lead, width: BUS_WIDTH, maxSpeed: 78 / 3.6, accel: 1.7, mass: 11000,
  pivot: SECTION_LENGTH.lead / 2 - AXLES.lead[1], trailer: { length: SECTION_LENGTH.trailer, axle: AXLES.trailer[1], mass: 6000 },
};

export const twoWheeled = (spec: VehicleSpec) => spec.name === 'bike' || spec.name === 'scooter';
export const isBus = (spec: VehicleSpec) => spec.name === 'bus' || spec.name === 'artic';
export const isMotorbike = (spec: VehicleSpec) => spec.name === 'motorbike' || spec.name === 'moped';
export const isTruck = (spec: VehicleSpec) => spec.name === 'truck' || spec.name === 'firetruck';
export const isEmergency = (spec: VehicleSpec) => spec.siren !== undefined;
export const isPolice = (spec: VehicleSpec) => spec.name === 'police' || spec.name === 'policevan';

export const VEHICLE_NAMES: Record<VehicleSpec['name'], string> = {
  city: 'City Car', hatch: 'Hatchback', estate: 'Estate', sedan: 'Sedan', suv: 'SUV', van: 'Van', bike: 'Bike', scooter: 'E-scooter',
  bus: 'Bus', artic: 'Articulated Bus', motorbike: 'Motorbike', moped: 'Moped', police: 'Police Car', policevan: 'Police Van', taxi: 'Taxi',
  ambulance: 'Ambulance', truck: 'Truck', firetruck: 'Fire Engine',
};

function boxBody(world: RAPIER.World, spec: VehicleSpec, length: number, mass: number, pivot: number, x: number, z: number, angle: number) {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(x, z).setRotation(angle).setAngularDamping(1.5).setCcdEnabled(true),
  );
  const collider = RAPIER.ColliderDesc.cuboid(length / 2, spec.width / 2)
    .setFriction(0.3)
    .setRestitution(0.15)
    .setCollisionGroups(groups(twoWheeled(spec) ? GROUP.BIKE : GROUP.VEHICLE, GROUP.STATIC | WHEELS | GROUP.PED));
  if (pivot) collider.setMassProperties(mass, { x: -pivot, y: 0 }, (mass * (length ** 2 + spec.width ** 2)) / 12 + mass * pivot ** 2);
  else collider.setDensity(mass / (length * spec.width));
  world.createCollider(collider, body);
  return body;
}

type Posed = Pose & { prev: Pose };

function setPose(body: RAPIER.RigidBody, pose: Posed, x: number, z: number, angle: number) {
  body.setTranslation({ x, y: z }, true);
  body.setRotation(angle, true);
  body.setLinvel({ x: 0, y: 0 }, true);
  body.setAngvel(0, true);
  pose.x = pose.prev.x = x;
  pose.z = pose.prev.z = z;
  pose.angle = pose.prev.angle = angle;
}

function readPose(body: RAPIER.RigidBody, pose: Pose) {
  const t = body.translation();
  pose.x = t.x;
  pose.z = t.y;
  pose.angle = body.rotation();
}

function savePose(pose: Posed) {
  pose.prev.x = pose.x;
  pose.prev.z = pose.z;
  pose.prev.angle = pose.angle;
}

export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly trailer: (Posed & { body: RAPIER.RigidBody }) | null = null;
  controls: { steer: number; throttle: number; handbrake: boolean; boost?: boolean } = { steer: 0, throttle: 0, handbrake: true };
  driven = false;
  siren = false;
  remote = false; // another player's kinematic body; step() skips it

  roll = 0;
  pitch = 0;
  afloat = false;
  sink = 0;
  prev: Pose;
  /** Cached by sync(): reading ~900 cars from Rapier each step was costly on phones. */
  x: number;
  z: number;
  angle: number;
  awake = false;

  steerSmoothed = 0;
  wheelSpin = 0;
  pedals = 0;
  private lastForwardSpeed = 0;

  constructor(
    world: RAPIER.World,
    readonly spec: VehicleSpec,
    readonly colour: number,
    x: number,
    z: number,
    angle: number,
  ) {
    this.body = boxBody(world, spec, spec.length, spec.mass ?? 1300, spec.pivot ?? 0, x, z, angle);
    this.prev = { x, z, angle };
    this.x = x;
    this.z = z;
    this.angle = angle;
    if (spec.trailer) {
      const { length, axle, mass } = spec.trailer;
      const body = boxBody(world, spec, length, mass, length / 2 - axle, x, z, angle);
      const hinge = RAPIER.JointData.revolute({ x: -spec.length / 2, y: 0 }, { x: length / 2, y: 0 });
      const joint = world.createImpulseJoint(hinge, this.body, body, true) as RAPIER.RevoluteImpulseJoint;
      joint.setContactsEnabled(false);
      joint.setLimits(-0.9, 0.9);
      this.trailer = { body, x, z, angle, prev: { x, z, angle } };
      this.placeTrailer(angle);
    }
  }

  placeTrailer(angle: number) {
    const half = this.spec.trailer!.length / 2;
    const x = this.x - Math.cos(this.angle) * (this.spec.length / 2) - Math.cos(angle) * half;
    const z = this.z - Math.sin(this.angle) * (this.spec.length / 2) - Math.sin(angle) * half;
    setPose(this.trailer!.body, this.trailer!, x, z, angle);
  }

  teleport(x: number, z: number, angle: number) {
    setPose(this.body, this, x, z, angle);
    this.awake = true;
    if (this.trailer) this.placeTrailer(angle);
  }

  sync() {
    readPose(this.body, this);
    if (this.trailer) readPose(this.trailer.body, this.trailer);
  }

  get animatedSpeed(): number {
    return this.lastForwardSpeed;
  }

  get forwardSpeed(): number {
    const v = this.body.linvel();
    const a = this.body.rotation();
    return v.x * Math.cos(a) + v.y * Math.sin(a);
  }

  savePrev() {
    savePose(this);
    if (this.trailer) savePose(this.trailer);
  }

  step(dt: number) {
    const body = this.body;
    if (this.trailer && (this.awake || this.driven)) this.trailerGrip(dt);
    if (this.remote || (!this.awake && !this.driven)) return;

    const a = body.rotation();
    const fx = Math.cos(a), fz = Math.sin(a);
    const sx = -fz, sz = fx;
    const v = body.linvel();
    const vf = v.x * fx + v.y * fz;
    const vs = v.x * sx + v.y * sz;
    const mass = body.mass();
    const { steer, throttle, handbrake, boost } = this.driven ? this.controls : { steer: 0, throttle: 0, handbrake: true, boost: false };
    const h = this.afloat ? AFLOAT : HANDLING[this.spec.name] ?? CAR;
    const cruise = this.afloat ? this.spec.maxSpeed * AFLOAT_SPEED : this.spec.maxSpeed;
    const boosted = this.afloat ? cruise : this.spec.sprintSpeed ?? this.spec.maxSpeed;
    const top = boost ? boosted : Math.min(cruise, NORMAL_TOP);
    const accel = this.afloat ? this.spec.accel / 2 : this.spec.accel;

    let dv = 0;
    if (throttle > 0.05) {
      dv = vf < -0.5 ? h.brake * throttle : accel * throttle * Math.max(0, 1 - (vf / top) ** 2);
    } else if (throttle < -0.05) {
      dv = vf > 0.5 ? -h.brake * -throttle : -h.reverseAccel * -throttle * Math.max(0, 1 + vf / h.reverseSpeed);
    } else {
      dv = -Math.sign(vf) * Math.min(Math.abs(vf) / dt, h.coast);
    }
    if (handbrake) dv -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, this.driven && !this.afloat ? 6 : h.brake);
    if (this.afloat && Math.abs(vf) > top) dv -= Math.sign(vf) * (Math.abs(vf) - top) * WATER_DRAG;
    dv *= dt;

    const grip = handbrake && this.driven ? h.handbrakeGrip : h.grip;
    const ds = -vs * Math.min(1, grip * dt);

    // engine and brakes pull the trailer too; grip holds only the lead's wheels
    const pull = mass + (this.trailer?.body.mass() ?? 0);
    body.applyImpulse({ x: fx * dv * pull + sx * ds * mass, y: fz * dv * pull + sz * ds * mass }, true);

    this.steerSmoothed += (steer - this.steerSmoothed) * Math.min(1, 10 * dt);
    const speed01 = Math.min(Math.abs(vf) / top, 1);
    const rolling = Math.min(Math.abs(vf) / 3, 1);
    const yaw = this.steerSmoothed * (h.yawLow + (h.yawHigh - h.yawLow) * speed01) * (twoWheeled(this.spec) || isMotorbike(this.spec) ? Math.min(Math.abs(vf) / 1.2, 1) : rolling) * Math.sign(vf || 1);
    const target = this.driven ? yaw * (handbrake ? 1.35 : 1) : 0;
    const w = body.angvel();
    body.setAngvel(w + (target - w) * Math.min(1, 8 * dt), true);
    this.animate(vf, w, throttle, dt);
  }

  private trailerGrip(dt: number) {
    const body = this.trailer!.body;
    const a = body.rotation();
    const sx = -Math.sin(a), sz = Math.cos(a);
    const v = body.linvel();
    const ds = -(v.x * sx + v.y * sz) * Math.min(1, TRAILER_GRIP * dt) * body.mass();
    body.applyImpulse({ x: sx * ds, y: sz * ds }, false);
  }

  animate(vf: number, w: number, throttle: number, dt: number) {
    const bike = this.spec.name === 'bike', scooter = this.spec.name === 'scooter';
    const moto = this.spec.name === 'motorbike' ? MOTORBIKE : this.spec.name === 'moped' ? MOPED : null;
    const accel = (vf - this.lastForwardSpeed) / dt;
    this.lastForwardSpeed = vf;
    this.wheelSpin += (vf * dt) / (scooter ? SCOOTER.wheelRadius : moto ? moto.wheelRadius : WHEEL_RADIUS);
    const lean = Math.atan((vf * w) / 9.81);
    const most = moto === MOTORBIKE ? 0.75 : 0.5;
    const roll = bike
      ? this.driven ? Math.max(-0.45, Math.min(0.45, lean)) : 0.1
      : scooter
        ? this.driven ? Math.max(-0.3, Math.min(0.3, lean * 0.8)) : -0.1
        : moto
          ? this.driven ? Math.max(-most, Math.min(most, lean)) : moto === MOTORBIKE ? -0.14 : 0
          : Math.max(-0.07, Math.min(0.07, -vf * w * 0.004));
    this.roll += (roll - this.roll) * Math.min(1, 6 * dt);
    if (bike && throttle > 0.05 && vf > 0.2) this.pedals += (vf * dt) / BIKE.development;
    this.pitch += (Math.max(-0.05, Math.min(0.05, -accel * 0.004)) - this.pitch) * Math.min(1, 6 * dt);
  }
}

const WHITE = 0xf4f5f3;

/** ~Belgian street mix: [spec, traffic weight, parked weight (default same)]. */
export const VEHICLE_TYPES: [VehicleSpec, number, number?][] = [
  [{ name: 'city', model: 0, length: 3.95, width: 1.75, maxSpeed: 150 / 3.6, accel: 3.3 }, 4],
  [{ name: 'hatch', model: 1, length: 4.25, width: 1.79, maxSpeed: 170 / 3.6, accel: 3.5 }, 6],
  [{ name: 'estate', model: 2, length: 4.75, width: 1.83, maxSpeed: 178 / 3.6, accel: 3.5 }, 4],
  [{ name: 'sedan', model: 3, length: 4.75, width: 1.83, maxSpeed: 195 / 3.6, accel: 4 }, 3],
  [{ name: 'suv', model: 4, length: 4.5, width: 1.86, maxSpeed: 172 / 3.6, accel: 3.3 }, 5],
  [{ name: 'van', model: 5, length: 5.3, width: 2.05, maxSpeed: 140 / 3.6, accel: 2.6 }, 2],
  [MOTORBIKE_SPEC, 1.4],
  [MOPED_SPEC, 1.6],
  [{ name: 'police', model: 6, label: 'police car', length: 4.75, width: 1.83, maxSpeed: 210 / 3.6, accel: 4.5, mass: 1600, paints: [WHITE], siren: 0.45 }, 0.9, 0.25],
  [{ name: 'policevan', model: 7, label: 'police van', length: 5.3, width: 2.05, height: 2.3, maxSpeed: 160 / 3.6, accel: 3.1, mass: 2600, paints: [WHITE], siren: 0.3 }, 0.35, 0.1],
  [{ name: 'taxi', model: 8, label: 'taxi', length: 4.75, width: 1.83, maxSpeed: 185 / 3.6, accel: 3.9, paints: [0x16171a, 0x1c1d20, 0x25272b, 0x16171a, 0x8e9196, WHITE] }, 1.6, 0.6],
  [{ name: 'ambulance', model: 9, label: 'ambulance', length: 6.2, width: 2.15, height: 2.75, maxSpeed: 150 / 3.6, accel: 2.8, mass: 3800, paints: [0xf0cf0e], siren: 0.65 }, 0.3, 0],
  [{ name: 'truck', model: 10, label: 'truck', length: 7.6, width: 2.45, height: 3.5, maxSpeed: 100 / 3.6, accel: 2.4, mass: 7500, pivot: 2.2, paints: [WHITE, WHITE, WHITE, 0xa3201c, 0x1f3559, 0x2f4d3a, 0xbfc2c5] }, 0.8, 0.35],
  [{ name: 'firetruck', model: 11, label: 'fire engine', length: 8.2, width: 2.5, height: 3.3, maxSpeed: 110 / 3.6, accel: 2.8, mass: 13000, pivot: 2.35, paints: [0xb5121b], siren: 0.75 }, 0.15, 0],
];

export const paintFor = (spec: VehicleSpec, rand = Math.random) => {
  const paints = spec.paints ?? PAINTS;
  return paints[Math.floor(rand() * paints.length)];
};

export const PAINTS = [
  0xf2f2f0, 0xe8e8e6, 0xdfe0de, 0x1c1d20, 0x16171a, 0x25272b, 0x8e9196, 0xa9acb0, 0xbfc2c5, 0x5c6066, 0x4a4e54,
  0x1f3559, 0x22314a, 0x2d4f7c, 0x8a1a1d, 0xa3201c, 0x2f4d3a, 0xc9b896, 0x6d4a2f, 0x3a6f93,
];
