import * as THREE from 'three';
import { isVelo, type Bikes } from '../actors/bikes';
import { Buses } from '../actors/buses';
import type { Crowd } from '../actors/crowd';
import { Cyclists } from '../actors/cyclists';
import { Pedestrians } from '../actors/pedestrians';
import { MAX_HEALTH, PLAYER_LOOK, Player } from '../actors/player';
import type { Motorbikes } from '../actors/motorbikes';
import type { Scooters } from '../actors/scooters';
import { Traffic, type Suspect } from '../actors/traffic';
import { Trams, type Tram } from '../actors/trams';
import { isBus, isEmergency, isMotorbike, twoWheeled, type Vehicle } from '../actors/vehicle';
import { VehicleRenderer } from '../actors/vehicleModels';
import type { Input, InputState } from '../core/input';
import { pick } from '../core/util';
import { Sound } from '../audio/sound';
import { Splash } from '../fx/splash';
import type { Multiplayer } from '../net/multiplayer';
import type { Physics } from '../physics/physics';
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
import { trackTest } from '../world/trackClearance';
import { WaterMap } from '../world/water';
import { Boarding, TRAM_EXIT_SPEED } from './boarding';
import { CameraRig } from './cameraRig';
import { Collisions } from './collisions';
import { Gps, Router, snap } from './gps';
import { parkCars } from './parking';
import { controlLines, exitVerb, keyHint, rideVerb } from './prompts';
import { Sinking } from './sinking';
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
const IDLE: InputState = { steer: 0, throttle: 0, handbrake: false, sprint: false, lookX: 0, lookY: 0, action: false, horn: false, punch: false, siren: false, view: false };
const PUNCH_SEEK = 2.2; // m, centre to centre
const PUNCH_REACH = 1.4; // m
const DEFEAT_TIME = 2.5; // s
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
  private renderer: VehicleRenderer;
  private hud = new Hud();
  private minimap: Minimap;
  private worldMap: WorldMap;
  private gps: Gps;
  private sound = new Sound();
  private splash = new Splash();
  private water: WaterMap;
  private drive: NavGraph;
  private boarding: Boarding;
  private collisions: Collisions;
  private sinking: Sinking;
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
  private districts: Districts | null = null;
  private district = { name: '', timer: 0, shown: new Map<string, number>() };
  private hornHeld = false;
  private hospital: [number, number, number];
  private defeat = 0; // s left
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
    readonly bikes: Bikes,
    readonly scooters: Scooters,
    private motorbikes: Motorbikes,
    start: Start = CENTRAAL_START,
  ) {
    this.water = new WaterMap(city);
    this.sinking = new Sinking(this, this.water, this.splash, this.sound);
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
    this.boarding = new Boarding(this, physics, input, this.hud, this.sound);
    this.collisions = new Collisions(this, this.boarding, physics, this.sound, breakables);
    this.hud.viewToggle(() => this.toggleView());
    this.hud.setView(this.rig.firstPerson);

    for (const v of parkCars(physics, this.drive, this.water, trackTest(graph.trams), start, population.parkedCars)) this.addVehicle(v);
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

  get driving(): Vehicle | null {
    return this.boarding.driving;
  }

  get tram(): Tram | null {
    return this.boarding.tram;
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
    this.sinking.forget(v);
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
      if (this.driving) this.boarding.exitVehicle();
      else if (this.tram) this.boarding.exitTram();
      else if (this.indoors) {
        if (this.interiors.atExit(this.player.x, this.player.z)) this.leaveBuilding();
      } else if (door) this.enterBuilding(door);
      else this.boarding.takeNearest();
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
    const car = this.driving, before = car && car.body.linvel();
    const walking = !car && !this.tram ? this.player.body.linvel() : null;
    this.physics.step();
    this.syncVehicles();
    this.collisions.carImpact(dt, car, before, input.throttle);
    if (this.tram) this.boarding.rideAlong(this.tram);
    this.collisions.knockThingsOver();
    this.collisions.handleContacts(walking);
    for (const [x, z] of this.trams.bells.splice(0)) this.sound.bell(x, z);
    for (const honks of [this.traffic.honks, this.buses.honks, this.multiplayer?.honks ?? []]) {
      for (const [x, z] of honks.splice(0)) this.sound.honk(x, z);
    }
    for (const [x, z] of [...(this.multiplayer?.bells.splice(0) ?? []), ...this.cyclists.bells.splice(0)]) this.sound.bikeBellAt(x, z);
    this.sinking.step(dt, this.steps % 15 === 0);
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

  crime(x: number, z: number, againstPolice = false) {
    if (this.defeat > 0) return;
    const first = !this.wanted.level, witnessed = againstPolice || this.traffic.witness(x, z);
    if (witnessed || !first) this.traffic.reveal(x, z); // once wanted, every crime gives you away
    if (this.wanted.crime(witnessed)) {
      this.hud.toast(first ? pick(['The police saw that! Get out of sight to lose them.', 'Politie! Lose them.', 'Wanted! Break their line of sight.']) : 'More police on the way.');
    }
  }

  hurt(amount: number) {
    if (amount <= 0 || this.defeat > 0) return;
    const felt = amount >= 1;
    if (felt) this.hud.hurt(amount / MAX_HEALTH);
    if (this.player.hurt(amount, felt)) this.die();
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
    this.boarding.dismount();
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

  render(alpha: number, dt: number) {
    if (this.entering && --this.entering.frames <= 0) this.finishEntering();
    const car = this.driving, touch = this.input.touch;
    if (car) {
      const { x, z, speed } = this.rig.followVehicle(car, alpha, dt);
      this.hud.setSpeed(speed * 3.6);
      const verb = car.spec.name === 'bike' && this.boarding.dockToReturn(car) ? 'Return bike' : exitVerb(car.spec);
      this.hud.setHint(speed < 8 ? keyHint(verb, touch) : '');
      this.updateStreetName(x, z, dt);
    } else if (this.tram) {
      const tram = this.tram;
      const cab = this.trams.pose(tram, 0, alpha);
      const speed = Math.abs(tram.speed);
      this.rig.followTram(cab.x, cab.z, cab.angle, speed, dt);
      this.hud.setSpeed(speed * 3.6);
      const end = tram.s >= tram.run.len - 0.5 || tram.s <= tram.length + 0.5;
      this.hud.setHint(speed < TRAM_EXIT_SPEED ? keyHint(end ? 'End of the line. Get out' : 'Get out', touch) : '');
      this.updateStreetName(cab.x, cab.z, dt);
    } else {
      this.player.object.visible = !this.rig.firstPerson; // hide your own avatar in first person
      this.player.render(alpha, dt, this.crowd);
      const x = this.player.object.position.x, z = this.player.object.position.z;
      const room = this.interiors.inside ? this.interiors : null;
      this.rig.update({ x, z, height: this.player.swimming ? 0.6 : 1.5, heading: this.player.heading, stride: this.player.stride, speed: 0, distance: room ? 3.2 : 4.2, sprint: this.player.sprinting, eye: this.player.swimming ? 0.5 : 1.6, room: room ?? undefined }, dt);
      this.hud.setSpeed(null);
      const door = this.doorNearby();
      if (room) this.hud.setHint(room.atExit(this.player.x, this.player.z) ? keyHint('Leave', touch) : '');
      else if (door) this.hud.setHint(keyHint(`Enter ${door.name}`, touch));
      else {
        const verb = rideVerb(this.boarding.nearestRide(), touch);
        this.hud.setHint(verb && keyHint(verb, touch));
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
    if (!touch) this.hud.setControls(controlLines(this.driving?.spec ?? null, !!this.tram, !!this.multiplayer)); // touch shows on-screen buttons instead
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
}
