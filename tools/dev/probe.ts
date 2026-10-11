// In page.evaluate callbacks declare no named functions: tsx's esbuild wraps them in __name(), which the page lacks.
import { chromium, devices, type BrowserContextOptions, type Page } from 'playwright';
import type { CityData, Sign } from '../../src/world/cityData.ts';

export type Any = any;

export const DEV = 'http://localhost:5173';
export const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 720 } };
const { defaultBrowserType: _, ...pixel7 } = devices['Pixel 7'];
export const PHONE: BrowserContextOptions = pixel7;

export const launch = () => chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

export async function open({ context = DESKTOP, logConsole }: { context?: BrowserContextOptions; logConsole?: string } = {}) {
  const browser = await launch();
  const page = await browser.newPage(context);
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  if (logConsole) page.on('console', (m) => m.type() === 'error' && console.log(`[${logConsole}] ${m.text()}`));
  return { browser, page };
}

export const loaded = (page: Page, timeout = 60_000) => page.waitForSelector('#loading', { state: 'detached', timeout });

export async function load(page: Page, url: string, timeout = 60_000) {
  await page.goto(url);
  await loaded(page, timeout);
}

export async function hold(page: Page, keys: string[], ms: number) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(ms);
  for (const k of keys) await page.keyboard.up(k);
}

export const stand = (page: Page, x: number, z: number, heading: number, pitch?: number, yaw = heading) =>
  page.evaluate(([x, z, heading, yaw, pitch]) => {
    const g = (window as Any).game;
    g.player.place(x, z, heading);
    g.rig.yaw = yaw;
    if (pitch !== undefined) g.rig.pitch = pitch;
  }, [x, z, heading, yaw, pitch] as const);

export const besideParkedCar = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => {
    const g = (window as Any).game;
    const parked = g.vehicles.filter((v: Any) => !g.traffic.has(v));
    const v = parked.reduce((a: Any, b: Any) => (Math.hypot(a.x - x, a.z - z) < Math.hypot(b.x - x, b.z - z) ? a : b));
    g.player.place(v.x + Math.sin(v.angle) * 2, v.z - Math.cos(v.angle) * 2, v.angle);
  }, [x, z]);

export const rideState = (page: Page) =>
  page.evaluate(() => {
    const v = (window as Any).game.driving;
    return {
      riding: v?.spec.name, kmh: v ? +(Math.abs(v.forwardSpeed) * 3.6).toFixed(1) : 0, roll: v ? +v.roll.toFixed(2) : 0,
      hint: document.querySelector('#hud .hint')?.textContent, toast: document.querySelector('#hud .toast')?.textContent,
    };
  });

export const shooter = (page: Page, prefix: string, state: () => Promise<unknown>) => async (name: string) => {
  await page.screenshot({ path: `screenshots/${prefix}-${name}.png` });
  console.log(name.padEnd(10), JSON.stringify(await state()));
};

export function signWall(city: CityData, sign: Sign) {
  const ring = city.buildings[sign[0]].rings[0];
  const i = sign[1], j = (i + 1) % (ring.length / 2);
  const [ax, az, bx, bz] = [ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]];
  const len = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / len, uz = (bz - az) / len;
  return { ax, az, bx, bz, len, ux, uz, nx: uz, nz: -ux };
}
