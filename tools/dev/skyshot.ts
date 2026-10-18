// pnpm tsx tools/dev/skyshot.ts [baseUrl] [query…] — the Cathedral fly view under different times of day and weather.
import { DEV, loaded, open } from './probe.ts';

const [base = DEV, ...queries] = process.argv.slice(2);
const states = queries.length ? queries : ['', 'time=19', 'time=22', 'time=8', 'weather=overcast&time=14', 'weather=rain&time=15'];

const { browser, page } = await open({ logConsole: 'browser' });
for (const q of states) {
  await page.goto(`${base}/?fly&view=Cathedral${q ? `&${q}` : ''}`);
  await loaded(page);
  await page.waitForTimeout(1800);
  const name = q.replace(/[^a-z0-9]+/gi, '-') || 'now';
  await page.screenshot({ path: `screenshots/sky-${name}.png` });
  console.log(`sky-${name}.png`);
}
await browser.close();
