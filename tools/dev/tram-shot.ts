import { DEV, loaded, open, type Any } from './probe.ts';

const { browser, page } = await open();
await page.goto(`${DEV}/?noao`);
await page.addStyleTag({ content: '#hud .toast { display: none }' });
await loaded(page);
await page.waitForTimeout(5000);
for (const [name, along, side, back] of [['front', 1, 0.35, 8], ['side', 0.5, 1, 12], ['rear', -1, 0.3, 9]] as const) {
  const info = await page.evaluate(([along, side, back]) => {
    const g = (window as Any).game;
    const t = g.trams.trams.find((t: Any) => t.speed > 1) ?? g.trams.trams[0];
    if (!t) return null;
    t.speed = 0; t.dwell = 30;
    const i = along > 0 ? 0 : along < 0 ? t.sections.length - 1 : Math.floor(t.sections.length / 2);
    const b = t.sections[i].translation(), a = t.sections[i].rotation();
    const fx = Math.cos(a), fz = Math.sin(a), rx = -fz, rz = fx;
    const dirX = along * fx + side * rx, dirZ = along * fz + side * rz;
    const len = Math.hypot(dirX, dirZ);
    const x = b.x + (dirX / len) * back, z = b.y + (dirZ / len) * back;
    g.player.place(x, z, 0);
    g.rig.yaw = Math.atan2(b.y - z, b.x - x);
    g.rig.pitch = 0.05;
    return `${t.run.line} → ${t.run.to}, ${t.layout.length} sections`;
  }, [along, side, back]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `screenshots/tram-${name}.png` });
  console.log(name, info);
}
await browser.close();
