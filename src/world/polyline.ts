/** Positive offset = right of travel; one value or one per point. Corners mitred, capped for hairpins. */
export function offsetPolyline(p: number[], offset: number | number[]): number[] {
  if (!offset) return p.slice();
  const n = p.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = Math.max(i - 1, 0), next = Math.min(i + 1, n - 1);
    let dx = p[next * 2] - p[prev * 2], dz = p[next * 2 + 1] - p[prev * 2 + 1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    let scale = 1;
    if (i > 0 && i < n - 1) {
      const ax = p[i * 2] - p[prev * 2], az = p[i * 2 + 1] - p[prev * 2 + 1];
      const al = Math.hypot(ax, az) || 1;
      scale = Math.min(1 / Math.max((ax / al) * dx + (az / al) * dz, 0.4), 2.5);
    }
    const o = typeof offset === 'number' ? offset : offset[i];
    out.push(p[i * 2] - dz * o * scale, p[i * 2 + 1] + dx * o * scale);
  }
  return out;
}

export function reversePolyline(p: number[]): number[] {
  const out: number[] = [];
  for (let i = p.length - 2; i >= 0; i -= 2) out.push(p[i], p[i + 1]);
  return out;
}

export function cumulative(p: number[]): number[] {
  const c = [0];
  for (let i = 2; i < p.length; i += 2) c.push(c[c.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
  return c;
}

export function lengthFrom(p: number[], from: number): number {
  let total = 0;
  for (let j = Math.max(from, 0); j < p.length / 2 - 1; j++) total += Math.hypot(p[j * 2 + 2] - p[j * 2], p[j * 2 + 3] - p[j * 2 + 1]);
  return total;
}

export function pointAt(p: number[], cum: number[], s: number): { x: number; z: number; dx: number; dz: number } {
  let lo = 0, hi = cum.length - 1;
  s = Math.max(0, Math.min(s, cum[hi]));
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  const dx = (p[hi * 2] - p[lo * 2]) / seg, dz = (p[hi * 2 + 1] - p[lo * 2 + 1]) / seg;
  return { x: p[lo * 2] + (p[hi * 2] - p[lo * 2]) * t, z: p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * t, dx, dz };
}

export function along(ax: number, az: number, bx: number, bz: number, x: number, z: number): number {
  const dx = bx - ax, dz = bz - az;
  return Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
}

export function segmentDistance(p: number[], k: number, x: number, z: number): number {
  const t = along(p[k * 2], p[k * 2 + 1], p[k * 2 + 2], p[k * 2 + 3], x, z);
  return Math.hypot(x - p[k * 2] - t * (p[k * 2 + 2] - p[k * 2]), z - p[k * 2 + 1] - t * (p[k * 2 + 3] - p[k * 2 + 1]));
}

export function nearestSegment(p: number[], x: number, z: number): { k: number; d: number } {
  let best = { k: 0, d: Infinity };
  for (let k = 0; k < p.length / 2 - 1; k++) {
    const d = segmentDistance(p, k, x, z);
    if (d < best.d) best = { k, d };
  }
  return best;
}

export function trimPolyline(p: number[], a: number, b: number): number[] {
  const cum = cumulative(p), len = cum[cum.length - 1];
  const k = Math.min(1, (len * 0.6) / (a + b || 1));
  const from = pointAt(p, cum, a * k), to = pointAt(p, cum, len - b * k);
  const out = [from.x, from.z];
  for (let i = 1; i < cum.length - 1; i++) if (cum[i] > a * k && cum[i] < len - b * k) out.push(p[i * 2], p[i * 2 + 1]);
  out.push(to.x, to.z);
  return out;
}

export function inRing(ring: number[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], zi = ring[i + 1], xj = ring[j], zj = ring[j + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
