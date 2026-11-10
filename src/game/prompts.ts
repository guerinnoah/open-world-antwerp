import { isVelo } from '../actors/bikes';
import { BRANDS, brandOf } from '../actors/scooters';
import { VEHICLE_NAMES, isBus, isEmergency, isMotorbike, twoWheeled, type Vehicle, type VehicleSpec } from '../actors/vehicle';
import type { Ride } from './boarding';

export const keyHint = (verb: string, touch: boolean) => (touch ? `${verb}: E` : `${verb} [E]`);

export function vehicleName(v: Vehicle): string {
  if (isVelo(v)) return 'Velo';
  return v.spec.name === 'scooter' ? BRANDS[brandOf(v.colour)].name : VEHICLE_NAMES[v.spec.name];
}

export function rideVerb(near: Ride | null, touch: boolean): string {
  if (!near) return '';
  if ('dock' in near) return 'Take a Velo bike';
  if ('scooter' in near) return `Ride this ${BRANDS[near.scooter.brand].name}`;
  if ('cyclist' in near) return touch ? 'Steal bike' : 'Steal this bike';
  if ('tram' in near) return `Drive tram ${near.tram.run.line}`;
  if ('bus' in near) return `Steal bus ${near.bus.run.line}`;
  const { spec, colour } = near.vehicle;
  if (spec.name === 'bike') return 'Ride this bike';
  if (isBus(spec)) return 'Drive this bus';
  if (spec.name === 'scooter') return `Ride this ${BRANDS[brandOf(colour)].name}`;
  if (isMotorbike(spec)) return `${touch ? 'Steal' : 'Steal this'} ${spec.name}`;
  return `${touch ? 'Steal' : 'Steal this'} ${spec.label ?? 'car'}`;
}

export const exitVerb = (spec: VehicleSpec) => (twoWheeled(spec) || isMotorbike(spec) ? 'Get off' : 'Get out');

export function controlLines(spec: VehicleSpec | null, tram: boolean, chat: boolean): string[] {
  const common = ['V — Camera', 'P — Map', ...(chat ? ['T — Chat'] : [])];
  if (spec) {
    const bike = twoWheeled(spec), moto = isMotorbike(spec);
    const lines = [bike || moto ? 'WASD — Ride' : 'WASD — Drive'];
    if (spec.sprintSpeed !== undefined || spec.maxSpeed > 15.3) lines.push(`Shift — ${spec.name === 'bike' ? 'Sprint' : 'Faster'}`);
    if (!bike && !moto) lines.push('Space — Handbrake');
    lines.push(`H — ${bike ? 'Bell' : 'Horn'}`);
    if (isEmergency(spec)) lines.push('Q — Siren');
    if (!bike && !moto && !isBus(spec) && !isEmergency(spec)) lines.push('R — Radio');
    lines.push(`E — ${exitVerb(spec)}`);
    return [...lines, ...common];
  }
  if (tram) return ['WASD — Drive', 'Space — Brake', 'E — Get out', ...common];
  return ['WASD — Move', 'Shift — Sprint', 'R — Punch', 'E — Enter / use', ...common];
}
