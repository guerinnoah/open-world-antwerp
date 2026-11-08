import * as THREE from 'three';
import { clipForSpeed, phaseStep, type Crowd } from '../actors/crowd';
import { riderClip } from '../actors/motorbikes';
import { PLAYER_LOOK, type Player } from '../actors/player';
import { ARTIC_SPEC, BIKE_SPEC, BUS_SPEC, SCOOTER_SPEC, VEHICLE_TYPES, Vehicle, isMotorbike, twoWheeled, type VehicleSpec } from '../actors/vehicle';
import { coarsePointer } from '../core/quality';
import { lerpPose, pick, wrapAngle } from '../core/util';
import { GROUP, RAPIER, groups, type Physics } from '../physics/physics';
import { Chat } from './chat';
import { Connection, type Status } from './connection';
import {
  FLAG, RELAY_PATH, VEHICLE_KINDS, cleanChat, cleanName, decodeState, encodeState, type PeerInfo,
  type PlayerState, type ServerMessage, type Took,
} from './protocol';
import { Timeline } from './timeline';

interface MultiplayerHost {
  readonly vehicles: readonly Vehicle[];
  readonly player: Player;
  readonly driving: Vehicle | null;
  readonly indoors: boolean;
  readonly honking: boolean;
  addVehicle(v: Vehicle): void;
  removeVehicle(v: Vehicle): void;
  removeParkedScooter(x: number, z: number, colour: number): boolean;
}

interface Peer {
  id: number;
  name: string;
  avatar: number;
  timeline: Timeline;
  state: PlayerState;
  ready: boolean;
  body: RAPIER.RigidBody | null;
  prev: { x: number; z: number };
  pos: { x: number; z: number };
  phase: number;
  car: Vehicle | null;
  honking: boolean;
  label: HTMLDivElement;
  bubble: HTMLDivElement;
  bubbleTimer: number;
}

const SEND_HZ = 15;
const IDLE_HZ = 4;
const SNAP = 4; // m; bigger corrections teleport rather than fling
const LABEL_RANGE = 220;
const NICKNAMES = ['Sinjoor', 'Brabo', 'Schipper', 'Pagadder', 'Lange Wapper', 'Bolleke', 'Tramchauffeur', 'Havenbaron'];

const emptyState = (): PlayerState => ({
  time: 0, mode: 0, x: 0, z: 0, angle: 0, vx: 0, vz: 0, spin: 0, kind: -1, colour: 0, steer: 0, throttle: 0, sink: 0, flags: 0,
});

