// Rider poses are baked from this (tools/assets/people/bake.ts): re-bake after changing it.
export interface RideGeometry {
  wheelRadius: number;
  rearX: number;
  frontX: number;
  head: readonly [number, number];
  bars: readonly [number, number];
  hips: readonly [number, number];
  feet: readonly [number, number, number];
  grip: readonly [number, number, number];
  lean: number;
}

export const MOTORBIKE: RideGeometry = {
  wheelRadius: 0.31, rearX: -0.71, frontX: 0.71,
  head: [0.62, 0.62], bars: [0.42, 1.06],
  hips: [-0.26, 0.9], feet: [-0.16, 0.37, 0.18], grip: [0.36, 1.07, 0.37], lean: 0.25,
};

export const MOPED: RideGeometry = {
  wheelRadius: 0.2, rearX: -0.64, frontX: 0.64,
  head: [0.66, 0.38], bars: [0.5, 1.02],
  hips: [-0.3, 0.88], feet: [0.12, 0.3, 0.12], grip: [0.44, 1.04, 0.32], lean: 0.05,
};
