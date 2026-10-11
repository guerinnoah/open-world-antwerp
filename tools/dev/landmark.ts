// pnpm landmark <id> [dist] [baseUrl]
import { DEV, load, open } from './probe.ts';

const [id, distArg, base = DEV] = process.argv.slice(2);
if (!id) throw new Error('usage: pnpm landmark <id> [dist]');
const { browser, page } = await open({ logConsole: 'console' });
const dist = distArg ? `&dist=${distArg}` : '';
const views = [
  ['front', 'az=0&el=18'], ['right', 'az=90&el=18'], ['back', 'az=180&el=18'], ['left', 'az=270&el=18'], ['street', 'az=25&el=4'],
];
for (const [name, q] of views) {
  await load(page, `${base}/?fly&landmark=${id}&${q}${dist}`);
  await page.waitForTimeout(700);
  const file = `screenshots/lm-${id}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(file);
}
await browser.close();