export function relayUrl(params: URLSearchParams): string | null {
  if (params.has('solo') || (navigator.webdriver && !params.has('mp'))) return null;
  const configured = import.meta.env.VITE_MULTIPLAYER_URL as string | undefined;
  if (configured) return configured;
  // dev and preview servers host the relay (vite.config.ts)
  if (import.meta.env.DEV || params.has('mp')) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${RELAY_PATH}`;
  return null;
}

export class Multiplayer {
  readonly peers = new Map<number, Peer>();
  readonly honks: [number, number][] = [];
  readonly bells: [number, number][] = [];
  readonly connection: Connection;
  readonly name: string;
  private pill = document.createElement('button');
  private chat: Chat;
  private greeted = false;
  private tags = document.createElement('div');
  /** ms, performance.now() base, advanced by the fixed step. */
  private clock = 0;
  private lastSent = { time: -Infinity, mode: -1, kind: -1, flags: -1 };
  private lastDriving: Vehicle | null = null;
  private status: Status = 'connecting';
  private object = new THREE.Object3D();
  private projected = new THREE.Vector3();

  constructor(
    url: string,
    params: URLSearchParams,
    private host: MultiplayerHost,
    private physics: Physics,
    private crowd: Crowd,
    private camera: THREE.Camera,
  ) {
    this.name = pickName(params);
    this.scatter();

    const ui = document.createElement('div');
    ui.id = 'net';
    this.pill.type = 'button';
    this.pill.className = 'pill';
    this.pill.addEventListener('click', () => {
      this.pill.blur();
      void this.invite();
    });
    ui.append(this.pill);
    this.chat = new Chat(this.pill);
    this.chat.onSend = (text) => this.say(text);
    this.tags.id = 'nametags';
    document.body.append(this.tags, ui);

    this.connection = new Connection(url, { name: this.name, look: PLAYER_LOOK });
    this.connection.onMessage = (msg) => this.receive(msg);
    this.connection.onStatus = (status) => {
      this.status = status;
      if (status !== 'online') this.clear();
      this.chat.setEnabled(status === 'online');
      this.refreshPill();
    };
    this.refreshPill();
  }

  get others(): { x: number; z: number; heading: number }[] {
    const list = [];
    for (const p of this.peers.values()) {
      if (p.ready && !(p.state.flags & FLAG.INDOORS)) list.push({ x: p.state.x, z: p.state.z, heading: p.state.angle });
    }
    return list;
  }

  step(dt: number) {
    const now = performance.now();
    this.send(this.clock || now); // pose is from the last step's end: stamp that time
    // physics drops time on slow frames and asleep: stay within 100 ms of real
    this.clock = Math.min(now, Math.max(now - 100, this.clock + dt * 1000));
    this.reportTakenCar();
    for (const peer of this.peers.values()) {
      if (!peer.timeline.sample(this.clock, peer.state)) continue;
      peer.ready = true;
      if (peer.state.mode === 1) this.moveCar(peer, dt);
      else this.moveOnFoot(peer, dt);
    }
  }

  render(alpha: number, dt: number) {
    const cam = this.camera.position;
    const o = this.object;
    for (const peer of this.peers.values()) {
      const s = peer.state;
      if (!peer.ready || s.flags & FLAG.INDOORS) {
        peer.label.hidden = true;
        continue;
      }
      let x: number, z: number, height: number;
      if (peer.car) {
        const car = peer.car;
        const pose = lerpPose(car.prev, car.x, car.z, car.angle, alpha);
        x = pose.x;
        z = pose.z;
        const bike = car.spec.name === 'bike', scooter = car.spec.name === 'scooter', moto = isMotorbike(car.spec);
        height = bike || moto ? 2.3 : scooter ? 2.25 : 2.1;
        if (bike || scooter || moto) {
          o.position.set(x, -Math.min(car.sink, 1.2), z);
          o.rotation.set(car.roll, -pose.angle, 0, 'YXZ');
          o.updateMatrix();
          const distance = Math.hypot(x - cam.x, z - cam.z);
          if (scooter || moto) {
            const clip = moto ? riderClip(car) : 'scoot';
            this.crowd.add(peer.avatar, o.matrix, clip, performance.now() / 1000 / this.crowd.clip(peer.avatar, clip).duration, distance);
          } else this.crowd.add(peer.avatar, o.matrix, 'ride', car.pedals, distance);
        }
      } else {
        x = peer.prev.x + (peer.pos.x - peer.prev.x) * alpha;
        z = peer.prev.z + (peer.pos.z - peer.prev.z) * alpha;
        height = 2.2;
        const down = (s.flags & FLAG.DOWN) !== 0;
        o.position.set(x, down ? 0.25 : -s.sink, z);
        o.rotation.set(0, -s.angle, down ? -Math.PI / 2 : 0, 'XYZ');
        o.updateMatrix();
        const speed = down ? 0 : Math.hypot(s.vx, s.vz);
        const clip = clipForSpeed(speed);
        peer.phase += phaseStep(this.crowd.clip(peer.avatar, clip), speed, dt);
        this.crowd.add(peer.avatar, o.matrix, clip, peer.phase, Math.hypot(x - cam.x, z - cam.z));
      }
      this.placeLabel(peer, x, height - s.sink, z);
    }
  }

  private scatter() {
    const p = this.host.player;
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 2;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (this.physics.boxOverlaps(x, z, 0, 0.5, 0.5)) continue;
      p.place(x, z, p.heading);
      return;
    }
  }

  private receive(msg: ServerMessage) {
    const now = performance.now();
    switch (msg.t) {
      case 'welcome':
        for (const took of msg.taken) this.removeTakenCar(took);
        for (const p of msg.peers) this.addPeer(p, now);
        if (msg.peers.length) this.chat.system(msg.peers.length === 1 ? `${msg.peers[0].name} is here too.` : `${msg.peers.length} other players are here.`);
        if (!this.greeted) this.chat.system(coarsePointer() ? 'Tap 💬 to chat.' : 'Press T to chat.');
        this.greeted = true;
        this.refreshPill();
        break;
      case 'join':
        this.addPeer(msg.peer, now);
        this.chat.system(`${msg.peer.name} joined.`);
        this.refreshPill();
        break;
      case 'leave': {
        const peer = this.peers.get(msg.id);
        if (!peer) break;
        this.removePeer(peer);
        this.chat.system(`${peer.name} left.`);
        this.refreshPill();
        break;
      }
      case 's': {
        const s = decodeState(msg.s);
        if (s) this.peers.get(msg.id)?.timeline.push(s, now);
        break;
      }
      case 'took':
        this.removeTakenCar(msg);
        break;
      case 'chat': {
        const peer = this.peers.get(msg.id);
        const text = cleanChat(msg.text);
        if (!peer || !text) break;
        this.chat.add(peer.name, text);
        this.showBubble(peer, text);
        break;
      }
    }
  }

  private say(text: string) {
    if (!this.connection.online) return;
    this.connection.send({ t: 'chat', text });
    this.chat.add(this.name, text, true);
  }

  private showBubble(peer: Peer, text: string) {
    peer.bubble.textContent = text;
    peer.bubble.hidden = false;
    clearTimeout(peer.bubbleTimer);
    peer.bubbleTimer = window.setTimeout(() => (peer.bubble.hidden = true), 5000 + text.length * 60);
  }

  private addPeer(info: PeerInfo, now: number) {
    if (this.peers.has(info.id)) return;
    const label = document.createElement('div');
    label.className = 'nametag';
    label.hidden = true;
    const bubble = document.createElement('div');
    bubble.className = 'say';
    bubble.hidden = true;
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = info.name;
    label.append(bubble, name);
    this.tags.append(label);
    const peer: Peer = {
      id: info.id, name: info.name, avatar: avatarFor(this.crowd, info.look), timeline: new Timeline(), state: emptyState(),
      ready: false, body: null, prev: { x: 0, z: 0 }, pos: { x: 0, z: 0 }, phase: Math.random(), car: null, honking: false, label,
      bubble, bubbleTimer: 0,
    };
    const s = info.state && decodeState(info.state);
    if (s) peer.timeline.push(s, now);
    this.peers.set(info.id, peer);
  }

  private removePeer(peer: Peer) {
    if (peer.car) this.host.removeVehicle(peer.car);
    if (peer.body) this.physics.remove(peer.body);
    peer.label.remove();
    clearTimeout(peer.bubbleTimer);
    this.peers.delete(peer.id);
  }

  private clear() {
    for (const peer of [...this.peers.values()]) this.removePeer(peer);
  }

  private send(time: number) {
    if (!this.connection.online) return;
    const s = this.localState(time);
    const last = this.lastSent;
    const changed = s.mode !== last.mode || s.kind !== last.kind || s.flags !== last.flags;
    const moving = Math.hypot(s.vx, s.vz) > 0.05 || Math.abs(s.spin) > 0.05 || s.sink > 0;
    if (!changed && time - last.time < 1000 / (moving ? SEND_HZ : IDLE_HZ)) return;
    this.lastSent = { time, mode: s.mode, kind: s.kind, flags: s.flags };
    this.connection.send({ t: 's', s: encodeState(s) });
  }

  private localState(time: number): PlayerState {
    const { driving: car, player, indoors, honking } = this.host;
    if (car) {
      const v = car.body.linvel();
      return {
        time, mode: 1, x: car.x, z: car.z, angle: wrapAngle(car.angle), vx: v.x, vz: v.y, spin: car.body.angvel(),
        kind: VEHICLE_KINDS.indexOf(car.spec.name), colour: car.colour, steer: car.steerSmoothed, throttle: car.controls.throttle,
        sink: car.sink, flags: (honking ? FLAG.HORN : 0) | (car.siren ? FLAG.SIREN : 0),
      };
    }
    const v = player.body.linvel();
    const hidden = indoors || !player.body.isEnabled(); // disabled on foot = driving a tram, not shared
    return {
      time, mode: 0, x: player.x, z: player.z, angle: wrapAngle(player.heading), vx: v.x, vz: v.y, spin: 0, kind: -1, colour: 0,
      steer: 0, throttle: 0, sink: player.sink, flags: (player.down > 0 ? FLAG.DOWN : 0) | (hidden ? FLAG.INDOORS : 0),
    };
  }

  private reportTakenCar() {
    const car = this.host.driving;
    if (car === this.lastDriving) return;
    this.lastDriving = car;
    if (!car || car.remote) return;
    this.connection.send({ t: 'took', x: car.x, z: car.z, kind: VEHICLE_KINDS.indexOf(car.spec.name), colour: car.colour });
  }

  private removeTakenCar(took: Took) {
    const kind = VEHICLE_KINDS[took.kind];
    if (!kind || kind === 'bike') return;
    if (kind === 'scooter' && this.host.removeParkedScooter(took.x, took.z, took.colour)) return;
    for (const v of this.host.vehicles) {
      if (v.remote || v.driven || v.sink > 0 || v === this.host.driving) continue;
      if (v.spec.name !== kind || v.colour !== took.colour || Math.hypot(v.x - took.x, v.z - took.z) > 2) continue;
      this.host.removeVehicle(v);
      return;
    }
  }

  private moveCar(peer: Peer, dt: number) {
    const s = peer.state;
    const kind = VEHICLE_KINDS[s.kind];
    let car = peer.car;
    if (car && (car.spec.name !== kind || car.colour !== s.colour)) {
      this.host.removeVehicle(car);
      car = peer.car = null;
    }
    if (!car) car = peer.car = this.spawnCar(specFor(kind), s);
    car.siren = (s.flags & FLAG.SIREN) !== 0;
    if (peer.body) {
      this.physics.remove(peer.body);
      peer.body = null;
    }
    const t = car.body.translation();
    if (Math.hypot(s.x - t.x, s.z - t.y) > SNAP) {
      car.teleport(s.x, s.z, s.angle);
    } else {
      car.body.setLinvel({ x: (s.x - t.x) / dt, y: (s.z - t.y) / dt }, true);
      car.body.setAngvel(wrapAngle(s.angle - car.body.rotation()) / dt, true);
      car.x = s.x;
      car.z = s.z;
      car.angle = s.angle;
    }
    car.sink = s.sink;
    car.controls.throttle = s.throttle;
    car.steerSmoothed += (s.steer - car.steerSmoothed) * Math.min(1, 10 * dt);
    car.animate(s.vx * Math.cos(s.angle) + s.vz * Math.sin(s.angle), s.spin, s.throttle, dt);

    const honking = (s.flags & FLAG.HORN) !== 0;
    if (honking && !peer.honking) (twoWheeled(car.spec) ? this.bells : this.honks).push([s.x, s.z]);
    peer.honking = honking;
  }

  private spawnCar(spec: VehicleSpec, s: PlayerState): Vehicle {
    const car = new Vehicle(this.physics.world, spec, s.colour, s.x, s.z, s.angle);
    car.body.setBodyType(RAPIER.RigidBodyType.KinematicVelocityBased, true);
    car.remote = car.driven = true;
    this.host.addVehicle(car);
    return car;
  }

  private moveOnFoot(peer: Peer, dt: number) {
    const s = peer.state;
    if (peer.car) this.leaveCar(peer);
    peer.prev.x = peer.pos.x;
    peer.prev.z = peer.pos.z;
    peer.pos.x = s.x;
    peer.pos.z = s.z;
    if (!peer.body) {
      peer.body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased().setTranslation(s.x, s.z));
      // solid to people, not cars: their game decides hits
      this.physics.world.createCollider(RAPIER.ColliderDesc.ball(0.35).setCollisionGroups(groups(GROUP.PED, GROUP.PED)), peer.body);
      peer.prev.x = s.x;
      peer.prev.z = s.z;
    }
    const body = peer.body;
    const hidden = (s.flags & FLAG.INDOORS) !== 0;
    if (body.isEnabled() === hidden) body.setEnabled(!hidden);
    const t = body.translation();
    if (Math.hypot(s.x - t.x, s.z - t.y) > SNAP) {
      body.setTranslation({ x: s.x, y: s.z }, true);
      body.setLinvel({ x: 0, y: 0 }, true);
      peer.prev.x = s.x;
      peer.prev.z = s.z;
    } else {
      body.setLinvel({ x: (s.x - t.x) / dt, y: (s.z - t.y) / dt }, true);
    }
  }

  /** Removed on exit: not left parked in anyone's world. */
  private leaveCar(peer: Peer) {
    this.host.removeVehicle(peer.car!);
    peer.car = null;
  }

  private placeLabel(peer: Peer, x: number, y: number, z: number) {
    const d = this.camera.position.distanceTo(this.projected.set(x, y, z));
    this.projected.project(this.camera);
    const visible = this.projected.z < 1 && d < LABEL_RANGE && Math.abs(this.projected.x) < 1.2 && Math.abs(this.projected.y) < 1.2;
    peer.label.hidden = !visible;
    if (!visible) return;
    const sx = (this.projected.x * 0.5 + 0.5) * innerWidth;
    const sy = (-this.projected.y * 0.5 + 0.5) * innerHeight;
    peer.label.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
    peer.label.style.opacity = String(Math.min(1, 1.6 - (d / LABEL_RANGE) * 1.4).toFixed(2));
  }

  private refreshPill() {
    const others = this.peers.size;
    const text: Record<Status, string> = {
      connecting: 'Connecting…',
      online: others ? `${others + 1} players · Invite` : 'Just you here · Invite',
      offline: 'Offline · reconnecting',
      full: 'Server full · retrying',
      outdated: 'New version: reload to play online',
    };
    this.pill.textContent = text[this.status];
    this.pill.classList.toggle('online', this.status === 'online');
    this.pill.title = this.status === 'online' ? 'Click to copy an invite link.' : '';
  }

  private async invite() {
    if (!this.connection.online) return;
    const url = `${location.origin}${location.pathname}`;
    try {
      if (navigator.share && coarsePointer()) {
        await navigator.share({ title: 'GTA Antwerp', text: 'Come drive around Antwerp with me', url });
      } else {
        await navigator.clipboard.writeText(url);
        this.chat.system('Invite link copied. Friends who open it join you here.');
      }
    } catch {
      this.chat.system(`Invite link: ${url}`);
    }
  }
}

function specFor(kind: string): VehicleSpec {
  const specs = [BUS_SPEC, ARTIC_SPEC, BIKE_SPEC, SCOOTER_SPEC, ...VEHICLE_TYPES.map(([spec]) => spec)];
  return specs.find((spec) => spec.name === kind) ?? VEHICLE_TYPES[0][0];
}

function stored(key: string, value?: string): string | null {
  try {
    if (value !== undefined) localStorage.setItem(key, value);
    return localStorage.getItem(key);
  } catch {
    return value ?? null;
  }
}

function pickName(params: URLSearchParams): string {
  const name =
    cleanName(params.get('name')) ||
    cleanName(stored('gta-antwerp.name')) ||
    `${pick(NICKNAMES)} ${100 + Math.floor(Math.random() * 900)}`;
  return stored('gta-antwerp.name', name) ?? name;
}

function avatarFor(crowd: Crowd, look: string): number {
  const names = crowd.names;
  const i = names.indexOf(look);
  if (i >= 0) return i;
  const all = names.map((_, j) => j);
  const sex = look.split('_')[0];
  const pool = all.filter((j) => names[j].split('_')[0] === sex);
  let hash = 0;
  for (const ch of look) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const from = pool.length ? pool : all;
  return from[Math.abs(hash) % from.length] ?? 0;
}
