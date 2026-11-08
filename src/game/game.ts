import * as THREE from 'three';
import { VELO_RED, isVelo, type Bikes } from '../actors/bikes';
import { Buses, type Bus } from '../actors/buses';
import type { Crowd } from '../actors/crowd';
import { Cyclists, type Rider } from '../actors/cyclists';
import { Pedestrians, type Ped } from '../actors/pedestrians';
import { MAX_HEALTH, PLAYER_LOOK, Player, TRAM_EXPOSURE, crashHurt, exposure } from '../actors/player';
import type { Motorbikes } from '../actors/motorbikes';
import { BRANDS, brandOf, type Parked, type Scooters } from '../actors/scooters';
import { Traffic, type Suspect } from '../actors/traffic';
import { TRAM_WIDTH } from '../actors/tramModel';
import { Trams, type Tram } from '../actors/trams';
import {
  BIKE_SPEC, SCOOTER_SPEC, VEHICLE_NAMES, VEHICLE_TYPES, Vehicle, isBus, isEmergency, isMotorbike, isPolice, isTruck, paintFor, twoWheeled, type VehicleSpec,
} from '../actors/vehicle';
import { VehicleRenderer } from '../actors/vehicleModels';
import type { Input, InputState } from '../core/input';
import { mulberry32, pick } from '../core/util';
import { Sound } from '../audio/sound';
import { Splash } from '../fx/splash';
import type { Multiplayer } from '../net/multiplayer';
import { GROUP, RAPIER, WHEELS, groups, type Owner, type Physics } from '../physics/physics';
import { Hud } from '../ui/hud';
import { Minimap } from '../ui/minimap';
import { WorldMap } from '../ui/worldMap';
import type { Breakables } from '../world/breakables';
import type { CityData, GraphData } from '../world/cityData';
import { antwerpClock } from '../world/daylight';
import type { Districts } from '../world/districts';
import type { Interiors } from '../world/interiors';
import { NavGraph, kerbside } from '../world/navGraph';
import { project } from '../world/projection';
import type { Door } from '../world/signs';
import { TRAM_HALF, trackTest } from '../world/trackClearance';
import { WaterMap } from '../world/water';
import { CameraRig } from './cameraRig';
import { Gps, Router, snap } from './gps';
import { Wanted } from './wanted';

/** Local metres; yaw is a Rapier angle. */
export interface Start {
  x: number;
  z: number;
  yaw: number;
  intro: boolean;
}

export const CENTRAAL_START: Start = { x: 1491, z: 372, yaw: Math.PI, intro: true };
export const GROTE_MARKT_START: Start = { x: 12, z: 2, yaw: -3.09, intro: false };
const ENTER_RANGE = 3.2;
const STEAL_RANGE = 2.6; // m, centre to centre
const IDLE: InputState = { steer: 0, throttle: 0, handbrake: false, sprint: false, lookX: 0, lookY: 0, action: false, horn: false, punch: false, siren: false, view: false };
const TRAM_EXIT_SPEED = 3; // m/s
const PUNCH_SEEK = 2.2; // m, centre to centre
const PUNCH_REACH = 1.4; // m
const FLOAT_DEPTH = 0.5; // m
const DEFEAT_TIME = 2.5; // s
const CRASH_SETTLE = 0.1; // s between separate crashes
const DEAD: InputState = { ...IDLE, handbrake: true };
const POLICE_HQ = { lat: 51.2149, lon: 4.40495 }; // the Oudaan police tower, OSM node 13374230906
const DISTRICT_REPEAT = 20; // s

export interface Population {
  traffic: number;
  peds: number;
  cyclists: number;
  trams: number;
  buses: number;
  parkedCars: number;
  vehicleView: number;
  pedView: number;
}

