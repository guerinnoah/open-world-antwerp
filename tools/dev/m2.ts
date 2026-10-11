// pnpm m2 [baseUrl]
import { DESKTOP, DEV, hold, launch, load, type Any } from './probe.ts';

const browser = await launch();
const page = await browser.newPage(DESKTOP);
page.on('console', (m) => m.type() === 'error' && console.log(`[browser] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0, 4).join('\n')}`));

const status = () =>
  page.evaluate(() => {
    const g = (window as Any).game;
    const t = g.driving ?? g.player;
    return {
      at: [Math.round(t.x), Math.round(t.z)], driving: !!g.driving, kmh: g.driving ? Math.round(g.driving.forwardSpeed * 3.6) : 0,
      traffic: g.traffic.count, peds: g.peds.peds.length, trams: g.trams.trams.length,
      afloat: !!g.driving?.afloat, swimming: g.player.swimming,
      movingTraffic: [...g.traffic.drivers.keys()].filter((v: Any) => Math.abs(v.forwardSpeed) > 1).length,
    };
  });
const shot = async (name: string) => {
  await page.screenshot({ path: `screenshots/${name}.png` });
  console.log(name.padEnd(16), JSON.stringify(await status()), (await page.locator('#stats').innerText()).split('\n')[0]);
};

await load(page, `${process.argv[2] ?? DEV}/?stats`);
await page.waitForTimeout(2500);
await shot('m2-spawn');

await page.waitForTimeout(3000);
const tram = await page.evaluate(() => {
  const g = (window as Any).game;
  const t = g.trams.trams[0];
  if (!t) return null;
  const b = t.sections[1].translation(), a = t.sections[1].rotation();
  const x = b.x - Math.sin(a) * 14, z = b.y + Math.cos(a) * 14;
  g.player.place(x, z, a - Math.PI / 2);
  g.rig.yaw = Math.atan2(b.y - z, b.x - x);
  return { line: t.run.line, speed: +t.speed.toFixed(1) };
});
await page.waitForTimeout(600);
console.log('tram', JSON.stringify(tram));
await shot('m2-tram');

await page.evaluate(() => {
  const g = (window as Any).game;
  const v = [...g.traffic.drivers.keys()].find((v: Any) => Math.abs(v.forwardSpeed) > 3) ?? [...g.traffic.drivers.keys()][0];
  g.player.place(v.x - Math.cos(v.angle) * 12 + Math.sin(v.angle) * 3, v.z - Math.sin(v.angle) * 12 - Math.cos(v.angle) * 3, v.angle);
  g.rig.yaw = v.angle;
});
await page.waitForTimeout(1500);
await shot('m2-traffic');

const quay = await page.evaluate(() => {
  const g = (window as Any).game;
  for (let z = -600; z < 600; z += 10) {
    let x = 0;
    while (x > -700 && !g.water.contains(x, z)) x -= 2;
    if (x <= -700) continue;
    if (g.physics.castStatic(x + 35, z, -1, 0, 36) < 36 || g.physics.boxOverlaps(x + 35, z, Math.PI, 3, 1.5)) continue;
    const v = g.vehicles.find((v: Any) => !g.traffic.has(v));
    v.teleport(x + 35, z, Math.PI);
    g.player.place(x + 35, z + 2.5, Math.PI);
    return [x, z];
  }
  return null;
});
console.log('quay at', quay);
await page.keyboard.press('KeyE');
await hold(page, ['KeyW'], 2600);
await page.waitForFunction(() => (window as Any).game.driving?.afloat, null, { timeout: 5000 });
await hold(page, ['KeyW'], 2000);
await shot('m2-afloat');
await hold(page, ['KeyS'], 1500);
await page.keyboard.press('KeyE');
await page.waitForFunction(() => (window as Any).game.player.swimming, null, { timeout: 5000 });
await hold(page, ['KeyW'], 2500);
await shot('m2-swimming');
await browser.close();
