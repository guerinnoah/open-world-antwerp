// pnpm orthoshot [baseUrl] [view…] — the default aerial-blended ground vs the stylised ?flat ground, same fly views.
import { DEV, loaded, open } from './probe.ts';

const [base = DEV, ...views] = process.argv.slice(2);
const names = views.length ? views : ['Grote Markt', 'Cathedral', 'MAS'];

const { browser, page } = await open({ logConsole: 'browser' });
for (const name of names) {
  for (const flat of [false, true]) {
    await page.goto(`${base}/?fly&view=${encodeURIComponent(name)}${flat ? '&flat' : ''}`);
    await loaded(page);
    await page.waitForTimeout(1800); // let the aerial texture finish loading and the camera settle
    const file = `screenshots/ortho-${name.toLowerCase().replace(/\s+/g, '-')}-${flat ? 'flat' : 'aerial'}.png`;
    await page.screenshot({ path: file });
    console.log(file);
  }
}
await browser.close();
