// pnpm tsx tools/dev/cyclists.ts [baseUrl] [seconds] [x,z]: rider counts, speeds and stuck/down tallies, plus shots beside riders.
import { DEV, load, open, type Any } from './probe.ts';

const [base = DEV, seconds = '40', at] = process.argv.slice(2);
const { browser, page } = await open({ logConsole: 'console' });
await load(page, `${base}/?spawn=grotemarkt&stats`);
if (at) {
  const [x, z] = at.split(',').map(Number);
  await page.evaluate(`(() => {
    const g = window.game;
    g.player.place(${x}, ${z}, 0);
    for (const r of [...g.cyclists.riders]) g.cyclists.remove(r);
    g.cyclists.update(0, ${x}, ${z}, true);
  })()`);
}

// A string, not a function: tsx would wrap named helpers in __name(), which the page lacks.
const SAMPLE = `(() => {
  const g = window.game, c = g.cyclists, edges = c.graph.edges;
  const riders = c.riders.map((r) => {
    const t = r.body.translation();
    const e = edges[r.last.edge];
    return { speed: r.speed, down: r.down > 0, stuck: r.stuck > 1 || r.wedged > 2, passing: !!r.passing, path: (e.q ?? 1) >= 2.5, x: t.x, z: t.y };
  });
  const p = g.player;
  return { count: riders.length, riders, near: riders.filter((r) => Math.hypot(r.x - p.x, r.z - p.z) < 60).length };
})()`;

let slow = 0, total = 0;
for (let s = 0; s < Number(seconds); s += 5) {
  await page.waitForTimeout(5000);
  const st = (await page.evaluate(SAMPLE)) as Any;
  const moving = st.riders.filter((r: { speed: number }) => r.speed > 0.5);
  total += st.riders.length;
  slow += st.riders.filter((r: { speed: number }) => r.speed < 0.5).length;
  const avg = moving.reduce((a: number, r: { speed: number }) => a + r.speed, 0) / (moving.length || 1);
  const n = (k: string) => st.riders.filter((r: Record<string, boolean>) => r[k]).length;
  console.log(
    `t=${s + 5}s riders ${st.count} (≤60 m: ${st.near}) moving ${moving.length} avg ${(avg * 3.6).toFixed(1)} km/h · ` +
      `on paths ${n('path')} passing ${n('passing')} stuck ${n('stuck')} down ${n('down')}`,
  );
}
console.log(`stopped ${((100 * slow) / (total || 1)).toFixed(0)}% of rider-samples`);

for (let k = 0; k < 4; k++) {
  await page.evaluate(`(() => {
    const g = window.game, p = g.player;
    const live = g.cyclists.riders.filter((r) => r.down <= 0 && r.speed > 2);
    const pick = live.sort((a, b) => {
      const ta = a.body.translation(), tb = b.body.translation();
      return Math.hypot(ta.x - p.x, ta.y - p.z) - Math.hypot(tb.x - p.x, tb.y - p.z);
    })[${k}];
    if (!pick) return;
    const t = pick.body.translation(), h = pick.heading;
    const x = t.x + Math.cos(h) * 7 - Math.sin(h) * 3, z = t.y + Math.sin(h) * 7 + Math.cos(h) * 3;
    g.player.place(x, z, h + Math.PI);
    g.rig.yaw = Math.atan2(t.y - z, t.x - x);
    g.rig.pitch = 0.12;
  })()`);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `screenshots/cyclist-${k}.png` });
}
await browser.close();
