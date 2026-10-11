import { DEV, hold, load, open, rideState, shooter, type Any } from './probe.ts';

const { browser, page } = await open({ logConsole: 'console' });
await load(page, `${DEV}/?spawn=grotemarkt&stats&solo`);
const shot = shooter(page, 'motorbike', () => rideState(page));

const standBy = (kind: string) => page.evaluate((kind) => {
  const g = (window as Any).game;
  const all = g.vehicles.filter((v: Any) => v.spec.name === kind && !v.driven && !v.remote);
  const v = all.sort((a: Any, b: Any) => Math.hypot(a.x - g.player.x, a.z - g.player.z) - Math.hypot(b.x - g.player.x, b.z - g.player.z))[0];
  if (!v) return 0;
  const sx = -Math.sin(v.angle), sz = Math.cos(v.angle);
  const side = [1, -1].find((s) => !g.physics.castSolid(v.x, v.z, sx * s, sz * s, 1.6)) ?? 1;
  g.player.place(v.x + sx * side * 1.3, v.z + sz * side * 1.3, Math.atan2(-sz * side, -sx * side));
  g.rig.yaw = Math.atan2(-sz * side, -sx * side);
  g.rig.pitch = 0.25;
  return all.length;
}, kind);

console.log('parked motorbikes:', await standBy('motorbike'));
await page.waitForTimeout(1200);
await shot('parked');
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
await page.evaluate(() => {
  const g = (window as Any).game;
  const v = g.driving;
  let spot = [v.x, v.z, v.angle];
  search: for (let r = 5; r < 80; r += 5) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      for (let h = 0; h < Math.PI * 2; h += Math.PI / 4) {
        if (g.physics.boxOverlaps(x, z, h, 1.5, 1.5) || g.physics.castSolid(x, z, Math.cos(h), Math.sin(h), 40)) continue;
        if (g.physics.castSolid(x, z, -Math.sin(h), Math.cos(h), 4) || g.physics.castSolid(x, z, Math.sin(h), -Math.cos(h), 4)) continue;
        spot = [x, z, h];
        break search;
      }
    }
  }
  v.teleport(spot[0], spot[1], spot[2]);
  g.rig.yaw = v.angle + Math.PI / 2;
  g.rig.pitch = 0.05;
});
await page.waitForTimeout(400);
await shot('pose');
await page.keyboard.down('KeyW');
await page.waitForTimeout(800);
await shot('riding');
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyD');
await page.waitForTimeout(500);
await shot('turn');
await page.keyboard.up('KeyD');
await hold(page, ['KeyS'], 2500);
await shot('stopped');
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
await shot('left');

console.log('parked mopeds:', await standBy('moped'));
await page.waitForTimeout(1200);
await shot('moped');

const traffic = await page.evaluate(() => {
  const g = (window as Any).game;
  const v = g.vehicles.filter((v: Any) => (v.spec.name === 'motorbike' || v.spec.name === 'moped') && g.traffic.has(v))
    .sort((a: Any, b: Any) => Math.hypot(a.x - g.player.x, a.z - g.player.z) - Math.hypot(b.x - g.player.x, b.z - g.player.z))[0];
  if (!v) return null;
  const sx = -Math.sin(v.angle), sz = Math.cos(v.angle);
  g.player.place(v.x + Math.cos(v.angle) * 6 + sx * 3, v.z + Math.sin(v.angle) * 6 + sz * 3, v.angle + Math.PI);
  g.rig.yaw = Math.atan2(v.z - g.player.z, v.x - g.player.x);
  g.rig.pitch = 0.15;
  return { kind: v.spec.name, kmh: +(Math.abs(v.forwardSpeed) * 3.6).toFixed(0) };
});
console.log('in traffic:', JSON.stringify(traffic));
await page.waitForTimeout(500);
await shot('traffic');
await browser.close();
