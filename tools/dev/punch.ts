// pnpm tsx tools/dev/punch.ts [port]
import { load, loaded, open, type Any } from './probe.ts';

const { browser, page } = await open({ logConsole: 'console' });
await load(page, `http://localhost:${process.argv[2] ?? '5173'}/?spawn=grotemarkt&solo`);
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const g = (window as Any).game;
  g.player.step = () => {};
  g.rig.yaw = g.player.heading + Math.PI / 2;
  g.rig.pitch = 0.08;
});
for (const at of [0, 0.15, 0.3, 0.4, 0.6, 0.8]) {
  await page.evaluate((at) => ((window as Any).game.player.punch = 0.45 * (1 - at) || 0.0001), at);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `screenshots/punch-pose-${String(at * 100).padStart(2, '0')}.png` });
}
await page.evaluate(() => {
  const g = (window as Any).game;
  g.rig.yaw = g.player.heading + Math.PI * 0.8;
  g.player.punch = 0.45 * 0.6;
});
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/punch-pose-front.png' });

await page.reload();
await loaded(page);
await page.waitForTimeout(1500);
const before = await page.evaluate(() => {
  const g = (window as Any).game;
  const p = g.player, h = p.heading;
  const ped = g.peds.peds.find((q: Any) => q.state === 'walk');
  const x = p.x + Math.cos(h + 0.4) * 1.1, z = p.z + Math.sin(h + 0.4) * 1.1;
  ped.body.setTranslation({ x, y: z }, true);
  ped.body.setLinvel({ x: 0, y: 0 }, true);
  ped.prev = { x, z };
  g.rig.yaw = h + 0.6;
  g.rig.pitch = 0.15;
  (window as Any).target = ped;
  return { heading: +h.toFixed(2), peds: g.peds.peds.length };
});
await page.keyboard.press('KeyR');
await page.waitForTimeout(140);
await page.screenshot({ path: 'screenshots/punch-swing.png' });
await page.waitForTimeout(400);
await page.screenshot({ path: 'screenshots/punch-hit.png' });
const after = await page.evaluate(() => {
  const g = (window as Any).game, ped = (window as Any).target;
  return {
    heading: +g.player.heading.toFixed(2), target: ped.state,
    fleeing: g.peds.peds.filter((q: Any) => q.state === 'flee').length,
  };
});
console.log('before', JSON.stringify(before), 'after', JSON.stringify(after));
await browser.close();
