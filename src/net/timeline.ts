import { wrapAngle } from '../core/util';
import type { PlayerState } from './protocol';

export const DELAY = 100;
const EXTRAPOLATE = 250;
const MAX_GAP = 500;
const TELEPORT = 20;
const KEEP = 40;

export class Timeline {
  private states: PlayerState[] = [];
  private lag = Infinity;

  get latest(): PlayerState | undefined {
    return this.states[this.states.length - 1];
  }

  push(s: PlayerState, receivedAt: number) {
    const last = this.latest;
    if (last && s.time <= last.time) return;
    this.lag = Math.min(receivedAt - s.time, this.lag + 0.2);
    this.states.push(s);
    if (this.states.length > KEEP) this.states.shift();
  }

  sample(now: number, out: PlayerState): boolean {
    const states = this.states;
    if (!states.length) return false;
    const t = now - this.lag - DELAY;
    while (states.length > 2 && states[1].time <= t) states.shift();

    const a = states[0];
    if (t <= a.time) return copy(a, out);
    const b = states.find((s) => s.time > t);
    if (!b) {
      const last = states[states.length - 1];
      const dt = Math.min(t - last.time, EXTRAPOLATE) / 1000;
      copy(last, out);
      out.x += last.vx * dt;
      out.z += last.vz * dt;
      out.angle = wrapAngle(last.angle + last.spin * dt);
      return true;
    }
    const prev = states[states.indexOf(b) - 1];
    const gap = b.time - prev.time;
    if (prev.mode !== b.mode || gap > MAX_GAP || Math.hypot(b.x - prev.x, b.z - prev.z) > TELEPORT) return copy(prev, out);

    const u = (t - prev.time) / gap, T = gap / 1000;
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const d00 = (6 * u2 - 6 * u) / T, d10 = 3 * u2 - 4 * u + 1, d01 = (-6 * u2 + 6 * u) / T, d11 = 3 * u2 - 2 * u;
    const hermite = (p0: number, v0: number, p1: number, v1: number) => h00 * p0 + h10 * T * v0 + h01 * p1 + h11 * T * v1;
    const slope = (p0: number, v0: number, p1: number, v1: number) => d00 * p0 + d10 * v0 + d01 * p1 + d11 * v1;
    const a1 = prev.angle + wrapAngle(b.angle - prev.angle);

    copy(prev, out);
    out.time = t;
    out.x = hermite(prev.x, prev.vx, b.x, b.vx);
    out.z = hermite(prev.z, prev.vz, b.z, b.vz);
    out.vx = slope(prev.x, prev.vx, b.x, b.vx);
    out.vz = slope(prev.z, prev.vz, b.z, b.vz);
    out.angle = wrapAngle(hermite(prev.angle, prev.spin, a1, b.spin));
    out.spin = slope(prev.angle, prev.spin, a1, b.spin);
    out.steer = prev.steer + (b.steer - prev.steer) * u;
    out.throttle = prev.throttle + (b.throttle - prev.throttle) * u;
    out.sink = prev.sink + (b.sink - prev.sink) * u;
    return true;
  }
}

function copy(s: PlayerState, out: PlayerState): true {
  Object.assign(out, s);
  return true;
}
