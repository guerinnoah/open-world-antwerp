// Rider poses are baked from this (tools/assets/people/bake.ts): re-bake after changing it.
export const SCOOTER = {
  wheelRadius: 0.14,
  rearX: -0.44,
  frontX: 0.44,
  deck: 0.19,
  deckFront: 0.25,
  deckBack: -0.33,
  frontFoot: [0.07, -0.05] as const,
  backFoot: [-0.2, 0.06] as const,
  backFootTurn: 0.55,
  hipX: -0.08,
  grip: [0.25, 1.06, 0.25] as const,
  head: [0.41, 0.32] as const,
  stemTop: [0.29, 1.03] as const,
};
