import type { CityData } from './cityData';

export const TRAM_HALF = 1.6;
const CELL = 20;

export function clearTramTracks(city: CityData, tracks: { p: number[] }[]) {
  const onTrack = trackTest(tracks);
  const keep = (items: number[], stride: number, radius: number) => {
    const kept: number[] = [];
    for (let i = 0; i < items.length; i += stride) {
      if (!onTrack(items[i], items[i + 1], TRAM_HALF + radius)) kept.push(...items.slice(i, i + stride));
    }
    return kept;
  };
  city.trees = keep(city.trees, 2, 0.3);
  const { lamps, benches, bollards, signals } = city.props;
  city.props = { lamps: keep(lamps, 2, 0.14), benches: keep(benches, 2, 0.9), bollards: keep(bollards, 2, 0.12), signals: keep(signals, 3, 0.1) };
  if (city.terraces) city.terraces = keep(city.terraces, 4, 0.8);
}

export function trackTest(tracks: { p: number[] }[]): (x: number, z: number, distance: number) => boolean {
  const reach = TRAM_HALF + 1;
  const cells = new Map<string, number[][]>();
  for (const { p } of tracks) {
    for (let i = 0; i < p.length - 2; i += 2) {
      const seg = p.slice(i, i + 4);
      for (let cx = Math.floor((Math.min(seg[0], seg[2]) - reach) / CELL); cx <= Math.floor((Math.max(seg[0], seg[2]) + reach) / CELL); cx++) {
        for (let cz = Math.floor((Math.min(seg[1], seg[3]) - reach) / CELL); cz <= Math.floor((Math.max(seg[1], seg[3]) + reach) / CELL); cz++) {
          const key = `${cx},${cz}`;
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key)!.push(seg);
        }
      }
    }
  }
  return (x, z, distance) =>
    !!cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`)?.some(([ax, az, bx, bz]) => {
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(ax + dx * t - x, az + dz * t - z) < distance;
    });
}
