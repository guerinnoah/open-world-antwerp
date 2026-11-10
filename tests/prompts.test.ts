import { describe, expect, it } from 'vitest';
import { VELO_RED } from '../src/actors/bikes';
import { BRANDS } from '../src/actors/scooters';
import { BIKE_SPEC, MOTORBIKE_SPEC, SCOOTER_SPEC, VEHICLE_TYPES, type Vehicle, type VehicleSpec } from '../src/actors/vehicle';
import type { Ride } from '../src/game/boarding';
import { controlLines, keyHint, rideVerb, vehicleName } from '../src/game/prompts';

const spec = (name: VehicleSpec['name']) => VEHICLE_TYPES.find(([s]) => s.name === name)![0];
const vehicle = (s: VehicleSpec, colour = 0x333333) => ({ spec: s, colour }) as Vehicle;
const ride = (r: unknown) => r as Ride;

describe('prompts', () => {
  it('puts the key after the verb, or after a colon on touch screens', () => {
    expect(keyHint('Get out', false)).toBe('Get out [E]');
    expect(keyHint('Get out', true)).toBe('Get out: E');
  });

  it('lists the keys that work for what you are in', () => {
    expect(controlLines(null, false, true)).toEqual(['WASD — Move', 'Shift — Sprint', 'R — Punch', 'E — Enter / use', 'V — Camera', 'P — Map', 'T — Chat']);
    expect(controlLines(null, true, false)).toEqual(['WASD — Drive', 'Space — Brake', 'E — Get out', 'V — Camera', 'P — Map']);

    const car = controlLines(spec('city'), false, false);
    expect(car).toEqual(expect.arrayContaining(['Space — Handbrake', 'H — Horn', 'R — Radio', 'E — Get out']));
    expect(car).not.toContain('Q — Siren');

    const police = controlLines(spec('police'), false, false);
    expect(police).toContain('Q — Siren');
    expect(police).not.toContain('R — Radio');

    const bike = controlLines(BIKE_SPEC, false, false);
    expect(bike).toEqual(expect.arrayContaining(['WASD — Ride', 'Shift — Sprint', 'H — Bell', 'E — Get off']));
    expect(bike).not.toContain('Space — Handbrake');
  });

  it('names what you can take, shorter on touch screens', () => {
    expect(rideVerb(null, false)).toBe('');
    expect(rideVerb(ride({ dock: {} }), false)).toBe('Take a Velo bike');
    expect(rideVerb(ride({ scooter: { brand: 2 } }), false)).toBe(`Ride this ${BRANDS[2].name}`);
    expect(rideVerb(ride({ cyclist: {} }), false)).toBe('Steal this bike');
    expect(rideVerb(ride({ cyclist: {} }), true)).toBe('Steal bike');
    expect(rideVerb(ride({ tram: { run: { line: '4' } } }), false)).toBe('Drive tram 4');
    expect(rideVerb(ride({ vehicle: vehicle(spec('police')) }), false)).toBe('Steal this police car');
    expect(rideVerb(ride({ vehicle: vehicle(spec('city')) }), true)).toBe('Steal car');
    expect(rideVerb(ride({ vehicle: vehicle(MOTORBIKE_SPEC) }), false)).toBe('Steal this motorbike');
  });

  it('calls a Velo a Velo and a shared scooter by its brand', () => {
    expect(vehicleName(vehicle(BIKE_SPEC, VELO_RED))).toBe('Velo');
    expect(vehicleName(vehicle(SCOOTER_SPEC, BRANDS[1].colour))).toBe(BRANDS[1].name);
    expect(vehicleName(vehicle(spec('city')))).toBe('City Car');
  });
});
