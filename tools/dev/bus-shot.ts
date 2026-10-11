import { DEV, loaded, open, type Any } from './probe.ts';

const { browser, page } = await open();
await page.goto(`${DEV}/?noao`);
await page.addStyleTag({ content: '#hud .toast { display: none }' });
await loaded(page);
await page.waitForFunction(() => (window as Any).game?.buses?.buses.length > 1, undefined, { timeout: 60_000 });
await page.waitForTimeout(3000);
for (const sections of [1, 2]) {
  for (const [name, along, side, back] of [['front', 1, 0.45, 9], ['side', 0, 1, 13], ['rear', -1, 0.35, 9]] as const) {
    await page.waitForFunction((n) => (window as Any).game?.buses?.buses.some((b: Any) => b.sections.length === n), sections, { timeout: 120_000 });
    const info = await page.evaluate(([sections, along, side, back]) => {
      const g = (window as Any).game;
      const b = g.buses.buses.find((b: Any) => b.sections.length === sections && b.speed > 1) ?? g.buses.buses.find((b: Any) => b.sections.length === sections);
      if (!b) return null;
      b.speed = 0; b.dwell = 30;
      const i = along < 0 ? b.sections.length - 1 : 0;
      const p = b.sections[i].translation(), a = b.sections[i].rotation();
      const fx = Math.cos(a), fz = Math.sin(a), rx = -fz, rz = fx;
      const dirX = along * fx + side * rx, dirZ = along * fz + side * rz;
      const len = Math.hypot(dirX, dirZ);
      const x = p.x + (dirX / len) * back, z = p.y + (dirZ / len) * back;
      g.player.place(x, z, 0);
      g.rig.yaw = Math.atan2(p.y - z, p.x - x);
      g.rig.pitch = 0.05;
      return `${b.run.line} → ${b.run.to}, ${b.sections.length} section(s), ${g.buses.buses.length} buses`;
    }, [sections, along, side, back]);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `screenshots/bus-${sections}-${name}.png` });
    console.log(sections, name, info);
  }
}
await browser.close();
