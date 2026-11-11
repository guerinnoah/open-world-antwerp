import { afterEach, describe, expect, it } from 'vitest';
import { keyName, moveKeys, pressed, rebind } from '../src/core/keys';
import { DEFAULTS, parseSettings, settings } from '../src/core/settings';
import { controlLines, keyHint } from '../src/game/prompts';

describe('parseSettings', () => {
  it('falls back to the defaults for missing or broken storage', () => {
    expect(parseSettings(null)).toEqual(DEFAULTS);
    expect(parseSettings('not json')).toEqual(DEFAULTS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULTS);
  });

  it('clamps numbers and drops values of the wrong type, field by field', () => {
    const s = parseSettings(JSON.stringify({ quality: 'ultra', volume: 4, radioVolume: 0.5, lookSpeed: 'fast', fov: 10, invertLook: 1, keys: { use: 'KeyG', horn: 7 } }));
    expect(s).toEqual({ ...DEFAULTS, radioVolume: 0.5, fov: 50, volume: 1, keys: { use: 'KeyG' } });
  });
});

describe('key bindings', () => {
  afterEach(() => (settings.keys = {}));

  it('swaps the key with the action that had it', () => {
    expect(rebind({}, 'use', 'KeyR')).toEqual({ use: 'KeyR', punch: 'KeyE' });
  });

  it('forgets bindings that are back at their default', () => {
    expect(rebind({ use: 'KeyR', punch: 'KeyE' }, 'use', 'KeyE')).toEqual({});
  });

  it('refuses keys the browser needs', () => {
    expect(rebind({}, 'map', 'Escape')).toBeNull();
    expect(rebind({}, 'map', 'Tab')).toBeNull();
  });

  it('keeps the arrows and F as extras until another action takes them', () => {
    expect(pressed('forward', 'ArrowUp')).toBe(true);
    expect(pressed('use', 'KeyF')).toBe(true);
    settings.keys = rebind({}, 'horn', 'KeyF')!;
    expect(pressed('horn', 'KeyF')).toBe(true);
    expect(pressed('use', 'KeyF')).toBe(false);
    expect(pressed('use', 'KeyE')).toBe(true);
  });

  it('labels the move keys and prompts from the bindings', () => {
    expect(keyName('ShiftLeft')).toBe('Shift');
    expect(keyName('Digit4')).toBe('4');
    expect(moveKeys()).toBe('WASD');
    settings.keys = { forward: 'KeyZ', left: 'KeyQ', siren: 'KeyA' };
    expect(moveKeys()).toBe('ZQSD');
    settings.keys = { forward: 'Numpad8' };
    expect(moveKeys()).toBe('Num 8 A S D');
    settings.keys = { use: 'KeyG' };
    expect(keyHint('Steal this car', false)).toBe('Steal this car [G]');
    expect(controlLines(null, false, false)).toContain('G — Enter / use');
  });
});
