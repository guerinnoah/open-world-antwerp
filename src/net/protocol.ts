// Shared by game and relay. No local imports: Node runs this file directly.
export const PROTOCOL_VERSION = 6;
export const RELAY_PATH = '/net';
export const CHAT_MAX = 120;
export const CHAT_BURST = 5;
export const CHAT_EVERY = 2000; // ms per message after CHAT_BURST

/** Sent by index: only append. */
export const VEHICLE_KINDS = [
  'city', 'hatch', 'estate', 'sedan', 'suv', 'van', 'bike', 'scooter', 'bus', 'artic', 'motorbike', 'moped',
  'police', 'policevan', 'taxi', 'ambulance', 'truck', 'firetruck',
] as const;

export const FLAG = {
  DOWN: 1,
  INDOORS: 2,
  HORN: 4,
  SIREN: 8,
} as const;

export interface PlayerState {
  time: number; // sender's clock (ms)
  mode: 0 | 1;
  x: number;
  z: number;
  angle: number; // Rapier angle (rad)
  vx: number;
  vz: number;
  spin: number;
  kind: number; // VEHICLE_KINDS index; -1 on foot
  colour: number;
  steer: number;
  throttle: number;
  sink: number; // m below the water line
  flags: number;
}

export interface PeerInfo {
  id: number;
  name: string;
  look: string;
  state?: number[];
}

export interface Took {
  x: number;
  z: number;
  kind: number;
  colour: number;
}

export type ClientMessage =
  | { t: 'hello'; v: number; name: string; look: string }
  | { t: 's'; s: number[] }
  | ({ t: 'took' } & Took)
  | { t: 'chat'; text: string };

export type ServerMessage =
  | { t: 'welcome'; id: number; peers: PeerInfo[]; taken: Took[] } // taken parked cars, oldest first
  | { t: 'join'; peer: PeerInfo }
  | { t: 'leave'; id: number }
  | { t: 's'; id: number; s: number[] }
  | ({ t: 'took'; id: number } & Took)
  | { t: 'chat'; id: number; text: string }
  | { t: 'refused'; reason: 'full' | 'version' };

const STATE_LENGTH = 14;
const round = (v: number, k: number) => Math.round(v * k) / k;

/** cm, cm/s and mrad; field order = wire order. */
export function encodeState(s: PlayerState): number[] {
  return [
    Math.round(s.time), s.mode, round(s.x, 100), round(s.z, 100), round(s.angle, 1000), round(s.vx, 100), round(s.vz, 100),
    round(s.spin, 100), s.kind, s.colour, round(s.steer, 100), round(s.throttle, 100), round(s.sink, 100), s.flags,
  ];
}

export function decodeState(a: unknown): PlayerState | null {
  if (!Array.isArray(a) || a.length !== STATE_LENGTH) return null;
  for (const v of a) if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const [time, mode, x, z, angle, vx, vz, spin, kind, colour, steer, throttle, sink, flags] = a as number[];
  if (mode !== 0 && mode !== 1) return null;
  if (Math.abs(x) > 1e4 || Math.abs(z) > 1e4 || Math.abs(vx) > 500 || Math.abs(vz) > 500 || Math.abs(spin) > 100) return null;
  if (!Number.isInteger(kind) || kind < -1 || kind >= VEHICLE_KINDS.length || (mode === 1) !== kind >= 0) return null;
  if (!Number.isInteger(colour) || colour < 0 || colour > 0xffffff || !Number.isInteger(flags) || flags < 0 || flags > 255) return null;
  return {
    time, mode, x, z, angle, vx, vz, spin, kind, colour, flags,
    steer: Math.max(-1, Math.min(1, steer)), throttle: Math.max(-1, Math.min(1, throttle)), sink: Math.max(0, Math.min(5, sink)),
  };
}

/** The relay filters swearing (server/profanity.ts), so the game ships no word list. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\p{C}<>]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16).trim();
}

export function cleanChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const text = raw.replace(/\s/g, ' ').replace(/\p{C}/gu, '').replace(/ +/g, ' ').trim();
  // by code points, so an emoji at the limit isn't split
  return [...text].slice(0, CHAT_MAX).join('').trim();
}

export function cleanLook(raw: unknown): string {
  return typeof raw === 'string' && /^\w{1,32}$/.test(raw) ? raw : '';
}

export class ChatLimit {
  private tokens: number;
  private at = -Infinity;
  private burst: number;
  private every: number;

  constructor(burst = CHAT_BURST, every = CHAT_EVERY) {
    this.burst = this.tokens = burst;
    this.every = every;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + (now - this.at) / this.every);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}
