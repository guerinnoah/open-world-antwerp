// pnpm mobile [baseUrl]
import { DEV, PHONE, load, open, type Any } from './probe.ts';

const { browser, page } = await open({ context: PHONE });
await load(page, `${process.argv[2] ?? DEV}/?stats`);
await page.waitForTimeout(800);

const pos = () => page.evaluate(() => {
  const p = (window as Any).game.player;
  return [+p.x.toFixed(1), +p.z.toFixed(1)];
});
const before = await pos();
const stick = (await page.locator('#touch .stick').boundingBox())!;
const cx = stick.x + stick.width / 2, cy = stick.y + stick.height / 2;
const cdp = await page.context().newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - i * 14 }] });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/m1-mobile.png' });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
console.log('touch controls:', await page.locator('#touch').count() ? 'shown' : 'MISSING', '| walked from', before, 'to', await pos());
console.log((await page.locator('#stats').innerText()).replace(/\n/g, ' | '));
await browser.close();
