// pnpm drive [baseUrl] [extra query, e.g. photo]
import { DEV, hold, load, open, type Any } from './probe.ts';

const base = process.argv[2] ?? DEV;
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const { browser, page } = await open({ logConsole: 'browser' });

const state = () =>
  page.evaluate(() => {
    const g = (window as Any).game;
    const t = g.driving ?? g.player;
    return { x: +t.x.toFixed(1), z: +t.z.toFixed(1), driving: !!g.driving, kmh: g.driving ? Math.round(g.driving.forwardSpeed * 3.6) : 0, cars: g.vehicles.length };
  });
const shot = async (name: string) => {
  await page.screenshot({ path: `screenshots/${name}.png` });
  console.log(name.padEnd(14), JSON.stringify(await state()));
};

const t0 = Date.now();
await load(page, `${base}/?stats${extra}`);
console.log(`loaded in ${Date.now() - t0} ms`);
await page.waitForTimeout(800);
await shot('m1-spawn');
await hold(page, ['KeyW'], 1500);
await shot('m1-walked');

const target = await page.evaluate(() => {
  const g = (window as Any).game;
  const p = g.player;
  const parked = g.vehicles.filter((v: Any) => !g.traffic.has(v));
  const near = parked.reduce((a: Any, b: Any) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
  return { x: near.x, z: near.z };
});
await page.evaluate(([x, z]) => {
  (window as Any).game.player.place(x + 3.5, z, Math.PI);
}, [target.x, target.z]);
await page.waitForTimeout(300);
await shot('m1-by-car');
await page.keyboard.press('KeyE');
await page.waitForTimeout(300);
await hold(page, ['KeyW'], 2500);
await shot('m1-driving');
await hold(page, ['KeyW', 'KeyD'], 1200);
await shot('m1-turning');
await hold(page, ['KeyW'], 4000);
await shot('m1-fast');
await hold(page, ['KeyS'], 2500);
await page.keyboard.press('KeyE');
await page.waitForTimeout(500);
await shot('m1-got-out');
await browser.close();
