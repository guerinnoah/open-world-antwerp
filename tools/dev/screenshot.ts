// pnpm shot [baseUrl] [view…] [--landmark id [--dist m]] [--vary 'q1|q2|…']
// --vary: one shot per extra query, e.g. '|time=19|weather=rain' (empty = as is)
import { parseArgs } from 'node:util';
import { DEV, load, open } from './probe.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { landmark: { type: 'string' }, dist: { type: 'string' }, vary: { type: 'string', default: '' } },
});
const base = positionals[0]?.startsWith('http') ? positionals.shift()! : DEV;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const { landmark, dist } = values;
const SIDES = [['front', 'az=0&el=18'], ['right', 'az=90&el=18'], ['back', 'az=180&el=18'], ['left', 'az=270&el=18'], ['street', 'az=25&el=4']];
const shots = landmark
  ? SIDES.map(([side, q]) => [`lm-${landmark}-${side}`, `landmark=${landmark}&${q}${dist ? `&dist=${dist}` : ''}`])
  : (positionals.length ? positionals : ['Grote Markt', 'Cathedral', 'Centraal', 'MAS', 'Overview']).map((v) => [slug(v), `view=${encodeURIComponent(v)}`]);

const { browser, page } = await open({ logConsole: 'browser' });
for (const [name, query] of shots) {
  for (const extra of values.vary.split('|')) {
    await load(page, `${base}/?fly&${query}${extra ? `&${extra}` : ''}`);
    await page.waitForTimeout(1800); // aerial texture and camera settle
    const file = `screenshots/${[name, slug(extra)].filter(Boolean).join('-')}.png`;
    await page.screenshot({ path: file });
    console.log(`${file}  ${await page.locator('#stats').innerText()}`.replace(/\n/g, ' | '));
  }
}
await browser.close();
