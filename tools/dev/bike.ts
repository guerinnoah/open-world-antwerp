// pnpm tsx tools/dev/bike.ts [station]
import { readFileSync } from 'node:fs';
import type { CityData } from '../../src/world/cityData.ts';
import { stableRandom } from '../../src/core/util.ts';
import { DEV, load, open, rideState, shooter, stand, type Any } from './probe.ts';

const city = JSON.parse(readFileSync('public/map/city.json', 'utf8')) as CityData;
const { browser, page } = await open({ logConsole: 'console' });
await load(page, `${DEV}/?spawn=grotemarkt&stats`);
const state = async () => {
  const s = await rideState(page);
  return { ...s, riding: s.riding === 'bike' };
};
const shot = shooter(page, 'bike', state);
const v = city.velo!;
const stations = Array.from({ length: v.length / 4 }, (_, i) => v.slice(i * 4, i * 4 + 4)).sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
const [sx, sz, angle, docks] = stations[Number(process.argv[2] ?? 0)];
const ux = Math.cos(angle), uz = Math.sin(angle);
let bike: [number, number] | null = null;
for (let k = 0; k < docks && !bike; k++) {
  const s = (k - (docks - 1) / 2) * 0.75;
  const [x, z] = [sx + ux * s, sz + uz * s];
  if (stableRandom(x, z) < 0.65) bike = [x, z];
}
const [bx, bz] = bike!;
await stand(page, bx - uz * 1.1, bz + ux * 1.1, Math.atan2(-ux, uz), 0.25);
await page.waitForTimeout(1500);
await shot('dock');
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
await shot('mounted');
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await shot('riding');
await page.keyboard.down('KeyA');
await page.waitForTimeout(700);
await shot('turn');
await page.keyboard.up('KeyA');
await page.waitForTimeout(600);
await page.evaluate(() => {
  const g = (window as Any).game;
  g.rig.yaw = g.driving.angle + Math.PI / 2;
  g.rig.pitch = 0.08;
});
await page.waitForTimeout(250);
await shot('side');
await page.keyboard.up('KeyW');
await page.keyboard.press('KeyH');
await page.waitForTimeout(2500);
await shot('stopped');
const empty = await page.evaluate(() => {
  const g = (window as Any).game;
  const d = g.bikes.docks.filter((d: Any) => !d.bike).sort((a: Any, b: Any) => Math.hypot(a.x - g.driving.x, a.z - g.driving.z) - Math.hypot(b.x - g.driving.x, b.z - g.driving.z))[0];
  g.driving.teleport(d.x + 0.3, d.z, d.angle + Math.PI / 2);
  return [d.x, d.z];
});
await page.waitForTimeout(400);
const before = await state();
await page.keyboard.press('KeyE');
await page.waitForTimeout(600);
console.log('dock at', empty.map((n: number) => n.toFixed(1)).join(','), 'hint', before.hint, '→', JSON.stringify(await state()));
await browser.close();
