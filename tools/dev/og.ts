// pnpm og [baseUrl]
import sharp from 'sharp';
import { DEV, load, open } from './probe.ts';

const [base = DEV] = process.argv.slice(2);
const { browser, page } = await open({ context: { viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 } });
await load(page, `${base}/?title&nologos&solo&quality=high&time=16&weather=clear`, 90_000);
await page.addStyleTag({
  content: `#title .tagline, #title .controls, #title .more, #title .play, #credits { display: none !important; }
    #title { padding: 0 0 56px 64px; } #title h1 { font-size: 84px; }`,
});
await page.waitForTimeout(3000);
await sharp(await page.screenshot()).resize(1200, 630).jpeg({ quality: 82, mozjpeg: true }).toFile('public/og.jpg');
console.log('public/og.jpg');
await browser.close();
