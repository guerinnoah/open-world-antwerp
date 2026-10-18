// pnpm tsx tools/dev/health.ts [port]
import { PHONE, load, open, type Any } from './probe.ts';

const port = process.argv[2] ?? '5173';
const url = `http://localhost:${port}/?spawn=grotemarkt&solo`;
const { browser, page } = await open({ logConsole: 'console' });
await load(page, url);
await page.waitForTimeout(1500);
const hud = () => page.evaluate(() => ({
  health: +(window as Any).game.player.health.toFixed(1),
  bar: (document.querySelector('#hud .health > :not(.lost)') as HTMLElement)?.style.width,
  wasted: document.querySelector('#hud .wasted')?.classList.contains('show'),
  toast: document.querySelector('#hud .toast.show')?.textContent ?? '',
}));
console.log('start', JSON.stringify(await hud()));

const hit = await page.evaluate(() => {
  const g = (window as Any).game, p = g.player;
  const v = g.vehicles.filter((c: Any) => !g.traffic.has(c) && c.spec.name === 'sedan').sort((a: Any, b: Any) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  const a = p.heading;
  v.body.setTranslation({ x: p.x - Math.cos(a) * 5, y: p.z - Math.sin(a) * 5 }, true);
  v.body.setRotation(a, true);
  v.body.setLinvel({ x: Math.cos(a) * 14, y: Math.sin(a) * 14 }, true);
  v.controls = { steer: 0, throttle: 1, handbrake: false };
  v.savePrev();
  g.rig.yaw = a + Math.PI / 2;
  return v.spec.name;
});
await page.waitForTimeout(250);
await page.screenshot({ path: 'screenshots/health-hit.png' });
await page.waitForTimeout(1200);
console.log(`hit by ${hit}`, JSON.stringify(await hud()));
await page.screenshot({ path: 'screenshots/health-after-hit.png' });

await page.evaluate(() => (window as Any).game.hurt(200));
await page.waitForTimeout(1600);
console.log('wasted', JSON.stringify(await hud()), JSON.stringify(await page.evaluate(() => ({ down: (window as Any).game.player.down > 0 }))));
await page.screenshot({ path: 'screenshots/health-wasted.png' });
await page.keyboard.press('KeyE'); // ignored while dead
await page.waitForTimeout(3300);
await page.screenshot({ path: 'screenshots/health-black.png' });
await page.waitForTimeout(800);
const at = await page.evaluate(() => {
  const g = (window as Any).game, [hx, hz] = g.hospital;
  return { fromHospital: +Math.hypot(g.player.x - hx, g.player.z - hz).toFixed(1), driving: !!g.driving, down: g.player.down };
});
console.log('respawned', JSON.stringify(await hud()), JSON.stringify(at));
await page.screenshot({ path: 'screenshots/health-hospital.png' });

const car = await page.evaluate(() => {
  const g = (window as Any).game, p = g.player;
  const v = g.vehicles.filter((c: Any) => !g.traffic.has(c) && !c.remote && c.spec.name !== 'bike' && c.spec.name !== 'scooter').sort((a: Any, b: Any) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
  g.enterVehicle(v);
  g.hurt(150);
  return { driving: !!g.driving, wasted: g.wasted > 0 };
});
await page.waitForTimeout(5000);
console.log('car death', JSON.stringify(car), JSON.stringify(await page.evaluate(() => {
  const g = (window as Any).game;
  return { driving: !!g.driving, visible: g.player.object.visible, health: g.player.health };
})));

const crash = await page.evaluate(() => {
  const g = (window as Any).game, p = g.player;
  const [v, wall] = g.vehicles
    .filter((c: Any) => !g.traffic.has(c) && !c.remote && c.spec.name === 'sedan')
    .map((c: Any) => {
      // Cast from both front corners: a wall square on, not one the car would glance off.
      const cos = Math.cos(c.angle), sin = Math.sin(c.angle), w = c.spec.width / 2;
      const left = g.physics.castStatic(c.x - sin * w, c.z + cos * w, cos, sin, 60);
      const right = g.physics.castStatic(c.x + sin * w, c.z - cos * w, cos, sin, 60);
      return [c, Math.abs(left - right) < 1 ? Math.min(left, right) : Infinity];
    })
    .filter(([, d]: Any) => d > 15 && d < 40)
    .sort(([a]: Any, [b]: Any) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] ?? [];
  if (!v) return { wallAhead: null };
  g.enterVehicle(v);
  const a = v.angle;
  v.body.setLinvel({ x: Math.cos(a) * 25, y: Math.sin(a) * 25 }, true);
  return { wallAhead: +wall.toFixed(1) };
});
await page.waitForTimeout(3000);
console.log('crash', JSON.stringify(crash), JSON.stringify(await hud()));

const phone = await browser.newPage(PHONE);
await load(phone, url);
await phone.waitForTimeout(1500);
await phone.evaluate(() => (window as Any).game.hurt(80));
await phone.waitForTimeout(1500);
await phone.screenshot({ path: 'screenshots/health-phone.png' });
await phone.evaluate(() => (window as Any).game.hurt(80));
await phone.waitForTimeout(1600);
await phone.screenshot({ path: 'screenshots/health-phone-wasted.png' });
await browser.close();
