// pnpm tsx tools/dev/signs.ts [name…] (SIDE=1: from along the street)
import { readFileSync } from 'node:fs';
import type { CityData } from '../../src/world/cityData.ts';
import { DEV, load, open, signWall, stand } from './probe.ts';

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['Albert Heijn', 'Apotheek', 'Den Engel', 'Pizza Hut'];
const city = JSON.parse(readFileSync('public/map/city.json', 'utf8')) as CityData;
const { browser, page } = await open();
await load(page, `${DEV}/?spawn=grotemarkt&stats`);
const look = async (x: number, z: number, yaw: number, file: string) => {
  await stand(page, x, z, yaw, 0.05);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: file });
};
for (const name of names) {
  const velo = /^velo:(\d+)$/.exec(name);
  if (velo) {
    const v = city.velo ?? [];
    const order = Array.from({ length: v.length / 4 }, (_, i) => i).sort((a, b) => Math.hypot(v[a * 4], v[a * 4 + 1]) - Math.hypot(v[b * 4], v[b * 4 + 1]));
    const i = order[Number(velo[1])] * 4;
    const [x, z, angle] = [v[i], v[i + 1], v[i + 2]];
    const [px, pz] = [-Math.sin(angle), Math.cos(angle)];
    await look(x + px * 6 - Math.cos(angle) * 3, z + pz * 6 - Math.sin(angle) * 3, Math.atan2(-pz, -px) + 0.4, `screenshots/velo-${velo[1]}.png`);
    console.log(`screenshots/velo-${velo[1]}.png`, v.slice(i, i + 4));
    continue;
  }
  const sign = (city.signs ?? []).find((s) => s[5].toLowerCase().includes(name.toLowerCase()));
  if (!sign) {
    console.log(`no sign called ${name}`);
    continue;
  }
  const { ax, az, bx, bz, ux, uz, nx, nz } = signWall(city, sign);
  const side = process.env.SIDE ? 1 : 0;
  const [x, z] = [ax + (bx - ax) * sign[2] + nx * (7 - side * 3) - ux * side * 9, az + (bz - az) * sign[2] + nz * (7 - side * 3) - uz * side * 9];
  const file = `screenshots/sign${side ? '-side' : ''}-${name.toLowerCase().replace(/\W+/g, '-')}.png`;
  await look(x, z, Math.atan2(-nz, -nx) - side * 1.05, file);
  console.log(file, sign[5], sign[4]);
}
await browser.close();
