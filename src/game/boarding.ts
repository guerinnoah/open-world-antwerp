import { VELO_RED, isVelo, type Bikes } from '../actors/bikes';
import type { Bus, Buses } from '../actors/buses';
import type { Cyclists, Rider } from '../actors/cyclists';
import type { Pedestrians } from '../actors/pedestrians';
import { TRAM_EXPOSURE, crashHurt, type Player } from '../actors/player';
import { BRANDS, brandOf, type Parked, type Scooters } from '../actors/scooters';
import type { Traffic } from '../actors/traffic';
import { TRAM_WIDTH } from '../actors/tramModel';
import type { Tram, Trams } from '../actors/trams';
import { BIKE_SPEC, SCOOTER_SPEC, Vehicle, isBus, isEmergency, isMotorbike, isPolice, isTruck, twoWheeled } from '../actors/vehicle';
import type { Sound } from '../audio/sound';
import type { Input } from '../core/input';
import { keyLabel } from '../core/keys';
import { GROUP, RAPIER, WHEELS, groups, type Physics } from '../physics/physics';
import type { Hud } from '../ui/hud';
import type { CameraRig } from './cameraRig';
import { vehicleName } from './prompts';

const ENTER_RANGE = 3.2; // m from the vehicle's outline
const STEAL_RANGE = 2.6; // m, centre to centre
export const TRAM_EXIT_SPEED = 3; // m/s

export type Ride =
  | { dock: NonNullable<ReturnType<Bikes['dockedNear']>> } | { scooter: Parked } | { cyclist: Rider } | { vehicle: Vehicle } | { tram: Tram } | { bus: Bus };

interface BoardingHost {
  readonly player: Player;
  readonly rig: CameraRig;
  readonly vehicles: readonly Vehicle[];
  readonly traffic: Traffic;
  readonly peds: Pedestrians;
  readonly cyclists: Cyclists;
  readonly trams: Trams;
  readonly buses: Buses;
  readonly bikes: Bikes;
  readonly scooters: Scooters;
  addVehicle(v: Vehicle): void;
  removeVehicle(v: Vehicle): void;
  crime(x: number, z: number, againstPolice?: boolean): void;
  hurt(amount: number): void;
}

/** What the player drives or rides, and getting in and out of it. */
export class Boarding {
  driving: Vehicle | null = null;
  tram: Tram | null = null;
  private rideStart = { x: 0, z: 0 };
  private carTipShown = false;
  private stolenPolice = new WeakSet<Vehicle>(); // getting back in isn't a fresh theft

  constructor(
    private host: BoardingHost,
    private physics: Physics,
    private input: Input,
    private hud: Hud,
    private sound: Sound,
  ) {}

  nearestRide(): Ride | null {
    const { host } = this, { player } = host;
    if (player.down > 0) return null;
    const [vehicle, vd] = this.nearestVehicle();
    const cyclist = host.cyclists.nearest(player.x, player.z, STEAL_RANGE);
    if (cyclist) {
      const t = cyclist.body.translation();
      if (!vehicle || Math.hypot(t.x - player.x, t.y - player.z) < vd) return { cyclist };
    }
    const dock = host.bikes.dockedNear(player.x, player.z);
    if (dock && (!vehicle || Math.hypot(dock.x - player.x, dock.z - player.z) - 0.3 < vd)) return { dock };
    const scooter = host.scooters.nearest(player.x, player.z);
    if (scooter && (!vehicle || Math.hypot(scooter.x - player.x, scooter.z - player.z) - 0.3 < vd)) return { scooter };
    const tram = host.trams.near(player.x, player.z, ENTER_RANGE);
    const bus = host.buses.near(player.x, player.z, ENTER_RANGE);
    if (bus && bus.distance < vd && (!tram || bus.distance < tram.distance)) return { bus: bus.bus };
    if (tram && tram.distance < vd) return { tram: tram.tram };
    return vehicle ? { vehicle } : null;
  }

  takeNearest() {
    const near = this.nearestRide();
    if (!near) return;
    if ('vehicle' in near) this.enterVehicle(near.vehicle);
    else if ('cyclist' in near) this.stealBike(near.cyclist);
    else if ('tram' in near) this.boardTram(near.tram);
    else if ('bus' in near) this.hijackBus(near.bus);
    else if ('scooter' in near) {
      const pose = this.host.scooters.take(near.scooter);
      const scooter = new Vehicle(this.physics.world, SCOOTER_SPEC, pose.colour, pose.x, pose.z, pose.heading);
      this.host.addVehicle(scooter);
      this.mount(scooter);
      this.host.rig.yaw = pose.heading;
    } else {
      const pose = this.host.bikes.take(near.dock);
      const bike = new Vehicle(this.physics.world, BIKE_SPEC, VELO_RED, pose.x, pose.z, pose.heading);
      this.host.addVehicle(bike);
      this.mount(bike);
      this.host.rig.yaw = pose.heading;
    }
  }

