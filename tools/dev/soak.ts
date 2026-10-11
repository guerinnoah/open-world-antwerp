// pnpm soak [baseUrl] [--mobile]
import { DESKTOP, DEV, PHONE, load, open, type Any } from './probe.ts';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? DEV;
const { browser, page } = await open({ context: args.includes('--mobile') ? PHONE : DESKTOP });
let errors = 0;
page.on('pageerror', () => errors++);
await load(page, `${base}/?stats`);

const spots = [[0, 0], [1491, 372], [-150, -300], [400, 887], [800, -900], [1200, 600], [300, 300], [-100, 700]];
const fps: number[] = [];
for (const [x, z] of spots) {
  await page.evaluate(([x, z]) => {
    const g = (window as Any).game;
    const near = g.peds.graph.nearest(x, z, 200);
    const p = near ? g.peds.graph.edges[near.edge].p : [x, z];
    g.player.place(p[0], p[1], 0);
  }, [x, z]);
  await page.waitForTimeout(4000);
  const line = (await page.locator('#stats').innerText()).split('\n')[0];
  fps.push(parseFloat(line));
  const s = await page.evaluate(() => {
    const g = (window as Any).game;
    return `traffic ${g.traffic.count} peds ${g.peds.peds.length} trams ${g.trams.trams.length} vehicles ${g.vehicles.length} bodies ${g.physics.world.bodies.len()}`;
  });
  console.log(`${String([x, z]).padEnd(10)} ${line} | ${s}`);
}
console.log(`errors: ${errors}, min fps ${Math.min(...fps)}`);
await browser.close();
