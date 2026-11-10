import type { Bus } from '../actors/buses';
import type { Cyclists, Rider } from '../actors/cyclists';
import type { Ped, Pedestrians } from '../actors/pedestrians';
import { crashHurt, exposure, type Player } from '../actors/player';
import type { Scooters } from '../actors/scooters';
import type { Traffic } from '../actors/traffic';
import type { Tram } from '../actors/trams';
import { isBus, isMotorbike, isPolice, isTruck, twoWheeled, type Vehicle } from '../actors/vehicle';
import type { Sound } from '../audio/sound';
import type { Owner, Physics } from '../physics/physics';
import type { Breakables } from '../world/breakables';
import type { Boarding } from './boarding';

const CRASH_SETTLE = 0.1; // s between separate crashes

interface CollisionHost {
  readonly vehicles: readonly Vehicle[];
  readonly player: Player;
  readonly driving: Vehicle | null;
  readonly tram: Tram | null;
  readonly traffic: Traffic;
  readonly peds: Pedestrians;
  readonly cyclists: Cyclists;
  readonly scooters: Scooters;
  crime(x: number, z: number, againstPolice?: boolean): void;
  hurt(amount: number): void;
}

/** After each physics step: crash damage, people knocked down, street furniture knocked over. */
export class Collisions {
  private crash = { dv: 0, quiet: Infinity }; // m/s lost so far, s since the last hit

  constructor(
    private host: CollisionHost,
    private boarding: Boarding,
    private physics: Physics,
    private sound: Sound,
    private breakables: Breakables,
  ) {}

  /** A velocity change beyond what brakes can do means the player's car hit something. */
  carImpact(dt: number, car: Vehicle | null, before: { x: number; y: number } | null, throttle: number) {
    this.crash.quiet += dt;
    if (!car || !before) return;
    const after = car.body.linvel();
    const impact = Math.hypot(after.x - before.x, after.y - before.y);
    if (impact <= 2.5) return;
    if (twoWheeled(car.spec)) this.sound.bump(car.x, car.z);
    else this.sound.crash(impact);
    const was = this.crash.quiet > CRASH_SETTLE ? 0 : this.crash.dv;
    let dv = was + this.impactFelt(car, before, impact);
    if (isMotorbike(car.spec) && impact > 9 && this.boarding.throwOff(car, before)) dv = Math.max(dv, Math.hypot(before.x, before.y));
    const k = exposure(car);
    this.host.hurt(crashHurt(dv, k) - crashHurt(was, k));
    this.crash = { dv, quiet: 0 };
    // Patrol cars only: in a chase the hit is as often theirs.
    const { traffic } = this.host;
    const cop = this.host.vehicles.find((v) => isPolice(v.spec) && traffic.has(v) && !traffic.police.includes(v) && Math.hypot(v.x - car.x, v.z - car.z) < (v.spec.length + car.spec.length) / 2 + 1);
    if (cop && this.rammed(car, before, cop, throttle)) this.host.crime(cop.x, cop.z, true);
  }

  knockThingsOver() {
    const { traffic } = this.host;
    for (const v of this.host.vehicles) {
      // Not traffic: AI drivers clip posts at corners and would wreck the street. Pursuers do; bikes go round.
      if (!v.awake || v.sink > 0 || twoWheeled(v.spec) || (traffic.has(v) && !traffic.police.includes(v))) continue;
      this.breakables.touching(v.x, v.z, v.angle, v.spec.length / 2, v.spec.width / 2, (id) => this.knockOver(id, v));
      if (this.host.scooters.knock(v)) this.sound.knock(v.x, v.z, Math.abs(v.forwardSpeed), true);
    }
  }

  /** `walking`: the player's velocity before the step, if on foot. */
  handleContacts(walking: { x: number; y: number } | null) {
    const { host } = this;
    const { driving, tram: driven, player } = host;
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
        const ours = what.entity === driving || what.entity === driven;
        if (who.kind === 'cyclist') {
          const r = who.entity as Rider;
          if (host.cyclists.hit(r, from.x, from.y, vx, vz, bike)) {
            const t = r.body.translation();
            this.sound.bump(t.x, t.y);
            if (ours) host.crime(t.x, t.y);
          }
          continue;
        }
        if (who.kind === 'ped' && speed > (bike ? 4.5 : 2.5)) {
          const ped = who.entity as Ped;
          if (ped.state !== 'down') {
            const t = ped.body.translation();
            this.sound.bump(t.x, t.y);
            if (ours) host.crime(t.x, t.y);
          }
          host.peds.knockDown(ped, vx, vz, speed);
        }
        if (who.kind === 'player' && walking && player.down <= 0) {
          // Closing speed, so a car rolling away or a tram brushing past doesn't floor you.
          const dx = player.x - from.x, dz = player.z - from.y, d = Math.hypot(dx, dz) || 1;
          const closing = ((vx - walking.x) * dx + (vz - walking.y) * dz) / d;
          if (closing <= 4) continue;
          player.down = 1.6;
          player.body.setLinvel({ x: vx * 0.5, y: vz * 0.5 }, true);
          this.sound.bump(player.x, player.z);
          const heavy = what.kind === 'tram' || what.kind === 'bus' || (what.kind === 'vehicle' && (isBus((what.entity as Vehicle).spec) || isTruck((what.entity as Vehicle).spec)));
          host.hurt(closing * (heavy ? 7 : bike ? 2 : 4));
        }
      }
    }
  }

  /** A remote car is kinematic and won't give way: count the hit as two equal cars meeting. */
  private impactFelt(car: Vehicle, before: { x: number; y: number }, impact: number): number {
    const other = this.host.vehicles.find((v) => v.remote && Math.hypot(v.x - car.x, v.z - car.z) < (v.spec.length + car.spec.length) / 2 + 1);
    return other ? Math.min(impact, (Math.hypot(before.x, before.y) + Math.abs(other.animatedSpeed)) / 2) : impact;
  }

  /** You into it, not it (or another one shoving you) into you. */
  private rammed(car: Vehicle, before: { x: number; y: number }, cop: Vehicle, throttle: number): boolean {
    if (throttle < 0.2) return false;
    const dx = cop.x - car.x, dz = cop.z - car.z, d = Math.hypot(dx, dz) || 1;
    const mine = (before.x * dx + before.y * dz) / d;
    const v = cop.body.linvel(), theirs = -(v.x * dx + v.y * dz) / d;
    return mine > 3 && mine > theirs;
  }

  private knockOver(id: number, car: Vehicle) {
    const v = car.body.linvel();
    const thing = this.breakables.knock(id, car.x, car.z, v.x, v.y);
    if (!thing) return;
    car.body.setLinvel({ x: v.x * thing.keep, y: v.y * thing.keep }, true);
    this.sound.knock(thing.x, thing.z, Math.hypot(v.x, v.y), thing.metal);
  }
}
