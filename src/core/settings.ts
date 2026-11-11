import type { Action } from './keys';
import type { QualityLevel } from './quality';
import { stored } from './storage';

export interface Settings {
  quality: QualityLevel | 'auto';
  volume: number;
  radioVolume: number;
  lookSpeed: number; // × the default
  invertLook: boolean;
  fov: number; // vertical degrees in landscape
  keys: Partial<Record<Action, string>>; // KeyboardEvent.code overrides
}

export const DEFAULTS: Readonly<Settings> = { quality: 'auto', volume: 1, radioVolume: 1, lookSpeed: 1, invertLook: false, fov: 60, keys: {} };
export const LIMITS = { volume: [0, 1], radioVolume: [0, 1], lookSpeed: [0.3, 3], fov: [50, 90] } as const;

const KEY = 'open-world-antwerp-settings';
const clamp = (v: unknown, [lo, hi]: readonly [number, number], fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** Bad or outdated fields fall back one by one. */
export function parseSettings(raw: string | null): Settings {
  let s: Partial<Settings> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}');
    if (parsed && typeof parsed === 'object') s = parsed;
  } catch { /* defaults */ }
  const keys: Settings['keys'] = {};
  if (s.keys && typeof s.keys === 'object') {
    for (const [action, code] of Object.entries(s.keys)) if (typeof code === 'string' && code) keys[action as Action] = code;
  }
  return {
    quality: (['auto', 'low', 'medium', 'high'] as const).find((q) => q === s.quality) ?? DEFAULTS.quality,
    volume: clamp(s.volume, LIMITS.volume, DEFAULTS.volume),
    radioVolume: clamp(s.radioVolume, LIMITS.radioVolume, DEFAULTS.radioVolume),
    lookSpeed: clamp(s.lookSpeed, LIMITS.lookSpeed, DEFAULTS.lookSpeed),
    invertLook: typeof s.invertLook === 'boolean' ? s.invertLook : DEFAULTS.invertLook,
    fov: clamp(s.fov, LIMITS.fov, DEFAULTS.fov),
    keys,
  };
}

export const settings: Settings = parseSettings(stored(KEY));
const listeners = new Set<() => void>();

/** Runs the listener now and after every change. */
export function onSettings(listener: () => void) {
  listeners.add(listener);
  listener();
}

export function notifySettings() {
  for (const listener of listeners) listener();
}

export function saveSettings(patch: Partial<Settings>) {
  Object.assign(settings, patch);
  stored(KEY, JSON.stringify(settings));
  notifySettings();
}
