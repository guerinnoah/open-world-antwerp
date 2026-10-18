// pnpm tsx tools/dev/fpvshot.ts [baseUrl] — first-person view on foot and from a car's cab.
import { DEV, besideParkedCar, load, open } from './probe.ts';

const base = process.argv[2] ?? DEV;
const { browser, page } = await open();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await load(page, `${base}/?play&spawn=grotemarkt&fpv&solo`);
await page.waitForTimeout(2000);
await page.evaluate(() => {
  const g = (window as any).game;
  g.player.place(0, 0, 0.9);
  g.rig.yaw = 0.9;
  g.rig.pitch = 0;
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'screenshots/fpv-foot.png' });
console.log('fpv-foot.png');

await besideParkedCar(page, 60, 40);
await page.waitForTimeout(300);
await page.keyboard.press('KeyE');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'screenshots/fpv-car.png' });
console.log('fpv-car.png');

await browser.close();
