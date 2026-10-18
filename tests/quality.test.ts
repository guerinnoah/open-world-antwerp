import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickQuality } from '../src/core/quality';

const IPHONE = (ios: number) => `Mozilla/5.0 (iPhone; CPU iPhone OS ${ios}_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148`;
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

function device(touch: boolean, userAgent: string, hardwareConcurrency: number, deviceMemory?: number) {
  vi.stubGlobal('matchMedia', () => ({ matches: touch }));
  vi.stubGlobal('navigator', { userAgent, hardwareConcurrency, deviceMemory });
  return pickQuality(new URLSearchParams()).level;
}

describe('quality', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gives desktops high', () => {
    expect(device(false, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 8, 8)).toBe('high');
  });

  it('gives iPhones medium, though Safari reports 4 cores and no memory', () => {
    expect(device(true, IPHONE(18), 4)).toBe('medium');
    expect(device(true, IPHONE(17), 4)).toBe('medium');
  });

  it('gives iPhones stuck on iOS 16 or older low', () => {
    expect(device(true, IPHONE(16), 4)).toBe('low');
  });

  it('judges Android phones by the memory and cores they report', () => {
    expect(device(true, ANDROID, 8, 8)).toBe('medium');
    expect(device(true, ANDROID, 8, 2)).toBe('low');
    expect(device(true, ANDROID, 4, 4)).toBe('low');
  });

  it('lets ?quality override', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(pickQuality(new URLSearchParams('quality=high')).level).toBe('high');
  });
});
