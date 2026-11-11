import { notifySettings, settings, type Settings } from './settings';

/** `also` keys stay as fixed alternatives unless another action is bound to them. */
type Binding = { label: string; key: string; also?: readonly string[] };
const BINDINGS = {
  forward: { label: 'Forward', key: 'KeyW', also: ['ArrowUp'] },
  back: { label: 'Back, reverse', key: 'KeyS', also: ['ArrowDown'] },
  left: { label: 'Left', key: 'KeyA', also: ['ArrowLeft'] },
  right: { label: 'Right', key: 'KeyD', also: ['ArrowRight'] },
  sprint: { label: 'Sprint, go faster', key: 'ShiftLeft', also: ['ShiftRight'] },
  handbrake: { label: 'Handbrake', key: 'Space' },
  use: { label: 'Get in or out, use', key: 'KeyE', also: ['KeyF', 'Enter'] },
  punch: { label: 'Punch, next radio station', key: 'KeyR' },
  horn: { label: 'Horn or bell', key: 'KeyH' },
  siren: { label: 'Siren', key: 'KeyQ' },
  view: { label: 'First or third person', key: 'KeyV' },
  map: { label: 'Map', key: 'KeyP' },
  chat: { label: 'Chat', key: 'KeyT' },
  mute: { label: 'Mute', key: 'KeyM' },
} satisfies Record<string, Binding>;
export type Action = keyof typeof BINDINGS;
export const ACTIONS: Record<Action, Binding> = BINDINGS;
export const ACTION_LIST = Object.keys(ACTIONS) as Action[];
const RESERVED = new Set(['Escape', 'Tab', 'CapsLock', 'MetaLeft', 'MetaRight', 'ContextMenu', 'F5', 'F11', 'F12']);
const NAMES: Record<string, string> = {
  ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Alt', AltRight: 'Right Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};

export const keyOf = (action: Action, keys = settings.keys) => keys[action] ?? ACTIONS[action].key;

export const pressed = (action: Action, code: string) =>
  keyOf(action) === code || (!!ACTIONS[action].also?.includes(code) && !ACTION_LIST.some((a) => keyOf(a) === code));

/** Swaps with the action that had the key. Null: a key the browser needs. */
export function rebind(keys: Settings['keys'], action: Action, code: string): Settings['keys'] | null {
  if (RESERVED.has(code)) return null;
  const next = { ...keys };
  const taken = ACTION_LIST.find((a) => a !== action && keyOf(a, keys) === code);
  if (taken) next[taken] = keyOf(action, keys);
  next[action] = code;
  for (const a of ACTION_LIST) if (next[a] === ACTIONS[a].key) delete next[a];
  return next;
}

let layout: Map<string, string> | undefined;

/** Chromium only: printed labels, e.g. Z for KeyW on AZERTY. */
export function readKeyboardLayout() {
  const keyboard = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Map<string, string>> } }).keyboard;
  keyboard?.getLayoutMap?.().then((map) => {
    layout = map;
    notifySettings();
  }, () => {});
}

export function keyName(code: string): string {
  const typed = layout?.get(code);
  if (typed?.trim()) return typed.toUpperCase();
  return NAMES[code] ?? code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ');
}

export const keyLabel = (action: Action) => keyName(keyOf(action));

export function moveKeys(): string {
  const names = (['forward', 'left', 'back', 'right'] as const).map(keyLabel);
  return names.every((n) => n.length === 1) ? names.join('') : names.join(' ');
}