export class Game {
  readonly vehicles: Vehicle[] = [];
  private vehicleByBody = new Map<number, Vehicle>();
  readonly player: Player;
  readonly rig: CameraRig;
  readonly traffic: Traffic;
  readonly peds: Pedestrians;
  readonly cyclists: Cyclists;
  readonly trams: Trams;
  readonly buses: Buses;
  driving: Vehicle | null = null;
  tram: Tram | null = null;
  private renderer: VehicleRenderer;
  private hud = new Hud();
  private minimap: Minimap;
  private worldMap: WorldMap;
  private gps: Gps;
  private sound = new Sound();
  private splash = new Splash();
  private water: WaterMap;
  private drive: NavGraph;
  private sinking: Vehicle[] = [];
  private state: InputState = { ...IDLE };
  private steps = 0;
  private street = { name: '', timer: 0 };
  private intro: { t: number; from: THREE.Vector3; look: THREE.Vector3 } | null = null;
  multiplayer: Multiplayer | null = null;
  readonly wanted = new Wanted();
  private arrested = false;
  private policeStation: [number, number, number];
  private chaseRouter: Router;
  private suspect: Suspect = { x: 0, z: 0, vx: 0, vz: 0, speed: 0, ram: false, hidden: false, car: null };
  private startWanted = 0; // ?wanted=N, held until play starts
  private stolenPolice = new WeakSet<Vehicle>(); // getting back in isn't a fresh theft
  private districts: Districts | null = null;
  private district = { name: '', timer: 0, shown: new Map<string, number>() };
  private hornHeld = false;
  private carTipShown = false;
  private rideStart = { x: 0, z: 0 };
  private hospital: [number, number, number];
  private defeat = 0; // s left
  private crash = { dv: 0, quiet: Infinity }; // m/s lost so far, s since the last hit
  /** Black for a frame first, so building the room doesn't show as a freeze. */
  private entering: { door: Door; from: { x: number; z: number }; frames: number } | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    private physics: Physics,
    private input: Input,
    city: CityData,
    graph: GraphData,
    population: Population,
    private crowd: Crowd,
    private interiors: Interiors,
    private breakables: Breakables,
    private bikes: Bikes,
    private scooters: Scooters,
    private motorbikes: Motorbikes,
    private start: Start = CENTRAAL_START,
  ) {
    this.water = new WaterMap(city);
    this.minimap = new Minimap(city, () => this.worldMap.toggle(true));
    this.hud.soundToggle(this.sound);
    this.hud.radio(this.sound);
    this.drive = new NavGraph(graph.drive, true);
    const walk = new NavGraph(graph.walk, false);
    this.gps = new Gps(this.drive, walk);
    this.chaseRouter = new Router(this.drive);
    this.worldMap = new WorldMap(city, this.gps, this.drive, input.touch);

    this.player = new Player(physics.world, start.x, start.z);
    physics.owners.set(this.player.body.collider(0).handle, { kind: 'player', entity: this.player });
    this.player.heading = start.yaw;
    this.hospital = graph.hospital;
    const [hx, hz] = project(POLICE_HQ.lat, POLICE_HQ.lon);
    this.policeStation = kerbside(this.drive.edges, hx, hz) ?? this.hospital;
    this.rig = new CameraRig(camera, physics);
    this.rig.yaw = start.yaw;
    this.hud.viewToggle(() => this.toggleView());
    this.hud.setView(this.rig.firstPerson);

    this.parkCars(population.parkedCars, trackTest(graph.trams));
    this.traffic = new Traffic(physics, this.drive, this, population.traffic);
    this.peds = new Pedestrians(
      physics, walk, this.drive, population.peds, population.pedView, crowd, city.landmarks,
    );
    this.cyclists = new Cyclists(physics, new NavGraph(graph.bike ?? { nodes: [], edges: [] }, true), crowd, population.cyclists, population.pedView);
    this.player.avatar = crowd.indexOf(PLAYER_LOOK);
    const params = new URLSearchParams(location.search);
    const clock = antwerpClock(params); // De Lijn's schedule for this hour
    this.startWanted = Math.max(0, Math.floor(Number(params.get('wanted')) || 0));
    this.trams = new Trams(physics, graph.trams, population.trams, graph.schedules, clock);
    this.buses = new Buses(physics, graph.buses, population.buses, this, graph.schedules, clock);
    this.renderer = new VehicleRenderer(population.parkedCars + population.traffic + 20, population.vehicleView);
    scene.add(this.player.object, this.renderer.group, crowd.group, this.cyclists.group, this.trams.group, this.buses.group, this.splash.points);

    this.traffic.update(0, start.x, start.z, true);
    this.peds.update(0, start.x, start.z, true);
    this.cyclists.update(0, start.x, start.z, true);
    const station = city.landmarks.find((l) => l.id === 'centraal');
    if (station && start.intro) {
      const look = new THREE.Vector3(station.x + Math.cos(station.angle) * 95, 42, station.z + Math.sin(station.angle) * 95);
      this.intro = { t: 0, from: new THREE.Vector3(start.x + 8, 32, start.z - 85), look };
    }
    if (!this.intro) this.welcome();
  }

  removeParkedScooter(x: number, z: number, colour: number): boolean {
    return this.scooters.takeAt(x, z, colour);
  }

  attachMultiplayer(multiplayer: Multiplayer) {
    this.multiplayer = multiplayer;
  }

  attachDistricts(districts: Districts) {
    this.districts = districts;
  }

  route(x: number, z: number, heading: number | null, tx: number, tz: number): number[] | null {
    const start = snap(this.drive, x, z, 60), goal = snap(this.drive, tx, tz, 120);
    return (start && goal && this.chaseRouter.route(start, goal, true, heading, true)?.points) || null;
  }

  wet(x: number, z: number): boolean {
    return this.water.contains(x, z);
  }

  get indoors(): boolean {
    return this.interiors.inside;
  }

  get honking(): boolean {
    return !!this.driving && this.state.horn;
  }

  private welcome() {
    this.hud.toast(
      this.input.touch
        ? 'Welcome to Antwerp! Joystick to walk, E to steal a car.'
        : 'Welcome to Antwerp! WASD to walk, E to steal a car.',
      5000,
    );
  }

  addVehicle(v: Vehicle) {
    this.vehicles.push(v);
    this.vehicleByBody.set(v.body.handle, v);
    this.physics.owners.set(v.body.collider(0).handle, { kind: 'vehicle', entity: v });
    if (v.trailer) this.physics.owners.set(v.trailer.body.collider(0).handle, { kind: 'vehicle', entity: v });
    if (isBus(v.spec)) this.buses.adopt(v);
  }

  removeVehicle(v: Vehicle) {
    // Once only: a car can be removed twice (sunk, then evicted by multiplayer), and a second Rapier remove panics the wasm.
    const i = this.vehicles.indexOf(v);
    if (i < 0) return;
    this.vehicles.splice(i, 1);
    const s = this.sinking.indexOf(v);
    if (s >= 0) this.sinking.splice(s, 1);
    this.vehicleByBody.delete(v.body.handle);
    if (v.trailer) this.physics.remove(v.trailer.body);
    this.physics.remove(v.body);
    this.buses.forget(v);
  }

  private syncVehicles() {
    for (const v of this.vehicles) v.awake = false;
    this.physics.world.forEachActiveRigidBody((body) => {
      const v = this.vehicleByBody.get(body.handle);
      if (v) {
        v.sync();
        v.awake = true;
      }
    });
  }

  private parkCars(count: number, onTramTrack: ReturnType<typeof trackTest>) {
    const rand = mulberry32(2000); // fixed seed: every player gets the same parked cars ('took' messages rely on it)
    const segments: { x0: number; z0: number; x1: number; z1: number; len: number; w: number }[] = [];
    let total = 0;
    for (const e of this.drive.edges) {
      if (e.w < (e.o ? 6.6 : 10.4) || e.s > 14) continue;
      for (let i = 0; i < e.p.length - 2; i += 2) {
        const [x0, z0, x1, z1] = [e.p[i], e.p[i + 1], e.p[i + 2], e.p[i + 3]];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 8) continue;
        segments.push({ x0, z0, x1, z1, len, w: e.w });
        total += len;
      }
    }
    const weights = VEHICLE_TYPES.reduce((s, [, w, p = w]) => s + p, 0);
    const pickType = (): VehicleSpec => {
      let r = rand() * weights;
      for (const [spec, w, p = w] of VEHICLE_TYPES) if ((r -= p) < 0) return spec;
      return VEHICLE_TYPES[0][0];
    };

    let parked = 0;
    for (let attempt = 0; attempt < count * 3 && parked < count; attempt++) {
      let d = rand() * total;
      const s = segments.find((seg) => (d -= seg.len) < 0) ?? segments[segments.length - 1];
      const t = 0.15 + rand() * 0.7;
      const side = rand() < 0.5 ? 1 : -1;
      const ux = (s.x1 - s.x0) / s.len, uz = (s.z1 - s.z0) / s.len;
      const spec = pickType();
      const off = side * (s.w / 2 - spec.width / 2 - 0.2);
      const x = s.x0 + (s.x1 - s.x0) * t - uz * off;
      const z = s.z0 + (s.z1 - s.z0) * t + ux * off;
      const angle = Math.atan2(uz, ux) + (side > 0 ? 0 : Math.PI);
      if (this.physics.boxOverlaps(x, z, angle, spec.length / 2 + 0.4, spec.width / 2 + 0.1)) continue;
      if ([-0.5, 0, 0.5].some((k) => onTramTrack(x + ux * k * spec.length, z + uz * k * spec.length, TRAM_HALF + spec.width / 2))) continue;
      if (Math.hypot(x - this.start.x, z - this.start.z) < 3 || this.water.contains(x, z)) continue;
      const v = new Vehicle(this.physics.world, spec, paintFor(spec, rand), x, z, angle);
      v.body.sleep();
      this.addVehicle(v);
      parked++;
    }
  }

  fixedUpdate(dt: number) {
    const input = this.state;
    for (const v of this.vehicles) v.savePrev();
    this.player.savePrev();
    this.peds.savePrev();
    this.cyclists.savePrev();
    this.trams.savePrev();
    this.buses.savePrev();
    this.multiplayer?.step(dt);

    if (input.action) {
      input.action = false;
      const door = this.doorNearby();
      if (this.driving) this.exitVehicle();
      else if (this.tram) this.exitTram();
      else if (this.indoors) {
        if (this.interiors.atExit(this.player.x, this.player.z)) this.leaveBuilding();
      } else if (door) this.enterBuilding(door);
      else this.takeNearest();
    }
    if (input.punch) {
      input.punch = false;
      if (!this.driving && !this.tram) this.throwPunch();
    }
    if (input.siren) {
      input.siren = false;
      if (this.driving && isEmergency(this.driving.spec)) this.driving.siren = !this.driving.siren;
    }
    if (this.driving) {
      // The pedal bike sprints on stamina; motor vehicles boost freely.
      const pedalBike = this.driving.spec.name === 'bike';
      const pedalling = this.player.exert(pedalBike && input.sprint && input.throttle > 0.1, dt);
      this.driving.controls = { steer: input.steer, throttle: input.throttle, handbrake: input.handbrake, boost: pedalBike ? pedalling : input.sprint };
    } else if (this.tram) {
      this.player.exert(false, dt);
      this.tram.controls = { throttle: input.throttle, brake: input.handbrake };
    } else this.player.step(input.throttle, input.steer, input.sprint, this.rig.yaw, dt);
    if (this.player.landed) this.landPunch();

    const focus = this.focus;
    this.traffic.pursue(this.wanted.units, this.wanted.level ? this.trackSuspect() : null);
    this.traffic.update(dt, focus.x, focus.z);
    if (this.steps % 15 === 0) for (const v of this.traffic.police) this.peds.clearWay(v.x, v.z, v.angle);
    this.peds.update(dt, focus.x, focus.z);
    this.cyclists.update(dt, focus.x, focus.z);
    this.trams.update(dt, focus.x, focus.z);
    this.buses.update(dt, focus.x, focus.z);
    for (const v of this.vehicles) v.step(dt);
    // A velocity change beyond what brakes can do means the player's car hit something.
    const car = this.driving, before = car && car.body.linvel();
    const walking = !car && !this.tram ? this.player.body.linvel() : null;
    this.physics.step();
    this.syncVehicles();
    this.crash.quiet += dt;
    if (car && before) {
      const after = car.body.linvel();
      const impact = Math.hypot(after.x - before.x, after.y - before.y);
      if (impact > 2.5) {
        if (twoWheeled(car.spec)) this.sound.bump(car.x, car.z);
        else this.sound.crash(impact);
        const was = this.crash.quiet > CRASH_SETTLE ? 0 : this.crash.dv;
        let dv = was + this.impactFelt(car, before, impact);
        if (isMotorbike(car.spec) && impact > 9 && this.throwOff(car, before)) dv = Math.max(dv, Math.hypot(before.x, before.y));
        const k = exposure(car);
        this.hurt(crashHurt(dv, k) - crashHurt(was, k));
        this.crash = { dv, quiet: 0 };
        // Patrol cars only: in a chase the hit is as often theirs.
        const cop = this.vehicles.find((v) => isPolice(v.spec) && this.traffic.has(v) && !this.traffic.police.includes(v) && Math.hypot(v.x - car.x, v.z - car.z) < (v.spec.length + car.spec.length) / 2 + 1);
        if (cop && this.rammed(car, before, cop)) this.crime(cop.x, cop.z, true);
      }
    }
    if (this.tram) this.rideAlong(this.tram);
    this.knockThingsOver();
    this.handleContacts(walking);
    for (const [x, z] of this.trams.bells.splice(0)) this.sound.bell(x, z);
    for (const honks of [this.traffic.honks, this.buses.honks, this.multiplayer?.honks ?? []]) {
      for (const [x, z] of honks.splice(0)) this.sound.honk(x, z);
    }
    for (const [x, z] of [...(this.multiplayer?.bells.splice(0) ?? []), ...this.cyclists.bells.splice(0)]) this.sound.bikeBellAt(x, z);
    this.checkWater(dt);
    if (this.defeat > 0) {
      if ((this.defeat -= dt) <= 0) this.respawn();
    } else {
      this.player.recover(dt);
      this.updateWanted(dt);
    }
    this.steps++;
  }

  private trackSuspect(): Suspect {
    const s = this.suspect, car = this.driving, tram = this.tram, t = car ?? this.player;
    if (tram) {
      const angle = tram.sections[0].rotation();
      [s.vx, s.vz] = [Math.cos(angle) * tram.speed, Math.sin(angle) * tram.speed];
    } else {
      const v = t.body.linvel();
      [s.vx, s.vz] = [v.x, v.y];
    }
    s.x = t.x;
    s.z = t.z;
    s.speed = this.wanted.speed;
    // Two-wheelers get pulled over, not rammed; people on foot never.
    s.ram = this.wanted.ramming && (!!tram || (!!car && !twoWheeled(car.spec)));
    s.hidden = this.indoors;
    s.car = car;
    return s;
  }

  private updateWanted(dt: number) {
    if (!this.wanted.level) return;
    const s = this.suspect;
    const still = this.player.down > 0 || Math.hypot(s.vx, s.vz) < 2.5; // m/s
    const reachable = !this.indoors && !this.player.swimming && !this.driving?.afloat;
    const outcome = this.wanted.update(dt, this.traffic.spotted, still && reachable && this.traffic.pinned(s.x, s.z));
    if (outcome === 'arrested') this.die(true);
    else if (outcome === 'lost') this.hud.toast(pick(['You lost them.', 'Lost the police.', 'They gave up looking.']));
  }

  private crime(x: number, z: number, againstPolice = false) {
    if (this.defeat > 0) return;
    const first = !this.wanted.level, witnessed = againstPolice || this.traffic.witness(x, z);
    if (witnessed || !first) this.traffic.reveal(x, z); // once wanted, every crime gives you away
    if (this.wanted.crime(witnessed)) {
      this.hud.toast(first ? pick(['The police saw that! Get out of sight to lose them.', 'Politie! Lose them.', 'Wanted! Break their line of sight.']) : 'More police on the way.');
    }
  }

  /** You into it, not it (or another one shoving you) into you. */
  private rammed(car: Vehicle, before: { x: number; y: number }, cop: Vehicle): boolean {
    if (this.state.throttle < 0.2) return false;
    const dx = cop.x - car.x, dz = cop.z - car.z, d = Math.hypot(dx, dz) || 1;
    const mine = (before.x * dx + before.y * dz) / d;
    const v = cop.body.linvel(), theirs = -(v.x * dx + v.y * dz) / d;
    return mine > 3 && mine > theirs;
  }

  private handleContacts(walking: { x: number; y: number } | null) {
    const driven = this.tram;
    for (const [a, b] of this.physics.contacts) {
      for (const [who, what] of [[a, b], [b, a]] as [Owner, Owner][]) {
        if (driven && who.kind === 'vehicle' && what.entity === driven) {
          const v = who.entity as Vehicle;
          if (twoWheeled(v.spec)) this.sound.bump(v.x, v.z);
          else if (Math.abs(driven.speed) > 2.5) this.sound.crash(Math.abs(driven.speed));
        }
        if (who.kind !== 'ped' && who.kind !== 'player' && who.kind !== 'cyclist') continue;
        if (what.kind !== 'vehicle' && what.kind !== 'tram' && what.kind !== 'bus' && what.kind !== 'cyclist') continue;
        if (who.kind === 'cyclist' && what.kind === 'cyclist') continue;
        let vx: number, vz: number, from: { x: number; y: number };
        if (what.kind === 'tram' || what.kind === 'bus') {
          const it = what.entity as Tram | Bus;
          const angle = it.sections[0].rotation();
          [vx, vz] = [Math.cos(angle) * it.speed, Math.sin(angle) * it.speed];
          from = it.sections[0].translation();
        } else if (what.kind === 'vehicle' && (what.entity as Vehicle).remote) {
          // Another player's car: its body's velocity is the network catching up, not how fast they drive.
          const it = what.entity as Vehicle;
          [vx, vz] = [Math.cos(it.angle) * it.animatedSpeed, Math.sin(it.angle) * it.animatedSpeed];
          from = it.body.translation();
        } else {
          const body = (what.kind === 'cyclist' ? (what.entity as Rider) : (what.entity as Vehicle)).body;
          const v = body.linvel();
          [vx, vz] = [v.x, v.y];
          from = body.translation();
        }
        const speed = Math.hypot(vx, vz);
        const bike = what.kind === 'cyclist' || (what.kind === 'vehicle' && twoWheeled((what.entity as Vehicle).spec));
        if (who.kind === 'cyclist') {
          const r = who.entity as Rider;
          if (this.cyclists.hit(r, from.x, from.y, vx, vz, bike)) {
            const t = r.body.translation();
            this.sound.bump(t.x, t.y);
            if (what.entity === this.driving || what.entity === this.tram) this.crime(t.x, t.y);
          }
          continue;
        }
        if (who.kind === 'ped' && speed > (bike ? 4.5 : 2.5)) {
          const ped = who.entity as Ped;
          if (ped.state !== 'down') {
            const t = ped.body.translation();
            this.sound.bump(t.x, t.y);
            if (what.entity === this.driving || what.entity === this.tram) this.crime(t.x, t.y);
          }
          this.peds.knockDown(ped, vx, vz, speed);
        }
        if (who.kind === 'player' && walking && this.player.down <= 0) {
          // Closing speed, so a car rolling away or a tram brushing past doesn't floor you.
          const dx = this.player.x - from.x, dz = this.player.z - from.y, d = Math.hypot(dx, dz) || 1;
          const closing = ((vx - walking.x) * dx + (vz - walking.y) * dz) / d;
          if (closing <= 4) continue;
          this.player.down = 1.6;
          this.player.body.setLinvel({ x: vx * 0.5, y: vz * 0.5 }, true);
          this.sound.bump(this.player.x, this.player.z);
          const heavy = what.kind === 'tram' || what.kind === 'bus' || (what.kind === 'vehicle' && (isBus((what.entity as Vehicle).spec) || isTruck((what.entity as Vehicle).spec)));
          this.hurt(closing * (heavy ? 7 : bike ? 2 : 4));
        }
      }
    }
  }

  private hurt(amount: number) {
    if (amount <= 0 || this.defeat > 0) return;
    const felt = amount >= 1;
    if (felt) this.hud.hurt(amount / MAX_HEALTH);
    if (this.player.hurt(amount, felt)) this.die();
  }

  /** A remote car is kinematic and won't give way: count the hit as two equal cars meeting. */
  private impactFelt(car: Vehicle, before: { x: number; y: number }, impact: number): number {
    const other = this.vehicles.find((v) => v.remote && Math.hypot(v.x - car.x, v.z - car.z) < (v.spec.length + car.spec.length) / 2 + 1);
    return other ? Math.min(impact, (Math.hypot(before.x, before.y) + Math.abs(other.animatedSpeed)) / 2) : impact;
  }

  private die(arrested = false) {
    this.arrested = arrested;
    this.wanted.clear();
    this.defeat = DEFEAT_TIME;
    this.state = { ...DEAD };
    this.hud.defeat(DEFEAT_TIME);
    this.hud.toast(arrested ? 'Arrested.' : 'Knocked out.');
    this.worldMap.toggle(false);
    // Dying mid-doorway: cancel, else the next frame carries the body inside.
    if (this.entering) {
      this.entering = null;
      this.hud.fade();
    }
    if (!arrested && !this.driving && !this.tram) this.player.down = DEFEAT_TIME + 1;
  }

  private respawn() {
    this.dismount();
    const [x, z, heading] = this.arrested ? this.policeStation : this.hospital;
    this.player.place(x, z, heading);
    this.player.revive();
    this.traffic.update(0, x, z, true);
    this.peds.update(0, x, z, true);
    this.cyclists.update(0, x, z, true);
    this.state = { ...IDLE };
    this.rig.yaw = heading;
    this.rig.snap();
    this.hud.defeat(0);
    this.hud.fade();
    this.hud.toast(pick(this.arrested
      ? ['Released from the Oudaan police tower.', 'Let off with a warning this time.', 'Statement taken. Free to go.']
      : ['Patched up at ZNA Sint-Elisabeth.', 'Discharged. Look both ways this time.', 'The nurses say: mind the trams.']));
    this.arrested = false;
  }

  private throwPunch() {
    const p = this.player;
    const t = this.peds.inFront(p.x, p.z, p.heading, PUNCH_SEEK, 1.2)?.body.translation();
    if (p.startPunch(t ? Math.atan2(t.y - p.z, t.x - p.x) : p.heading)) this.sound.swing(p.x, p.z);
  }

  private landPunch() {
    const p = this.player;
    const ped = this.peds.inFront(p.x, p.z, p.heading, PUNCH_REACH, 0.9);
    if (!ped) return;
    const t = ped.body.translation();
    this.sound.punch(t.x, t.y);
    this.peds.knockDown(ped, t.x - p.x, t.y - p.z, 5);
    this.peds.scare(p.x, p.z, 20);
    this.crime(t.x, t.y);
  }

  private knockThingsOver() {
    for (const v of this.vehicles) {
      // Not traffic: AI drivers clip posts at corners and would wreck the street. Pursuers do; bikes go round.
      if (!v.awake || v.sink > 0 || twoWheeled(v.spec) || (this.traffic.has(v) && !this.traffic.police.includes(v))) continue;
      this.breakables.touching(v.x, v.z, v.angle, v.spec.length / 2, v.spec.width / 2, (id) => this.knockOver(id, v));
      if (this.scooters.knock(v)) this.sound.knock(v.x, v.z, Math.abs(v.forwardSpeed), true);
    }
  }

  private knockOver(id: number, car: Vehicle) {
    const v = car.body.linvel();
    const thing = this.breakables.knock(id, car.x, car.z, v.x, v.y);
    if (!thing) return;
    car.body.setLinvel({ x: v.x * thing.keep, y: v.y * thing.keep }, true);
    this.sound.knock(thing.x, thing.z, Math.hypot(v.x, v.y), thing.metal);
  }

  private checkWater(dt: number) {
    const car = this.driving;
    if (car) {
      const wet = this.water.contains(car.x, car.z);
      if (wet && !car.afloat) this.splashDown(car.x, car.z);
      car.afloat = wet;
      car.sink = wet ? Math.min(car.sink + dt * 0.8, FLOAT_DEPTH) : Math.max(car.sink - dt * 0.8, 0);
    } else if (!this.tram) {
      const p = this.player;
      const wet = this.water.contains(p.x, p.z);
      if (wet && !p.swimming) this.splashDown(p.x, p.z);
      p.swimming = wet;
    }
    if (this.steps % 15 === 0) {
      for (const v of this.vehicles) {
        if (v === this.driving || v.remote || !(v.awake || v.afloat) || this.sinking.includes(v)) continue;
        if (!this.water.contains(v.x, v.z)) continue;
        this.sinking.push(v);
        this.traffic.release(v);
        if (!v.afloat) this.splashDown(v.x, v.z);
        v.driven = v.afloat = false;
        v.sink = Math.max(v.sink, 0.01);
      }
      for (const p of [...this.peds.peds]) {
        const t = p.body.translation();
        if (this.water.contains(t.x, t.y)) {
          this.splashDown(t.x, t.y);
          this.peds.remove(p);
        }
      }
    }
    for (const v of [...this.sinking]) {
      v.sink += dt * 0.9;
      if (v.sink > 3) this.removeVehicle(v);
    }
  }

  private splashDown(x: number, z: number) {
    this.splash.burst(x, z);
    this.sound.splash(x, z);
  }

  /** Single player stops the world while the map is up; multiplayer can't. */
  get paused() {
    return this.worldMap.open && !this.multiplayer;
  }

  get mapOpen() {
    return this.worldMap.open;
  }

  sampleInput() {
    if (this.startWanted) {
      this.wanted.set(this.startWanted);
      this.startWanted = 0;
    }
    const s = this.input.sample();
    if (this.defeat > 0) {
      this.state = { ...DEAD };
      return;
    }
    if (this.worldMap.open) {
      this.state = { ...IDLE };
      return;
    }
    // Keep an action press until a fixed step consumes it (a frame can have zero steps on fast displays).
    this.state = { ...s, action: s.action || this.state.action, punch: s.punch || this.state.punch, siren: s.siren || this.state.siren };
    this.rig.look(s.lookX, s.lookY);
    if (s.view) this.toggleView();
  }

  setFirstPerson(on: boolean) {
    this.rig.setFirstPerson(on);
    this.hud.setView(on);
  }

  private toggleView() {
    this.setFirstPerson(!this.rig.firstPerson);
  }

  private controlLines(): string[] {
    const common = ['V — Camera', 'P — Map', ...(this.multiplayer ? ['T — Chat'] : [])];
    const v = this.driving;
    if (v) {
      const bike = twoWheeled(v.spec), moto = isMotorbike(v.spec);
      const lines = [bike || moto ? 'WASD — Ride' : 'WASD — Drive'];
      if (v.spec.sprintSpeed !== undefined || v.spec.maxSpeed > 15.3) lines.push(`Shift — ${v.spec.name === 'bike' ? 'Sprint' : 'Faster'}`);
      if (!bike && !moto) lines.push('Space — Handbrake');
      lines.push(`H — ${bike ? 'Bell' : 'Horn'}`);
      if (isEmergency(v.spec)) lines.push('Q — Siren');
      if (!bike && !moto && !isBus(v.spec) && !isEmergency(v.spec)) lines.push('R — Radio');
      lines.push(`E — ${bike || moto ? 'Get off' : 'Get out'}`);
      return [...lines, ...common];
    }
    if (this.tram) return ['WASD — Drive', 'Space — Brake', 'E — Get out', ...common];
    return ['WASD — Move', 'Shift — Sprint', 'R — Punch', 'E — Enter / use', ...common];
  }

  render(alpha: number, dt: number) {
    if (this.entering && --this.entering.frames <= 0) this.finishEntering();
    const car = this.driving;
    const zoom = this.rig.camera.aspect < 1 ? 1.3 : 1;
    if (car) {
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
      this.rig.update({ x, z, height, heading, speed, distance: distance * zoom, eye, eyeForward }, dt);
      this.hud.setSpeed(speed * 3.6);
      const verb = car.spec.name === 'bike' && this.dockToReturn(car) ? 'Return bike' : bike || moto ? 'Get off' : 'Get out';
      this.hud.setHint(speed < 8 ? this.keyHint(verb) : '');
      this.updateStreetName(x, z, dt);
    } else if (this.tram) {
      const tram = this.tram;
      const cab = this.trams.pose(tram, 0, alpha);
      const speed = Math.abs(tram.speed);
      // Eye at the front of the 7.2 m cab, just above the roof.
      this.rig.update({ x: cab.x, z: cab.z, height: 2.4, heading: cab.angle, speed, distance: 13 * zoom, eye: 3.1, eyeForward: 3.35 }, dt);
      this.hud.setSpeed(speed * 3.6);
      const end = tram.s >= tram.run.len - 0.5 || tram.s <= tram.length + 0.5;
      this.hud.setHint(speed < TRAM_EXIT_SPEED ? this.keyHint(end ? 'End of the line. Get out' : 'Get out') : '');
      this.updateStreetName(cab.x, cab.z, dt);
    } else {
      this.player.object.visible = !this.rig.firstPerson; // hide your own avatar in first person
      this.player.render(alpha, dt, this.crowd);
      const x = this.player.object.position.x, z = this.player.object.position.z;
      const room = this.interiors.inside ? this.interiors : null;
      this.rig.update({ x, z, height: this.player.swimming ? 0.6 : 1.5, heading: this.player.heading, stride: this.player.stride, speed: 0, distance: (room ? 3.2 : 4.2) * zoom, sprint: this.player.sprinting, eye: this.player.swimming ? 0.5 : 1.6, room: room ?? undefined }, dt);
      this.hud.setSpeed(null);
      const door = this.doorNearby();
      if (room) this.hud.setHint(room.atExit(this.player.x, this.player.z) ? this.keyHint('Leave') : '');
      else if (door) this.hud.setHint(this.keyHint(`Enter ${door.name}`));
      else {
        const verb = this.rideVerb();
        this.hud.setHint(verb && this.keyHint(verb));
      }
    }
    if (this.intro) this.playIntro(dt);
    const t = car ?? this.player;
    const heading = car ? car.angle : this.player.heading;
    const motor = car && !twoWheeled(car.spec) ? car : null;
    this.hud.setHealth(this.player.health / MAX_HEALTH);
    this.hud.setStamina(this.player.stamina);
    this.hud.setPolice(this.wanted.status);
    if (!this.indoors) this.updateDistrict(t.x, t.z, dt);
    if (!this.input.touch) this.hud.setControls(this.controlLines()); // touch shows on-screen buttons instead
    if (this.gps.update(t.x, t.z, dt, !!motor, motor ? motor.angle : null)) this.hud.toast('You have arrived');
    this.minimap.update(t.x, t.z, this.rig.yaw, heading, this.multiplayer?.others, this.gps, this.traffic.police);
    this.worldMap.update(t.x, t.z, heading, this.multiplayer?.others);
    const camera = this.rig.camera.position;
    this.sound.listen(camera.x, camera.z, this.rig.yaw);
    const cycling = car?.spec.name === 'bike', scooting = car?.spec.name === 'scooter';
    if (car && !cycling) this.sound.engineUpdate(car.forwardSpeed * 3.6, this.state.throttle, dt);
    if (this.tram) this.sound.engineUpdate(this.tram.speed * 3.6, this.state.handbrake ? 1 : this.state.throttle, dt);
    this.sound.horn(!!car && !cycling && !scooting && this.state.horn);
    this.sound.sirens(this.traffic.sirens, car?.siren ? car : null);
    if (this.state.horn && !this.hornHeld) {
      if (cycling || scooting) this.sound.bikeBell();
      else if (this.tram) this.sound.bell(this.player.x, this.player.z);
    }
    this.hornHeld = this.state.horn;
    this.renderer.update(this.vehicles, camera, alpha);
    this.bikes.update(camera, this.vehicles, cycling && isVelo(car) ? car : null, this.player.avatar, alpha, dt);
    this.scooters.update(camera, this.vehicles, scooting ? car : null, this.player.avatar, alpha, dt);
    this.motorbikes.update(camera, this.vehicles, car && isMotorbike(car.spec) ? car : null, this.player.avatar, alpha, dt);
    this.peds.render(alpha, camera);
    this.cyclists.render(alpha, camera, this.vehicles, cycling && !isVelo(car) ? car : null, this.player.avatar);
    this.interiors.render(dt, camera);
    this.multiplayer?.render(alpha, dt);
    this.crowd.finish();
    this.trams.render(alpha);
    this.buses.render(alpha);
    this.splash.update(dt);
    this.breakables.update(dt, t.x, t.z);
  }

  private keyHint(verb: string) {
    return this.input.touch ? `${verb}: E` : `${verb} [E]`;
  }

  private rideVerb(): string {
    const near = this.nearestRide();
    if (!near) return '';
    if ('dock' in near) return 'Take a Velo bike';
    if ('scooter' in near) return `Ride this ${BRANDS[near.scooter.brand].name}`;
    if ('cyclist' in near) return this.input.touch ? 'Steal bike' : 'Steal this bike';
    if ('tram' in near) return `Drive tram ${near.tram.run.line}`;
    if ('bus' in near) return `Steal bus ${near.bus.run.line}`;
    const { spec, colour } = near.vehicle;
    if (spec.name === 'bike') return 'Ride this bike';
    if (isBus(spec)) return 'Drive this bus';
    if (spec.name === 'scooter') return `Ride this ${BRANDS[brandOf(colour)].name}`;
    if (isMotorbike(spec)) return `${this.input.touch ? 'Steal' : 'Steal this'} ${spec.name}`;
    return `${this.input.touch ? 'Steal' : 'Steal this'} ${spec.label ?? 'car'}`;
  }

  private playIntro(dt: number) {
    const intro = this.intro!;
    const s = this.state;
    const busy = s.steer || s.throttle || s.lookX || s.lookY || s.action;
    intro.t += dt * (busy ? 3 : 1);
    const k = THREE.MathUtils.smoothstep(intro.t, 1.6, 4.4);
    const camera = this.rig.camera;
    camera.position.lerpVectors(intro.from, camera.position, k);
    camera.lookAt(new THREE.Vector3().lerpVectors(intro.look, this.rig.target, k));
    if (k >= 1) {
      this.intro = null;
      this.welcome();
    }
  }

  private updateStreetName(x: number, z: number, dt: number) {
    this.street.timer -= dt;
    if (this.street.timer > 0) return;
    this.street.timer = 0.5;
    const near = this.drive.nearest(x, z, 12);
    const name = near ? (this.drive.edges[near.edge].n ?? '') : '';
    if (name && name !== this.street.name) this.hud.setStreet(name);
    if (name) this.street.name = name;
  }

  private updateDistrict(x: number, z: number, dt: number) {
    const d = this.district;
    // Not under the title card or fly-in, so the first name is seen.
    if (!this.districts || this.intro || document.body.classList.contains('on-title') || (d.timer -= dt) > 0) return;
    d.timer = 0.5;
    const name = this.districts.at(x, z);
    if (!name || name === d.name) return;
    d.name = name;
    const now = performance.now();
    if (now - (d.shown.get(name) ?? -Infinity) < DISTRICT_REPEAT * 1000) return;
    d.shown.set(name, now);
    this.hud.setDistrict(name);
  }

  get focus(): THREE.Vector3 {
    const t = this.driving ?? this.player;
    return new THREE.Vector3(t.x, 0, t.z);
  }

  private doorNearby(): Door | null {
    if (this.driving || this.tram || this.indoors || this.player.down > 0) return null;
    return this.interiors.doorAt(this.player.x, this.player.z);
  }

  private enterBuilding(door: Door) {
    if (this.entering) return;
    this.hud.blackout();
    this.entering = { door, from: { x: this.player.x, z: this.player.z }, frames: 2 };
  }

  private finishEntering() {
    const { door, from } = this.entering!;
    this.entering = null;
    const spot = this.interiors.enter(door, from.x, from.z, this.player.avatar);
    this.hud.fade();
    if (!spot) return;
    this.player.place(spot.x, spot.z, spot.heading);
    this.rig.yaw = spot.heading;
    this.rig.pitch = 0.18;
    this.rig.snap();
    this.hud.setStreet(door.name);
    this.sound.indoors(true);
    if (door.style !== 'plate' && door.style !== 'public' && door.style !== 'culture') this.sound.chime();
  }

  private leaveBuilding() {
    const spot = this.interiors.leave();
    this.player.place(spot.x, spot.z, spot.heading);
    this.rig.yaw = spot.heading;
    this.rig.snap();
    this.hud.fade();
    this.sound.indoors(false);
  }

  private nearestVehicle(): [Vehicle | null, number] {
    let best: Vehicle | null = null;
    let bestD = ENTER_RANGE;
    const px = this.player.x, pz = this.player.z;
    for (const v of this.vehicles) {
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

  private nearestRide():
    | { dock: NonNullable<ReturnType<Bikes['dockedNear']>> } | { scooter: Parked } | { cyclist: Rider } | { vehicle: Vehicle } | { tram: Tram } | { bus: Bus } | null {
    if (this.player.down > 0) return null;
    const [vehicle, vd] = this.nearestVehicle();
    const cyclist = this.cyclists.nearest(this.player.x, this.player.z, STEAL_RANGE);
    if (cyclist) {
      const t = cyclist.body.translation();
      if (!vehicle || Math.hypot(t.x - this.player.x, t.y - this.player.z) < vd) return { cyclist };
    }
    const dock = this.bikes.dockedNear(this.player.x, this.player.z);
    if (dock && (!vehicle || Math.hypot(dock.x - this.player.x, dock.z - this.player.z) - 0.3 < vd)) return { dock };
    const scooter = this.scooters.nearest(this.player.x, this.player.z);
    if (scooter && (!vehicle || Math.hypot(scooter.x - this.player.x, scooter.z - this.player.z) - 0.3 < vd)) return { scooter };
    const tram = this.trams.near(this.player.x, this.player.z, ENTER_RANGE);
    const bus = this.buses.near(this.player.x, this.player.z, ENTER_RANGE);
    if (bus && bus.distance < vd && (!tram || bus.distance < tram.distance)) return { bus: bus.bus };
    if (tram && tram.distance < vd) return { tram: tram.tram };
    return vehicle ? { vehicle } : null;
  }

  private takeNearest() {
    const near = this.nearestRide();
    if (!near) return;
    if ('vehicle' in near) this.enterVehicle(near.vehicle);
    else if ('cyclist' in near) this.stealBike(near.cyclist);
    else if ('tram' in near) this.boardTram(near.tram);
    else if ('bus' in near) this.hijackBus(near.bus);
    else if ('scooter' in near) {
      const pose = this.scooters.take(near.scooter);
      const scooter = new Vehicle(this.physics.world, SCOOTER_SPEC, pose.colour, pose.x, pose.z, pose.heading);
      this.addVehicle(scooter);
      this.mount(scooter);
      this.rig.yaw = pose.heading;
    } else {
      const pose = this.bikes.take(near.dock);
      const bike = new Vehicle(this.physics.world, BIKE_SPEC, VELO_RED, pose.x, pose.z, pose.heading);
      this.addVehicle(bike);
      this.mount(bike);
      this.rig.yaw = pose.heading;
    }
  }

  private stealBike(r: Rider) {
    const b = this.cyclists.steal(r);
    const c = Math.cos(b.heading), s = Math.sin(b.heading);
    const bike = new Vehicle(this.physics.world, BIKE_SPEC, b.colour, b.x, b.z, b.heading);
    bike.body.setLinvel({ x: c * b.speed, y: s * b.speed }, true);
    this.addVehicle(bike);
    // Off to the right, onto the kerb side, and away once they're back up.
    const owner = this.peds.spawnFleeing(b.x - s * 0.9, b.z + c * 0.9, b.avatar);
    this.peds.knockDown(owner, -s, c, 3);
    this.sound.bump(b.x, b.z);
    this.crime(b.x, b.z);
    this.mount(bike, pick(['Hé, mijn fiets!', 'Sorry, I need this more.', "That's my bike now.", 'Fietsdief!']));
    this.rig.yaw = b.heading;
  }

  private dockToReturn(bike: Vehicle) {
    if (!isVelo(bike)) return null;
    if (Math.hypot(bike.x - this.rideStart.x, bike.z - this.rideStart.z) < 4) return null;
    return this.bikes.emptyDockNear(bike.x, bike.z);
  }

  private takeWheel(v: Vehicle, name = this.vehicleName(v)) {
    this.hud.setVehicle(name);
    this.driving = v;
    this.input.seat = isEmergency(v.spec) ? 'emergency' : 'vehicle';
    v.driven = true;
    v.body.wakeUp();
    this.player.hide();
  }

  private vehicleName(v: Vehicle): string {
    if (isVelo(v)) return 'Velo';
    return v.spec.name === 'scooter' ? BRANDS[brandOf(v.colour)].name : VEHICLE_NAMES[v.spec.name];
  }

  private dismount() {
    if (this.driving) {
      this.leaveSeat(this.driving);
      this.sound.engineOff();
      this.sound.radioOff();
      this.sound.horn(false);
    } else if (this.tram) {
      this.trams.leave(this.tram);
      this.tram = null;
      this.input.seat = 'foot';
      this.sound.engineOff();
    }
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
      this.hud.toast(pick([`${name} unlocked. Ride safe!`, `${name} unlocked. Mind the cobbles.`, `${name} unlocked. Max 25 km/h.`, `${name} unlocked. No passengers!`]));
      this.sound.engineOn('scooter');
    } else if (isVelo(ride)) {
      this.hud.toast(pick(['Velo time!', 'Pedal power.', 'Off you go, Antwerp style.', 'Mind the tram rails.']));
    } else this.hud.toast(pick(['Pedal power.', 'Mind the tram rails.', 'Not yours, but hey.']));
    this.takeWheel(ride);
  }

  private standable(x: number, z: number): boolean {
    let free = true;
    this.physics.world.intersectionsWithShape(
      { x, y: z },
      0,
      new RAPIER.Cuboid(0.3, 0.3),
      (collider) => {
        if (collider.parent() === this.driving?.body) return true;
        free = false;
        return false;
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      groups(GROUP.PED, GROUP.STATIC | WHEELS | GROUP.PED),
    );
    return free;
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
    let toast: string;
    const jacked = this.traffic.has(v), police = isPolice(v.spec) && !this.stolenPolice.has(v);
    if (jacked || police) this.crime(v.x, v.z, police);
    if (police) this.stolenPolice.add(v);
    if (jacked) {
      this.traffic.release(v);
      const c = Math.cos(v.angle), s = Math.sin(v.angle);
      this.peds.spawnFleeing(v.x + s * (v.spec.width / 2 + 0.8), v.z - c * (v.spec.width / 2 + 0.8));
      toast = pick(isEmergency(v.spec) ? ['Sorry, officer!', "They'll want that back."] : ['Sorry, sir!', 'Out you get!', "This one's mine now."]);
    } else {
      toast = pick(isMotorbike(v.spec) ? ['Vroom!', 'Hold on tight.', 'Two wheels, full throttle.', 'Not yours, but hey.'] : ['Vroom!', "Let's go!", 'Nice ride.', 'Not yours, but hey.']);
    }
    const radio = !isBus(v.spec) && !isMotorbike(v.spec) && !isEmergency(v.spec);
    const tips = [toast];
    if (isEmergency(v.spec)) tips.push(`${this.input.touch ? 'Tap Siren' : 'Press Q'} for the lights.`);
    if (radio && !this.carTipShown) {
      this.carTipShown = true;
      tips.push(this.input.touch ? 'Tap the station name to change the radio.' : 'Space is the handbrake, H the horn, R the next radio station.');
    }
    this.hud.toast(tips.join(' '), tips.length > 1 ? 6000 : undefined);
    this.takeWheel(v);
    const moto = v.spec.name === 'motorbike' || v.spec.name === 'moped' ? v.spec.name : null;
    this.sound.engineOn(isBus(v.spec) || isTruck(v.spec) ? 'bus' : moto ?? 'car');
    if (radio) this.sound.radioOn();
  }

  private hijackBus(b: Bus) {
    const v = this.buses.hijack(b);
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    const ahead = v.spec.length / 2 - 1.5, side = v.spec.width / 2 + 0.8;
    this.peds.spawnFleeing(v.x + c * ahead + s * side, v.z + s * ahead - c * side);
    this.hud.toast(pick([`Line ${b.run.line} is out of service.`, 'Next stop: wherever you like.', 'Tickets, please!', 'De Lijn is hiring.']));
    this.crime(v.x, v.z);
    this.takeWheel(v, `Bus ${b.run.line}`);
    this.rig.yaw = v.angle;
    this.sound.engineOn('bus');
  }

  private throwOff(v: Vehicle, velocity: { x: number; y: number }): boolean {
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    const behind: [number, number] = [v.x - c * (v.spec.length / 2 + 0.6), v.z - s * (v.spec.length / 2 + 0.6)];
    const spot = this.beside(v.x, v.z, v.angle, v.spec.width / 2) ?? (this.standable(...behind) ? behind : null);
    if (!spot) return false;
    this.dismount();
    this.player.place(spot[0], spot[1], v.angle);
    this.player.down = 2;
    this.player.body.setLinvel({ x: velocity.x * 0.35, y: velocity.y * 0.35 }, true);
    this.rig.yaw = v.angle;
    this.hud.toast(pick(['Ouch!', 'Wipeout!', 'Over the handlebars.']));
    return true;
  }

  private exitVehicle() {
    const v = this.driving!;
    if (Math.abs(v.forwardSpeed) > 8) return;
    const spot = this.beside(v.x, v.z, v.angle, v.spec.width / 2);
    if (!spot) return;
    this.dismount();
    if (v.spec.name === 'bike') {
      const dock = this.dockToReturn(v);
      if (dock) {
        this.bikes.dock(dock);
        this.removeVehicle(v);
        this.hud.toast('Bike returned. Thanks for riding Velo!');
      }
    } else if (v.spec.name === 'scooter') this.hud.toast('Ride ended. Park it neatly!');
    this.player.place(spot[0], spot[1], v.angle);
    this.rig.yaw = v.angle;
  }

  private boardTram(t: Tram) {
    this.trams.board(t);
    this.tram = t;
    this.hud.setVehicle(`Tram ${t.run.line}`);
    this.input.seat = 'vehicle';
    this.player.hide();
    this.rideAlong(t);
    this.rig.yaw = t.sections[0].rotation();
    this.hud.toast(`Line ${t.run.line} to ${t.run.to}. ${pick(['Ding ding!', 'Next stop: wherever you like.', 'De Lijn is hiring.'])}`);
    this.sound.engineOn('tram');
  }

  private rideAlong(t: Tram) {
    const cab = t.sections[0];
    const p = cab.translation();
    this.player.body.setTranslation({ x: p.x, y: p.y }, false);
    this.player.heading = cab.rotation();
    if (t.impact > 2.5) {
      this.sound.crash(t.impact);
      this.hurt(crashHurt(t.impact, TRAM_EXPOSURE));
    }
  }

  private exitTram() {
    const t = this.tram!;
    if (Math.abs(t.speed) > TRAM_EXIT_SPEED) return;
    const cab = t.sections[0], p = cab.translation(), angle = cab.rotation();
    const spot = this.beside(p.x, p.y, angle, TRAM_WIDTH / 2);
    if (!spot) return;
    this.dismount();
    this.player.place(spot[0], spot[1], angle);
    this.rig.yaw = angle;
  }
}
