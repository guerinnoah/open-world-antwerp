// pnpm shot [baseUrl] [view…]
import { DEV, load, open } from './probe.ts';

const [base = DEV, ...views] = process.argv.slice(2);
const names = views.length ? views : ['Grote Markt', 'Cathedral', 'Centraal', 'MAS', 'Overview'];

const { browser, page } = await open();
page.on('console', (m) => m.type() !== 'debug' && console.log(`[browser] ${m.text()}`));
for (const name of names) {
  await load(page, `${base}/?fly&view=${encodeURIComponent(name)}`);
  await page.waitForTimeout(1500);
  const file = `screenshots/${name.toLowerCase().replace(/\s+/g, '-')}.png`;
  await page.screenshot({ path: file });
  console.log(`${file}  ${await page.locator('#stats').innerText()}`.replace(/\n/g, ' | '));
}
await browser.close();
