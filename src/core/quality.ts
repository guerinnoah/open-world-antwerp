export type QualityLevel = 'low' | 'medium' | 'high';

export interface Quality {
  level: QualityLevel;
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  shadowRange: number;
  ao: boolean;
  textureSize: number;
  aerial: boolean; // 9 MB: desktop only
  anisotropy: number;
  drawDistance: number;
  fogNear: number;
  traffic: number;
  peds: number;
  cyclists: number;
  trams: number;
  buses: number;
  parkedCars: number;
  vehicleView: number;
  pedView: number;
  detailView: number;
  physicsHz: 30 | 60;
}

const PRESETS: Record<QualityLevel, Omit<Quality, 'level'>> = {
  high: {
    pixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 2048, shadowRange: 160, ao: true, textureSize: 1024, aerial: true,
    anisotropy: 8, drawDistance: 6000, fogNear: 700, traffic: 45, peds: 110, cyclists: 36, trams: 6, buses: 8, parkedCars: 900,
    vehicleView: 350, pedView: 160, detailView: 1, physicsHz: 60,
  },
  medium: {
    pixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 1024, shadowRange: 80, ao: false, textureSize: 512, aerial: false,
    anisotropy: 4, drawDistance: 1600, fogNear: 300, traffic: 20, peds: 45, cyclists: 16, trams: 3, buses: 4, parkedCars: 500,
    vehicleView: 220, pedView: 110, detailView: 0.7, physicsHz: 30,
  },
  low: {
    pixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 512, shadowRange: 60, ao: false, textureSize: 512, aerial: false,
    anisotropy: 2, drawDistance: 1000, fogNear: 180, traffic: 12, peds: 25, cyclists: 8, trams: 2, buses: 3, parkedCars: 300,
    vehicleView: 160, pedView: 80, detailView: 0.5, physicsHz: 30,
  },
};

export const coarsePointer = () => matchMedia('(pointer: coarse)').matches;

export function pickQuality(params: URLSearchParams): Quality {
  const asked = params.get('quality');
  if (asked === 'low' || asked === 'medium' || asked === 'high') return { level: asked, ...PRESETS[asked] };
  const touch = coarsePointer();
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency ?? 8;
  // Safari: no deviceMemory, 4 cores on every iPhone; iOS <= 16 = iPhone X or older
  const oldIPhone = Number(/iPhone OS (\d+)_/.exec(navigator.userAgent)?.[1] ?? Infinity) <= 16;
  const lowEnd = oldIPhone || (memory !== undefined && (memory <= 3 || cores <= 4));
  const level: QualityLevel = !touch ? 'high' : lowEnd ? 'low' : 'medium';
  return { level, ...PRESETS[level] };
}
