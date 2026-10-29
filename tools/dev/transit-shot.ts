// pnpm tsx tools/dev/transit-shot.ts <tram|bus> [baseUrl]: a tram, or a one- and a two-section bus, stopped and shot from front, side and rear.
import { DEV, loaded, open, type Any } from './probe.ts';

const [kind = 'tram', base = DEV] = process.argv.slice(2);
if (kind !== 'tram' && kind !== 'bus') throw new Error('usage: transit-shot.ts <tram|bus> [baseUrl]');
const fleet = kind === 'tram' ? 'trams' : 'buses'; // game.trams.trams, game.buses.buses
const views = kind === 'tram'
  ? ([['front', 1, 0.35, 8], ['side', 0.5, 1, 12], ['rear', -1, 0.3, 9]] as const)
  : ([['front', 1, 0.45, 9], ['side', 0, 1, 13], ['rear', -1, 0.35, 9]] as const);

const { browser, page } = await open();
await page.goto(`${base}/?noao`);
await page.addStyleTag({ content: '#hud .toast { display: none }' });
await loaded(page);
await page.waitForTimeout(3000);
for (const sections of kind === 'tram' ? [0] : [1, 2]) { // 0: any length
  for (const [name, along, side, back] of views) {
    await page.waitForFunction(([fleet, n]) => (window as Any).game[fleet][fleet].some((v: Any) => !n || v.sections.length === n), [fleet, sections] as const, { timeout: 120_000 });
    const info = await page.evaluate(([fleet, n, along, side, back]) => {
      const g = (window as Any).game;
      const all = g[fleet][fleet].filter((v: Any) => !n || v.sections.length === n);
      const v = all.find((v: Any) => v.speed > 1) ?? all[0];
      v.speed = 0; v.dwell = 30;
      const s = v.sections[along < 0 ? v.sections.length - 1 : 0];
      const p = s.translation(), a = s.rotation();
      const fx = Math.cos(a), fz = Math.sin(a), rx = -fz, rz = fx;
      const dirX = along * fx + side * rx, dirZ = along * fz + side * rz;
      const len = Math.hypot(dirX, dirZ);
      const x = p.x + (dirX / len) * back, z = p.y + (dirZ / len) * back;
      g.player.place(x, z, 0);
      g.rig.yaw = Math.atan2(p.y - z, p.x - x);
      g.rig.pitch = 0.05;
      return `${v.run.line} → ${v.run.to}, ${v.sections.length} section(s), ${g[fleet][fleet].length} running`;
    }, [fleet, sections, along, side, back] as const);
    await page.waitForTimeout(1500);
    const file = `screenshots/${kind}${sections ? `-${sections}` : ''}-${name}.png`;
    await page.screenshot({ path: file });
    console.log(file, info);
  }
}
await browser.close();
