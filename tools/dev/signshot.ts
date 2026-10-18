// pnpm tsx tools/dev/signshot.ts [baseUrl] — street-level shots of the densest shop rows, to eyeball the sign emblems.
import { readFile } from 'node:fs/promises';
import type { CityData, Sign } from '../../src/world/cityData.ts';
import { DEV, load, open, signWall, stand } from './probe.ts';

const base = process.argv[2] ?? DEV;
const city: CityData = JSON.parse(await readFile('public/map/city.json', 'utf8'));
const signs = (city.signs ?? []) as Sign[];

// Rank building edges by how many shop signs (not street plates / nameplates) sit on them.
const groups = new Map<string, Sign[]>();
for (const s of signs) {
  if (s[4] === 'street' || s[4] === 'plate') continue;
  const key = `${s[0]}:${s[1]}`;
  groups.set(key, [...(groups.get(key) ?? []), s]);
}
const ranked = [...groups.values()].sort((a, b) => b.length - a.length).slice(0, 4);

const { browser, page } = await open();
page.on('console', (m) => m.type() !== 'debug' && console.log(`[browser] ${m.text()}`));
await load(page, base);

let i = 0;
for (const group of ranked) {
  const w = signWall(city, group[0]);
  const t = group[0][2];
  const tx = w.ax + w.ux * (t * w.len), tz = w.az + w.uz * (t * w.len);
  const back = 4;
  // Chase cam looks along +yaw (forward = cos/sin yaw); face the wall by pointing forward down -normal.
  await stand(page, tx + w.nx * back, tz + w.nz * back, Math.atan2(-w.nz, -w.nx), 0.05);
  await page.evaluate(() => (window as unknown as { game: { rig: { snap(): void } } }).game.rig.snap());
  await page.waitForTimeout(1800);
  const file = `screenshots/signs-${i}.png`;
  await page.screenshot({ path: file });
  console.log(`${file}  ${group.length} signs on edge  (${tx.toFixed(0)}, ${tz.toFixed(0)})`);
  i++;
}
await browser.close();