  /** A free dock to leave a Velo bike in, once it's been ridden somewhere. */
  dockToReturn(bike: Vehicle) {
    if (!isVelo(bike)) return null;
    if (Math.hypot(bike.x - this.rideStart.x, bike.z - this.rideStart.z) < 4) return null;
    return this.host.bikes.emptyDockNear(bike.x, bike.z);
  }

  dismount() {
    if (this.driving) {
      this.leaveSeat(this.driving);
      this.sound.engineOff();
      this.sound.radioOff();
      this.sound.horn(false);
    } else if (this.tram) {
      this.host.trams.leave(this.tram);
      this.tram = null;
      this.input.seat = 'foot';
      this.sound.engineOff();
    }
  }

  throwOff(v: Vehicle, velocity: { x: number; y: number }): boolean {
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    const behind: [number, number] = [v.x - c * (v.spec.length / 2 + 0.6), v.z - s * (v.spec.length / 2 + 0.6)];
    const spot = this.beside(v.x, v.z, v.angle, v.spec.width / 2) ?? (this.standable(...behind) ? behind : null);
    if (!spot) return false;
    this.dismount();
    this.stand(spot, v.angle);
    this.host.player.down = 2;
    this.host.player.body.setLinvel({ x: velocity.x * 0.35, y: velocity.y * 0.35 }, true);
    this.hud.toast('Thrown off the motorbike.');
    return true;
  }

  exitVehicle() {
    const v = this.driving!;
    if (Math.abs(v.forwardSpeed) > 8) return;
    const spot = this.beside(v.x, v.z, v.angle, v.spec.width / 2);
    if (!spot) return;
    this.dismount();
    if (v.spec.name === 'bike') {
      const dock = this.dockToReturn(v);
      if (dock) {
        this.host.bikes.dock(dock);
        this.host.removeVehicle(v);
        this.hud.toast('Bike returned. Thanks for riding Velo!');
      }
    } else if (v.spec.name === 'scooter') this.hud.toast('Ride ended. Park it neatly!');
    this.stand(spot, v.angle);
  }

  rideAlong(t: Tram) {
    const cab = t.sections[0];
    const p = cab.translation(), { player } = this.host;
    player.body.setTranslation({ x: p.x, y: p.y }, false);
    player.heading = cab.rotation();
    if (t.impact > 2.5) {
      this.sound.crash(t.impact);
      this.host.hurt(crashHurt(t.impact, TRAM_EXPOSURE));
    }
  }

  exitTram() {
    const t = this.tram!;
    if (Math.abs(t.speed) > TRAM_EXIT_SPEED) return;
    const cab = t.sections[0], p = cab.translation(), angle = cab.rotation();
    const spot = this.beside(p.x, p.y, angle, TRAM_WIDTH / 2);
    if (!spot) return;
    this.dismount();
    this.stand(spot, angle);
  }

  /** On foot again, facing `angle`, the camera behind. */
  private stand([x, z]: [number, number], angle: number) {
    this.host.player.place(x, z, angle);
    this.host.rig.yaw = angle;
  }

