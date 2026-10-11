import { hold, loaded, open, shooter, type Any } from './probe.ts';

const { browser, page } = await open({ logConsole: 'console' });
await page.routeWebSocket(/.*/, () => {});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/?spawn=grotemarkt&stats`, { timeout: 300_000 });
await loaded(page, 300_000);
const state = () => page.evaluate(() => {
  const g = (window as Any).game;
  const t = g.tram;
  return {
    tram: t ? `${t.run.line} → ${t.run.to}` : null, kmh: t ? +(t.speed * 3.6).toFixed(1) : 0, s: t ? Math.round(t.s) : null,
    player: [Math.round(g.player.x), Math.round(g.player.z)], hint: document.querySelector('#hud .hint')?.textContent,
    toast: document.querySelector('#hud .toast')?.textContent,
  };
});
const shot = shooter(page, 'tram-drive', state);

await page.waitForFunction(() => (window as Any).game.trams.trams.some((t: Any) => t.run.len - t.s > 600), null, { timeout: 30_000 });
await page.evaluate(() => {
  const g = (window as Any).game;
  const t = g.trams.trams.find((t: Any) => t.run.len - t.s > 600);
  t.speed = 0;
  t.dwell = 30;
  const cab = t.sections[0], p = cab.translation(), a = cab.rotation();
  const [sx, sz] = [-Math.sin(a), Math.cos(a)];
  g.player.place(p.x + sx * 2.6, p.y + sz * 2.6, a + Math.PI / 2);
  g.rig.yaw = Math.atan2(-sz, -sx);
  g.rig.pitch = 0.2;
});
await page.waitForTimeout(1200);
await shot('beside');
await page.keyboard.press('KeyE');
await page.waitForTimeout(1500);
await shot('cab');
await page.keyboard.down('KeyW');
await page.waitForTimeout(6000);
await shot('power');
await page.keyboard.up('KeyW');
await page.keyboard.press('KeyH');
await page.waitForTimeout(2000);
await shot('coast');
await hold(page, ['Space'], 4000);
await shot('stopped');
await hold(page, ['KeyS'], 2500);
await shot('reverse');
await hold(page, ['KeyW'], 1500);
await hold(page, ['Space'], 1500);
await page.keyboard.press('KeyE');
await page.waitForTimeout(1000);
await shot('out');
await page.waitForTimeout(5000);
console.log('tram after', JSON.stringify(await page.evaluate(() => {
  const g = (window as Any).game;
  const t = g.trams.trams.find((t: Any) => t.controls === null && Math.hypot(t.sections[0].translation().x - g.player.x, t.sections[0].translation().y - g.player.z) < 60);
  return t && { kmh: +(t.speed * 3.6).toFixed(1), hold: t.hold };
})));
await shot('left');

const setup = await page.evaluate(() => {
  const g = (window as Any).game;
  const [a, b] = g.trams.trams.filter((t: Any) => t.run.len - t.s > 400);
  if (!a || !b) return null;
  b.run = a.run; b.s = a.s + 70 + b.length; b.speed = 0; b.dwell = 60;
  a.speed = 0;
  const p = a.run.p;
  let along = 0;
  for (let i = 0; i < p.length - 2; i += 2) {
    const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (along + len >= a.s + 25) {
      const k = (a.s + 25 - along) / len;
      const car = g.vehicles.find((v: Any) => !v.driven && !v.remote && v.spec.name === 'hatch');
      car.teleport(p[i] + (p[i + 2] - p[i]) * k, p[i + 1] + (p[i + 3] - p[i + 1]) * k, Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]) + 0.3);
      (window as Any).planted = car;
      break;
    }
    along += len;
  }
  const cab = a.sections[0].translation();
  g.player.place(cab.x, cab.y, 0);
  return a.run.line;
});
if (setup) {
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const g = (window as Any).game;
    const t = g.trams.trams.find((t: Any) => Math.hypot(t.sections[0].translation().x - g.player.x, t.sections[0].translation().y - g.player.z) < 1);
    g.boardTram(t);
  });
  await hold(page, ['KeyW'], 16000);
  await shot('rear-end');
  console.log('car on the rails', JSON.stringify(await page.evaluate(() => {
    const g = (window as Any).game, car = (window as Any).planted, p = g.tram.run.p;
    let off = Infinity;
    for (let i = 0; i < p.length - 2; i += 2) {
      const dx = p[i + 2] - p[i], dz = p[i + 3] - p[i + 1];
      const k = Math.max(0, Math.min(1, ((car.x - p[i]) * dx + (car.z - p[i + 1]) * dz) / (dx * dx + dz * dz || 1)));
      off = Math.min(off, Math.hypot(p[i] + dx * k - car.x, p[i + 1] + dz * k - car.z));
    }
    return { offTrack: +off.toFixed(2), tramS: Math.round(g.tram.s) };
  })));
  await page.evaluate(() => {
    const g = (window as Any).game;
    g.trams.trams.filter((t: Any) => t !== g.tram && t.run === g.tram.run).forEach((t: Any) => g.trams.remove(t));
    g.tram.s = g.tram.run.len - 40;
  });
  await hold(page, ['KeyW'], 8000);
  await shot('buffer');
}
await browser.close();
