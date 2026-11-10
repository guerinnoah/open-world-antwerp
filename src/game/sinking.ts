import type { Pedestrians } from '../actors/pedestrians';
import type { Player } from '../actors/player';
import type { Traffic } from '../actors/traffic';
import type { Tram } from '../actors/trams';
import type { Vehicle } from '../actors/vehicle';
import type { Sound } from '../audio/sound';
import type { Splash } from '../fx/splash';
import type { WaterMap } from '../world/water';

const FLOAT_DEPTH = 0.5; // m

interface SinkingHost {
  readonly vehicles: readonly Vehicle[];
  readonly driving: Vehicle | null;
  readonly tram: Tram | null;
  readonly player: Player;
  readonly traffic: Traffic;
  readonly peds: Pedestrians;
  removeVehicle(v: Vehicle): void;
}

/** The player's car floats and the player swims; anything else in the water sinks or is gone. */
export class Sinking {
  private sinking: Vehicle[] = [];

  constructor(private host: SinkingHost, private water: WaterMap, private splash: Splash, private sound: Sound) {}

  forget(v: Vehicle) {
    const i = this.sinking.indexOf(v);
    if (i >= 0) this.sinking.splice(i, 1);
  }

  /** `sweep`: also look for other cars and people that went in, which needn't be every step. */
  step(dt: number, sweep: boolean) {
    const { host } = this;
    const car = host.driving;
    if (car) {
      const wet = this.water.contains(car.x, car.z);
      if (wet && !car.afloat) this.splashDown(car.x, car.z);
      car.afloat = wet;
      car.sink = wet ? Math.min(car.sink + dt * 0.8, FLOAT_DEPTH) : Math.max(car.sink - dt * 0.8, 0);
    } else if (!host.tram) {
      const p = host.player;
      const wet = this.water.contains(p.x, p.z);
      if (wet && !p.swimming) this.splashDown(p.x, p.z);
      p.swimming = wet;
    }
    if (sweep) {
      for (const v of host.vehicles) {
        if (v === host.driving || v.remote || !(v.awake || v.afloat) || this.sinking.includes(v)) continue;
        if (!this.water.contains(v.x, v.z)) continue;
        this.sinking.push(v);
        host.traffic.release(v);
        if (!v.afloat) this.splashDown(v.x, v.z);
        v.driven = v.afloat = false;
        v.sink = Math.max(v.sink, 0.01);
      }
      for (const p of [...host.peds.peds]) {
        const t = p.body.translation();
        if (this.water.contains(t.x, t.y)) {
          this.splashDown(t.x, t.y);
          host.peds.remove(p);
        }
      }
    }
    for (const v of [...this.sinking]) {
      v.sink += dt * 0.9;
      if (v.sink > 3) host.removeVehicle(v);
    }
  }

  private splashDown(x: number, z: number) {
    this.splash.burst(x, z);
    this.sound.splash(x, z);
  }
}