  private nearestVehicle(): [Vehicle | null, number] {
    let best: Vehicle | null = null;
    let bestD = ENTER_RANGE;
    const { x: px, z: pz } = this.host.player;
    for (const v of this.host.vehicles) {
      const dx = v.x - px, dz = v.z - pz;
      const reach = v.spec.length / 2 + ENTER_RANGE;
      if (Math.abs(dx) > reach || Math.abs(dz) > reach || v.sink > 0 || v.remote) continue;
      const c = Math.cos(v.angle), s = Math.sin(v.angle);
      const lx = Math.max(Math.abs(dx * c + dz * s) - v.spec.length / 2, 0);
      const lz = Math.max(Math.abs(-dx * s + dz * c) - v.spec.width / 2, 0);
      const d = Math.hypot(lx, lz);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return [best, bestD];
  }

  private stealBike(r: Rider) {
    const b = this.host.cyclists.steal(r);
    const c = Math.cos(b.heading), s = Math.sin(b.heading);
    const bike = new Vehicle(this.physics.world, BIKE_SPEC, b.colour, b.x, b.z, b.heading);
    bike.body.setLinvel({ x: c * b.speed, y: s * b.speed }, true);
    this.host.addVehicle(bike);
    // Off to the right, onto the kerb side, and away once they're back up.
    const owner = this.host.peds.spawnFleeing(b.x - s * 0.9, b.z + c * 0.9, b.avatar);
    this.host.peds.knockDown(owner, -s, c, 3);
    this.sound.bump(b.x, b.z);
    this.host.crime(b.x, b.z);
    this.mount(bike, 'You took their bike.');
    this.host.rig.yaw = b.heading;
  }

  private takeWheel(v: Vehicle, name = vehicleName(v)) {
    this.hud.setVehicle(name);
    this.driving = v;
    this.input.seat = isEmergency(v.spec) ? 'emergency' : 'vehicle';
    v.driven = true;
    v.body.wakeUp();
    this.host.player.hide();
  }

  private leaveSeat(v: Vehicle) {
    this.input.seat = 'foot';
    v.driven = false;
    v.controls = { steer: 0, throttle: 0, handbrake: true };
    if (!v.afloat) v.sink = 0;
    this.driving = null;
  }

  private mount(ride: Vehicle, toast?: string) {
    this.rideStart = { x: ride.x, z: ride.z };
    if (toast) this.hud.toast(toast);
    else if (ride.spec.name === 'scooter') {
      const name = BRANDS[brandOf(ride.colour)].name;
      this.hud.toast(`${name} unlocked. Max 25 km/h.`);
      this.sound.engineOn('scooter');
    } else if (isVelo(ride)) {
      this.hud.toast('Velo unlocked.');
    }
    this.takeWheel(ride);
  }

  private standable(x: number, z: number): boolean {
    const filter = groups(GROUP.PED, GROUP.STATIC | WHEELS | GROUP.PED);
    return !this.physics.boxOverlaps(x, z, 0, 0.3, 0.3, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, filter, this.driving?.body);
  }

  private beside(x: number, z: number, angle: number, half: number): [number, number] | undefined {
    const c = Math.cos(angle), s = Math.sin(angle);
    for (const side of [-1, 1]) {
      // Left (driver's) side first: local -z, which is (s, -c) in world (x, z).
      const off = side * (half + 0.7);
      const px = x - s * off, pz = z + c * off;
      if (this.standable(px, pz)) return [px, pz];
    }
  }

  private enterVehicle(v: Vehicle) {
    if (twoWheeled(v.spec)) {
      this.mount(v);
      return;
    }
    const jacked = this.host.traffic.has(v), police = isPolice(v.spec) && !this.stolenPolice.has(v);
    if (jacked || police) this.host.crime(v.x, v.z, police);
    if (police) this.stolenPolice.add(v);
    if (jacked) {
      this.host.traffic.release(v);
      const c = Math.cos(v.angle), s = Math.sin(v.angle);
      this.host.peds.spawnFleeing(v.x + s * (v.spec.width / 2 + 0.8), v.z - c * (v.spec.width / 2 + 0.8));
    }
    const radio = !isBus(v.spec) && !isMotorbike(v.spec) && !isEmergency(v.spec);
    const tips: string[] = [];
    if (isEmergency(v.spec)) tips.push(`${this.input.touch ? 'Tap Siren' : `Press ${keyLabel('siren')}`} for the lights.`);
    if (radio && !this.carTipShown) {
      this.carTipShown = true;
      tips.push(this.input.touch ? 'Tap the station name to change the radio.' : `${keyLabel('handbrake')} is the handbrake, ${keyLabel('horn')} the horn, ${keyLabel('punch')} the next radio station.`);
    }
    if (tips.length) this.hud.toast(tips.join(' '), 6000);
    this.takeWheel(v);
    const moto = v.spec.name === 'motorbike' || v.spec.name === 'moped' ? v.spec.name : null;
    this.sound.engineOn(isBus(v.spec) || isTruck(v.spec) ? 'bus' : moto ?? 'car');
    if (radio) this.sound.radioOn();
  }

  private hijackBus(b: Bus) {
    const v = this.host.buses.hijack(b);
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    const ahead = v.spec.length / 2 - 1.5, side = v.spec.width / 2 + 0.8;
    this.host.peds.spawnFleeing(v.x + c * ahead + s * side, v.z + s * ahead - c * side);
    this.hud.toast(`Line ${b.run.line} is out of service.`);
    this.host.crime(v.x, v.z);
    this.takeWheel(v, `Bus ${b.run.line}`);
    this.host.rig.yaw = v.angle;
    this.sound.engineOn('bus');
  }

  private boardTram(t: Tram) {
    this.host.trams.board(t);
    this.tram = t;
    this.hud.setVehicle(`Tram ${t.run.line}`);
    this.input.seat = 'vehicle';
    this.host.player.hide();
    this.rideAlong(t);
    this.host.rig.yaw = t.sections[0].rotation();
    this.hud.toast(`Line ${t.run.line} to ${t.run.to}.`);
    this.sound.engineOn('tram');
  }
}
