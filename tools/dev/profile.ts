import { DESKTOP, DEV, besideParkedCar, launch, load } from './probe.ts';

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number } };
type Profile = { nodes: Node[]; samples: number[]; timeDeltas: number[] };
const browser = await launch();
const page = await browser.newPage(DESKTOP);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });

function top(profile: Profile, label: string) {
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const f = byId.get(id)!.callFrame;
    const file = f.url.split('/').pop()?.split('?')[0] ?? '';
    const key = `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`\n== ${label}: ${total.toFixed(0)} ms sampled`);
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`${v.toFixed(0).padStart(6)} ms  ${k}`);
}

await cdp.send('Profiler.start');
await load(page, `${DEV}/`, 120_000);
top((await cdp.send('Profiler.stop')).profile as Profile, 'loading');

await page.waitForTimeout(5000);
await besideParkedCar(page, 1560, 262);
await page.waitForTimeout(300);
await page.keyboard.press('KeyE');
await page.keyboard.down('KeyW');
await cdp.send('Profiler.start');
await page.waitForTimeout(5000);
top((await cdp.send('Profiler.stop')).profile as Profile, 'driving 5 s');
await browser.close();
