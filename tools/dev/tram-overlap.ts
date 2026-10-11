// pnpm tsx tools/dev/tram-overlap.ts [seconds] [spawn]
import { loaded, open, type Any } from './probe.ts';

const seconds = Number(process.argv[2] ?? 60);
const { browser, page } = await open({ context: { viewport: { width: 960, height: 540 } } });
await page.routeWebSocket(/.*/, () => {});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/?spawn=${process.argv[3] ?? 'grotemarkt'}&noao`, { timeout: 300_000 });
await loaded(page, 300_000);
await page.evaluate((seconds) => {
  const g = (window as Any).game;
  const physics = g.physics, world = physics.world;
  const tally: Record<string, number> = {};
  const examples: string[] = [];
  const seen = new Set<string>();
  (window as Any).overlaps = { tally, examples };
  const box = physics.box;
  const id = setInterval(() => {
    for (const t of [...g.trams.trams, ...g.buses.buses]) {
      const what = g.trams.trams.includes(t) ? 'tram' : 'bus';
      const own = new Set(t.sections.map((b: Any) => b.handle));
      t.sections.forEach((body: Any, i: number) => {
        const p = body.translation(), a = body.rotation();
        const half = body.collider(0).halfExtents();
        box.halfExtents = { x: half.x - 0.35, y: half.y - 0.35 };
        world.intersectionsWithShape({ x: p.x, y: p.y }, a, box, (c: Any) => {
          const parent = c.parent();
          if (parent && own.has(parent.handle)) return true;
          const owner = physics.owners.get(c.handle);
          const shape = c.shapeType() === 0 ? (c.radius() > 0.2 ? 'tree' : 'post') : c.shapeType() === 1 ? 'bench/terrace' : c.shapeType() === 4 ? 'wall' : `shape ${c.shapeType()}`;
          const kind = owner?.kind ?? (c.isSensor() ? 'sensor' : shape);
          const key = `${t.controls ? 'driven ' : ''}${what} → ${kind}`;
          const id = `${key}:${t.sections[0].handle}:${parent?.handle ?? c.handle}`;
          if (seen.has(id)) return true;
          seen.add(id);
          tally[key] = (tally[key] ?? 0) + 1;
          let detail = '';
          if (owner?.kind === 'vehicle') {
            const v = owner.entity, c = Math.cos(a), sn = Math.sin(a);
            const dx = v.x - p.x, dz = v.z - p.y;
            const buses = g.buses.buses.flatMap((b: Any) => b.sections.map((s: Any) => s.translation()));
            const bus = Math.min(Infinity, ...buses.map((q: Any) => Math.hypot(q.x - v.x, q.y - v.z)));
            detail = ` [${g.traffic.has(v) ? 'traffic' : v.driven ? 'driven' : 'parked'} ${v.spec.name}, section ${i}, along ${(dx * c + dz * sn).toFixed(1)} across ${(-dx * sn + dz * c).toFixed(1)}, nearest bus ${bus.toFixed(1)} m]`;
          }
          if (examples.filter((e) => e.startsWith(key)).length < 4) examples.push(`${key} at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}) line ${t.run.line ?? t.run.ref ?? ''} speed ${t.speed.toFixed(1)} blocked ${t.blocked.toFixed(1)}${detail}`);
          return true;
        });
      });
    }
  }, 100);
  setTimeout(() => clearInterval(id), seconds * 1000);
}, seconds);
await page.waitForTimeout(seconds * 1000 + 500);
const result = await page.evaluate(() => (window as Any).overlaps);
console.log(JSON.stringify(result.tally, null, 1));
for (const e of result.examples) console.log(' ', e);
await browser.close();
