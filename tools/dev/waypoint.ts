// pnpm tsx tools/dev/waypoint.ts [baseUrl]: open the map, set a waypoint at Centraal, check the route on the map and minimap.
import { mkdirSync } from 'node:fs';
import { DEV, PHONE, load, open, type Any } from './probe.ts';

const [base = DEV] = process.argv.slice(2);
mkdirSync('screenshots', { recursive: true });

const state = (page: Any) =>
  page.evaluate(() => {
    const g = (window as Any).game;
    return {
      open: g.mapOpen, paused: g.paused, route: Math.round(g.gps.route?.length ?? -1), points: (g.gps.route?.points.length ?? 0) / 2,
      dest: document.querySelector('#worldmap .dest')?.textContent, street: document.querySelector('#worldmap .street')?.textContent,
    };
  });
const screenOf = (page: Any, x: number, z: number) => page.evaluate(`window.game.worldMap.toScreen(${x}, ${z})`) as Promise<[number, number]>;

for (const [name, context] of [['desktop', undefined], ['phone', PHONE]] as const) {
  const { browser, page } = await open({ context, logConsole: name });
  page.on('framenavigated', (f) => f === page.mainFrame() && console.log(name, 'navigated', f.url()));
  await load(page, `${base}/?spawn=grotemarkt`);
  await page.waitForTimeout(1000);
  if (name === 'desktop') await page.keyboard.press('KeyP');
  else await page.tap('#minimap');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/map-${name}-open.png` });
  if (name === 'desktop') {
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(100);
    const [sx, sy] = await screenOf(page, 1491, 372);
    await page.mouse.move(sx, sy);
    await page.mouse.click(sx, sy);
  } else {
    const [sx, sy] = await screenOf(page, 120, 300);
    await page.touchscreen.tap(sx, sy);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `screenshots/map-${name}-route.png` });
  console.log(name, 'waypoint set', await state(page));
  if (name === 'desktop') await page.keyboard.press('Escape');
  else await page.tap('#worldmap .close');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `screenshots/map-${name}-minimap.png` });
  console.log(name, 'closed', await state(page));
  await browser.close();
}
