// Mirrored in GLSL in buildings.ts: keep the two in sync.
const frac = (v: number) => v - Math.floor(v);

/** Metres, except winW (fraction of the bay) and winH (fraction of the floor height). */
export interface FacadeStyle {
  floorH: number;
  groundH: number;
  bayTarget: number;
  winW: number;
  winH: number;
  sill: number;
}

export function facadeStyle(seed: number): FacadeStyle {
  return {
    floorH: 3.0 + frac(seed * 7.13) * 0.6,
    groundH: 3.4 + frac(seed * 3.71) * 1.0,
    bayTarget: 2.4 + frac(seed * 11.3) * 1.0,
    winW: 0.42 + frac(seed * 5.17) * 0.18,
    winH: 0.55 + frac(seed * 13.7) * 0.15,
    sill: 0.85,
  };
}

export function bays(length: number, target: number): { count: number; width: number } {
  const count = Math.max(1, Math.floor(length / target + 0.3));
  return { count, width: length / count };
}

export function doorBay(seed: number, count: number): number {
  return Math.floor(frac(seed * 29.7) * count);
}

export function hasBalconies(seed: number): boolean {
  return frac(seed * 37.9) < 0.35;
}
