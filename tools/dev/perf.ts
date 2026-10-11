// pnpm perf [cpuSlowdown=4] [extra query]
import { DEV, PHONE, besideParkedCar, load, open, type Any } from './probe.ts';

const slowdown = Number(process.argv[2] ?? 4);
const extra = process.argv[3] ? `&${process.argv[3]}` : '';
const { browser, page } = await open({ context: PHONE });
const cdp = await page.context().newCDPSession(page);
const t0 = Date.now();
await cdp.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
await load(page, `${DEV}/?stats${extra}`, 180_000);
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s at ${slowdown}× CPU slowdown`);
const sample = async (label: string) => {
  await page.waitForTimeout(2500);
  console.log(label.padEnd(18), (await page.locator('#stats').innerText()).replace(/\n/g, ' | '));
};
await page.waitForTimeout(5000);
await sample('Astridplein');
await besideParkedCar(page, 1560, 262);
await page.waitForTimeout(300);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })));
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));
await sample('driving');
await page.evaluate(() => {
  const g = (window as Any).game;
  g.driving?.teleport(20, 30, g.driving.angle);
});
await sample('old town');
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })));
console.log('JS heap', await page.evaluate(() => ((performance as Any).memory?.usedJSHeapSize / 1e6).toFixed(0)), 'MB');
await browser.close();
