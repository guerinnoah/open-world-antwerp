// pnpm tsx tools/dev/hall.ts <centraal|cathedral|mas|steen> [view…]
import { DEV, load, open, type Any } from './probe.ts';

type View = [name: string, x: number, z: number, heading: number, pitch: number, level?: number]; // landmark frame, heading in degrees

const VIEWS: Record<string, View[]> = {
  steen: [['hall', -2, 6, -60, 0.15], ['desk', 6, 7.5, -100, 0.1], ['shop', 8, 2, 0, 0.12], ['story', -8, 4.5, 180, 0.05], ['tapestries', 6, 3, -90, 0.05]],
  centraal: [['dome', 104, 1.5, 180, 0.35], ['stair', 98, 1.5, 180, 0.15], ['landing', 84, 1.5, 180, 0.1, 1], ['trainhall', 50, 1.5, 180, 0.12, 1],
    ['platform', 0, -9, 180, 0.08, 1], ['void', -20, -7.5, 90, 0.45, 1], ['back', 70, 1.5, 0, 0.2, 1], ['domeup', 86, 1.5, 0, -0.75, 1], ['vaultup', 20, 1.5, 180, -0.75, 1]],
  cathedral: [['nave', 52, -2, 180, 0.2], ['altar', -10, -2, 180, 0.12], ['aisle', 30, 15, 180, 0.15], ['raising', -11, 15, 90, 0.08],
    ['descent', -11, -18, -90, 0.08], ['west', 10, -2, 0, 0.3], ['cupola', 3, -1, 180, -0.75], ['vault', 30, -1, 180, -0.75]],
  mas: [['ground', -10, 15, 0, 0.1], ['escalator', -4, 17.3, 0, 0.15], ['floor4', -14, 15, 0, 0.1, 4], ['roof', 0, 9, 90, 0.1, 10], ['roof2', -14, -14, -135, 0.05, 10]],
};

const [id, ...only] = process.argv.slice(2);
if (!VIEWS[id]) throw new Error(`usage: tsx tools/dev/hall.ts <${Object.keys(VIEWS).join('|')}> [view…]`);
const { browser, page } = await open({ logConsole: 'console' });
await load(page, `${DEV}/?spawn=grotemarkt`);
const state = () => page.evaluate(`(() => {
  const g = window.game, h = g.interiors.halls;
  return { indoors: g.indoors, x: +g.player.x.toFixed(1), z: +g.player.z.toFixed(1), y: +g.player.elevation.toFixed(2), level: h.active ? h.active.level : null,
    hint: document.querySelector('#hud .hint')?.textContent };
})()`) as Promise<Any>;

await page.evaluate(`(() => {
  const g = window.game, d = g.interiors.halls.doors.find((d) => d.hall === '${id}');
  g.player.place(d.x + d.nx * 1.4, d.z + d.nz * 1.4, Math.atan2(-d.nz, -d.nx));
  g.rig.yaw = Math.atan2(-d.nz, -d.nx);
  g.rig.pitch = 0.12;
})()`);
await page.waitForTimeout(1200);
console.log('outside:', await state());
await page.screenshot({ path: `screenshots/hall-${id}-door.png` });
await page.keyboard.press('KeyE');
await page.waitForTimeout(1500);
console.log('inside:', await state());
await page.screenshot({ path: `screenshots/hall-${id}-entry.png` });

for (const [name, x, z, heading, pitch, level = 0] of VIEWS[id]) {
  if (only.length && !only.includes(name)) continue;
  await page.evaluate(`(() => {
    const g = window.game, h = g.interiors.halls, a = h.active, lm = a.lm;
    const c = Math.cos(lm.angle), s = Math.sin(lm.angle);
    const wx = lm.x + ${x} * c - ${z} * s, wz = lm.z + ${x} * s + ${z} * c;
    h.setLevel(${level});
    g.player.place(wx, wz, ${(heading * Math.PI) / 180} + lm.angle, 0);
    h.step(0);
    g.rig.yaw = ${(heading * Math.PI) / 180} + lm.angle;
    g.rig.pitch = ${pitch};
    g.rig.snap();
  })()`);
  await page.waitForTimeout(900);
  const file = `screenshots/hall-${id}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(file, await state());
}
await browser.close();
