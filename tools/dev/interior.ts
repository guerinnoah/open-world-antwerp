// pnpm tsx tools/dev/interior.ts [name…]
import { readFileSync } from 'node:fs';
import type { CityData } from '../../src/world/cityData.ts';
import { DEV, hold, load, open, signWall, stand, type Any } from './probe.ts';

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['Den Engel', 'Albert Heijn', 'klub kollekt', 'HotelO Kathedral'];
const city = JSON.parse(readFileSync('public/map/city.json', 'utf8')) as CityData;
const { browser, page } = await open({ logConsole: 'console' });
await load(page, `${DEV}/?spawn=grotemarkt&stats`);
const state = () => page.evaluate(() => {
  const g = (window as Any).game;
  return { indoors: g.indoors, x: +g.player.x.toFixed(1), z: +g.player.z.toFixed(1), hint: document.querySelector('#hud .hint')?.textContent };
});
for (const name of names) {
  const sign = (city.signs ?? []).find((s) => s[5].toLowerCase().includes(name.toLowerCase()) && s[4] !== 'street');
  if (!sign) {
    console.log(`no place called ${name}`);
    continue;
  }
  const { ax, az, len, ux, uz, nx, nz } = signWall(city, sign);
  let along = sign[2] * len;
  if (sign[4] === 'plate') along += along + 1.0 < len - 0.7 ? 1.0 : -1.0;
  const [x, z] = [ax + ux * along + nx * 1.0, az + uz * along + nz * 1.0];
  const slug = name.toLowerCase().replace(/\W+/g, '-');
  await stand(page, x, z, Math.atan2(-nz, -nx));
  await page.waitForTimeout(600);
  const before = await state();
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(1800);
  const inside = await state();
  console.log(name, sign[4], 'outside:', before.hint, '→ inside:', inside.indoors);
  if (!inside.indoors) continue;
  await page.screenshot({ path: `screenshots/in-${slug}.png` });
  await hold(page, ['KeyW'], 900);
  await page.evaluate(() => {
    const g = (window as Any).game;
    g.rig.yaw += Math.PI;
    g.rig.pitch = 0.1;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `screenshots/in-${slug}-out.png` });
  await hold(page, ['KeyW'], 900);
  await page.waitForTimeout(300);
  const atDoor = await state();
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(800);
  const after = await state();
  console.log('   at door:', atDoor.hint, '→ left:', !after.indoors, `[${after.x}, ${after.z}]`);
  if (after.indoors) await page.evaluate(() => (window as Any).game.leaveBuilding());
}
await browser.close();
