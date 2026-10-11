// pnpm streets [name…]
import { readFileSync } from 'node:fs';
import type { GraphData } from '../../src/world/cityData.ts';
import { DEV, load, open, stand } from './probe.ts';

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['Meir', 'Hoogstraat', 'Grote Markt', 'Lange Gasthuisstraat'];
const graph = JSON.parse(readFileSync('public/map/graph.json', 'utf8')) as GraphData;
const { browser, page } = await open();
await load(page, `${DEV}/?spawn=grotemarkt&stats`);
for (const name of names) {
  const e = [...graph.drive.edges, ...graph.walk.edges].filter((e) => e.n === name).sort((a, b) => b.len - a.len)[0];
  let x: number, z: number, yaw: number;
  if (e) {
    const m = (e.p.length / 2) >> 1;
    x = e.p[m * 2]; z = e.p[m * 2 + 1];
    yaw = Math.atan2(e.p[m * 2 + 3] - z, e.p[m * 2 + 2] - x);
    const off = e.w / 2 + 1;
    x += -Math.sin(yaw) * off; z += Math.cos(yaw) * off;
  } else if (name === 'Grote Markt') {
    [x, z, yaw] = [12, 2, 0.6];
  } else {
    console.log(`no street called ${name}`);
    continue;
  }
  await stand(page, x, z, yaw, 0.12, yaw + 0.35);
  await page.waitForTimeout(1500);
  const file = `screenshots/street-${name.toLowerCase().replace(/\s+/g, '-')}.png`;
  await page.screenshot({ path: file });
  console.log(file, (await page.locator('#stats').innerText()).split('\n')[0]);
}
await browser.close();
