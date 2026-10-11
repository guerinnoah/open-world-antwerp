import { DEV, hold, load, open, rideState, shooter, stand, type Any } from './probe.ts';

const { browser, page } = await open({ logConsole: 'console' });
await load(page, `${DEV}/?spawn=grotemarkt&stats&solo`);
const shot = shooter(page, 'scooter', () => rideState(page));

const found = await page.evaluate(() => {
  const g = (window as Any).game;
  const all = g.scooters.parked as Any[];
  const near = all.filter((p) => !p.taken && !p.down).sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const p = near.find((p) => near.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2).length >= 3) ?? near[0];
  return { total: all.length, p: { x: p.x, z: p.z, angle: p.angle, brand: p.brand } };
});
console.log('parked scooters:', found.total);
const { p } = found;
const sx = -Math.sin(p.angle), sz = Math.cos(p.angle);
await stand(page, p.x - sx, p.z - sz, Math.atan2(sz, sx), 0.3);
await page.waitForTimeout(1500);
await shot('parked');
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
await shot('mounted');
await page.evaluate(() => {
  const g = (window as Any).game;
  g.rig.yaw = g.driving.angle + Math.PI / 2;
  g.rig.pitch = 0.05;
});
await page.waitForTimeout(400);
await shot('pose');
await page.keyboard.down('KeyW');
await page.waitForTimeout(3000);
await shot('riding');
await page.keyboard.down('KeyA');
await page.waitForTimeout(700);
await shot('turn');
await page.keyboard.up('KeyA');
await page.keyboard.press('KeyH');
await page.waitForTimeout(500);
await page.keyboard.up('KeyW');
await page.waitForTimeout(2500);
await shot('stopped');
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
await shot('left');

const target = await page.evaluate(() => {
  const g = (window as Any).game;
  const car = g.vehicles.filter((v: Any) => v.spec.name !== 'scooter' && v.spec.name !== 'bike' && !v.remote && !g.traffic.has(v))
    .filter((v: Any) => Math.hypot(v.x - g.player.x, v.z - g.player.z) > 6)
    .sort((a: Any, b: Any) => Math.hypot(a.x - g.player.x, a.z - g.player.z) - Math.hypot(b.x - g.player.x, b.z - g.player.z))[0];
  const p = (g.scooters.parked as Any[]).filter((p) => !p.taken && !p.down)
    .sort((a, b) => Math.hypot(a.x - car.x, a.z - car.z) - Math.hypot(b.x - car.x, b.z - car.z))[0];
  g.player.place(car.x + Math.sin(car.angle) * (car.spec.width / 2 + 0.6), car.z - Math.cos(car.angle) * (car.spec.width / 2 + 0.6), car.angle);
  return { x: p.x, z: p.z, angle: p.angle };
});
await page.waitForTimeout(300);
await page.keyboard.press('KeyE');
await page.waitForTimeout(500);
await page.evaluate(([x, z, a]) => {
  const g = (window as Any).game;
  const h = [0, Math.PI, Math.PI / 2, -Math.PI / 2].map((d) => a + d).find((h) => !g.physics.castSolid(x, z, -Math.cos(h), -Math.sin(h), 9)) ?? a;
  g.driving.teleport(x - Math.cos(h) * 8, z - Math.sin(h) * 8, h);
  g.rig.yaw = h;
}, [target.x, target.z, target.angle]);
await hold(page, ['KeyW'], 1300);
await hold(page, ['Space'], 900);
const knocked = await page.evaluate(([x, z]) => {
  const g = (window as Any).game;
  return (g.scooters.parked as Any[]).filter((p) => p.down && Math.hypot(p.x - x, p.z - z) < 4).length;
}, [target.x, target.z]);
await page.evaluate(([x, z]) => {
  const g = (window as Any).game;
  g.rig.yaw = Math.atan2(z - g.driving.z, x - g.driving.x);
  g.rig.pitch = 0.35;
}, [target.x, target.z]);
await page.waitForTimeout(600);
await shot('knocked');
console.log('knocked over:', knocked);
await page.keyboard.press('KeyE');
await page.waitForTimeout(400);
await page.evaluate(([x, z]) => {
  const g = (window as Any).game;
  const p = (g.scooters.parked as Any[]).filter((p) => p.down).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
  const h = [0, 1, 2, 3].map((k) => (k * Math.PI) / 2).find((h) => !g.physics.castSolid(p.x, p.z, -Math.cos(h), -Math.sin(h), 3)) ?? 0;
  g.player.place(p.x - Math.cos(h) * 2.2, p.z - Math.sin(h) * 2.2, h);
  g.rig.yaw = h;
  g.rig.pitch = 0.45;
}, [target.x, target.z]);
await page.waitForTimeout(800);
await shot('fallen');
await browser.close();
