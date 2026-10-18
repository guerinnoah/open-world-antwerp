// pnpm tsx tools/dev/coldload.ts [baseUrl]: a first visit on a phone (cold cache, throttled 4G, 4× slower CPU) and on an iPhone's WebKit
import { devices, webkit, type Browser, type BrowserContextOptions } from 'playwright';
import { PHONE, launch } from './probe.ts';

const base = process.argv[2] ?? 'https://gta-antwerp.vercel.app';
const url = `${base}/?title&solo`;
const NETWORKS = [
  { name: '4G', down: 9, up: 1.5, latency: 150 }, // Mbit/s, ms
  { name: 'slow 4G', down: 1.6, up: 0.75, latency: 560 },
];
const KINDS: [string, RegExp][] = [['code', /\/assets\/.*\.(js|wasm)/], ['map', /\/map\//], ['textures', /\/textures\//], ['people', /\/people\//]];
const MB = (b: number) => (b / 1e6).toFixed(1);

async function visit(browser: Browser, label: string, context: BrowserContextOptions, network?: (typeof NETWORKS)[number]) {
  const page = await browser.newPage(context);
  // Like a real iPhone: Safari reports 4 cores on anything under 8, and the Mac running this has more.
  if (label.startsWith('iphone')) await page.addInitScript(`Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4 })`);
  const bytes = new Map<string, number>();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfinished', async (r) => {
    const size = (await r.sizes().catch(() => null))?.responseBodySize ?? 0;
    const kind = KINDS.find(([, re]) => re.test(r.url()))?.[0] ?? 'other';
    bytes.set(kind, (bytes.get(kind) ?? 0) + size);
  });
  if (network) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: network.latency, downloadThroughput: (network.down * 1e6) / 8, uploadThroughput: (network.up * 1e6) / 8,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'commit', timeout: 240_000 });
  await page.locator('#title h1').waitFor({ state: 'visible', timeout: 240_000 });
  // The bar's fill each second; * marks the loading screenshot.
  const curve: string[] = [];
  while (!(await page.locator('#title .play').isVisible())) {
    const fill = Number(await page.evaluate(`(() => {
      const bar = document.querySelector('#loading .bar div');
      return bar ? new DOMMatrix(getComputedStyle(bar).transform).a : 0;
    })()`).catch(() => 0));
    if (fill > 0.3 && !curve.some((c) => c.endsWith('*'))) {
      await page.screenshot({ path: `screenshots/cold-${label}-loading.png` });
      curve.push(`${((Date.now() - t0) / 1000).toFixed(0)}s ${Math.round(fill * 100)}%*`);
    } else curve.push(`${((Date.now() - t0) / 1000).toFixed(0)}s ${Math.round(fill * 100)}%`);
    await page.waitForTimeout(1000);
  }
  const playAt = Date.now() - t0;
  const paintAt = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN);
  const total = () => [...bytes.values()].reduce((a, b) => a + b, 0);
  const atPlay = total(), split = [...bytes].map(([k, v]) => `${k} ${MB(v)}`).join(', ');
  await page.screenshot({ path: `screenshots/cold-${label}-title.png` });
  await page.locator('#title .play').click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `screenshots/cold-${label}-street.png` });
  console.log(`${label.padEnd(16)} title painted ${(paintAt / 1000).toFixed(1)} s, Play ${(playAt / 1000).toFixed(1)} s | ${MB(atPlay)} MB before Play (${split}), ${MB(total() - atPlay)} MB after`);
  console.log(`  bar: ${curve.join(', ')}`);
  for (const e of errors) console.log(`  [pageerror] ${e}`);
  await page.close();
}

const chromium = await launch();
for (const network of NETWORKS) await visit(chromium, `android-${network.name.replace(' ', '')}`, PHONE, network);
await chromium.close();

const safari = await webkit.launch();
await visit(safari, 'iphone-webkit', devices['iPhone 15']);
await safari.close();
