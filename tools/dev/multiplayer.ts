// pnpm mp [baseUrl]
import type { Page } from 'playwright';
import { DESKTOP, DEV, hold, launch, load, stand } from './probe.ts';

const base = process.argv[2] ?? DEV;
const browser = await launch();

type V = { x: number; z: number; angle: number; forwardSpeed: number; teleport(x: number, z: number, angle: number): void; remote: boolean; driven: boolean; spec: { name: string }; colour: number };
type PeerView = { ready: boolean; name: string; car: V | null; state: { x: number; z: number; mode: number } };
type G = {
  game: {
    player: { x: number; z: number; down: number; place(x: number, z: number, h: number): void };
    driving: V | null;
    vehicles: V[];
    traffic: { has(v: V): boolean };
    physics: { castStatic(x: number, z: number, dx: number, dz: number, max: number): number; boxOverlaps(x: number, z: number, angle: number, halfLength: number, halfWidth: number): boolean };
    multiplayer: { peers: Map<number, PeerView> };
  };
};

let failures = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures++;
};

async function join(name: string) {
  const page = await (await browser.newContext(DESKTOP)).newPage();
  page.on('console', (m) => m.type() === 'error' && console.log(`[${name}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[${name} pageerror] ${e.message}`));
  await load(page, `${base}/?mp&name=${name}&spawn=grotemarkt`, 90_000);
  return page;
}

const self = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as G).game;
    const t = g.driving ?? g.player;
    return { x: t.x, z: t.z, driving: !!g.driving, down: g.player.down };
  });
const other = (page: Page) =>
  page.evaluate(() => {
    // By name: anyone else on the dev server is in the same world.
    const p = [...(window as unknown as G).game.multiplayer.peers.values()].find((q) => q.name === 'Anna' || q.name === 'Bram');
    if (!p?.ready) return null;
    const car = p.car && { x: p.car.x, z: p.car.z, remote: p.car.remote };
    return { name: p.name, x: car ? car.x : p.state.x, z: car ? car.z : p.state.z, mode: p.state.mode, car };
  });
const until = async (what: string, test: () => Promise<boolean>, ms = 5000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await test()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  check(false, `timed out: ${what}`);
  return false;
};
const watch = (b: Page, at: { x: number; z: number }, angle: number, ahead: number) =>
  stand(b, at.x + Math.cos(angle) * ahead, at.z + Math.sin(angle) * ahead, angle + Math.PI);

const a = await join('Anna');
const b = await join('Bram');
await until('both online and seeing each other', async () => !!(await other(a)) && !!(await other(b)), 10_000);
check((await other(b))?.name === 'Anna', 'Bram sees Anna by name');

const before = await self(a);
await a.keyboard.press('KeyT');
await a.keyboard.type('Hallo Bram, www!');
await a.waitForTimeout(400);
const typed = await self(a);
check(Math.hypot(typed.x - before.x, typed.z - before.z) < 0.05, 'typing in the chat box does not move Anna');
await a.keyboard.press('Enter');
const heard = () => b.evaluate(() => [...document.querySelectorAll('#chat .line')].map((l) => l.textContent));
await until('Bram gets the message', async () => (await heard()).includes('Anna Hallo Bram, www!'));
const bubble = await b.evaluate(() => [...document.querySelectorAll<HTMLElement>('#nametags .say')].find((e) => !e.hidden)?.textContent);
check(bubble === 'Hallo Bram, www!', `the message shows over Anna's head (${bubble})`);
check((await a.evaluate(() => [...document.querySelectorAll('#chat .line.self')].map((l) => l.textContent))).includes('Anna Hallo Bram, www!'), 'Anna sees her own message');
check(!(await a.evaluate(() => (window as unknown as G).game.driving)), 'Enter sent the message instead of stealing a car');
await watch(b, typed, 0, 6);
await b.waitForTimeout(500);
await b.screenshot({ path: 'screenshots/mp-0-chat.png' });

await hold(a, ['KeyW'], 1500);
await a.waitForTimeout(400);
let [sa, ob] = [await self(a), await other(b)];
check(!!ob && Math.hypot(sa.x - ob.x, sa.z - ob.z) < 1, `walking: Bram sees Anna within 1 m (${ob && Math.hypot(sa.x - ob.x, sa.z - ob.z).toFixed(2)} m)`);

const parked = await a.evaluate(() => {
  const g = (window as unknown as G).game;
  const p = g.player;
  const kinds = ['city', 'hatch', 'estate', 'sedan', 'suv', 'van'];
  const cars = g.vehicles.filter((v) => !g.traffic.has(v) && !v.remote && kinds.includes(v.spec.name));
  const v = cars.reduce((m, c) => (Math.hypot(c.x - p.x, c.z - p.z) < Math.hypot(m.x - p.x, m.z - p.z) ? c : m));
  p.place(v.x - Math.sin(v.angle) * 2, v.z + Math.cos(v.angle) * 2, v.angle);
  return { x: v.x, z: v.z, angle: v.angle, colour: v.colour, kind: v.spec.name };
});
const copiesAtB = () =>
  b.evaluate((c) => (window as unknown as G).game.vehicles.filter((v) => !v.remote && v.colour === c.colour && v.spec.name === c.kind && Math.hypot(v.x - c.x, v.z - c.z) < 2).length, parked);
check((await copiesAtB()) === 1, 'Bram has the same parked car in his city');
await watch(b, parked, parked.angle, 14);
await a.waitForTimeout(300);
await a.keyboard.press('KeyE');
await until('Anna drives', async () => (await self(a)).driving);
await until('Bram sees Anna in a car', async () => !!(await other(b))?.car?.remote);
check((await copiesAtB()) === 0, "Bram's copy of the parked car is gone");
await b.waitForTimeout(500);
await b.screenshot({ path: 'screenshots/mp-1-anna-in-car.png' });

await hold(a, ['KeyW'], 2000);
const speed = await a.evaluate(() => (window as unknown as G).game.driving!.forwardSpeed);
[sa, ob] = [await self(a), await other(b)];
const lagM = ob ? Math.hypot(sa.x - ob.x, sa.z - ob.z) : Infinity;
check(lagM < Math.max(2, speed * 0.35), `driving at ${(speed * 3.6).toFixed(0)} km/h: Bram's view trails by ${lagM.toFixed(1)} m`);
await a.keyboard.down('Space');
await until('Anna stopped', async () => Math.abs(await a.evaluate(() => (window as unknown as G).game.driving!.forwardSpeed)) < 0.05);
await a.keyboard.up('Space');
await a.waitForTimeout(500);
[sa, ob] = [await self(a), await other(b)];
check(!!ob && Math.hypot(sa.x - ob.x, sa.z - ob.z) < 0.2, `stopped: the views agree (${ob && Math.hypot(sa.x - ob.x, sa.z - ob.z).toFixed(2)} m apart)`);

const pose = await a.evaluate(() => {
  const g = (window as unknown as G).game;
  const v = g.driving!;
  let angle: number | null = null;
  for (let attempt = 0; attempt < 2 && angle === null; attempt++) {
    if (attempt === 1) v.teleport(1491, 372, v.angle);
    for (let i = 0; i < 24 && angle === null; i++) {
      const a = v.angle + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12);
      const c = Math.cos(a), s = Math.sin(a);
      if (g.physics.castStatic(v.x, v.z, c, s, 18) < 18) continue;
      if ([6, 10, 14].some((d) => g.physics.boxOverlaps(v.x + c * d, v.z + s * d, a, 2.4, 1.1))) continue;
      angle = a;
    }
  }
  if (angle === null) return null;
  v.teleport(v.x, v.z, angle);
  return { x: v.x, z: v.z, angle };
});
check(!!pose, 'found a clear run for the knock-over test');
if (pose) {
  await watch(b, pose, pose.angle, 9);
  await a.waitForTimeout(500);
  let knocked = false;
  await a.keyboard.down('KeyW');
  const t0 = Date.now();
  while (Date.now() - t0 < 3000 && !knocked) {
    knocked = (await self(b)).down > 0;
    await a.waitForTimeout(50);
  }
  await a.keyboard.up('KeyW');
  check(knocked, `Anna's car knocks Bram over (car ${JSON.stringify(await self(a))} → Bram ${JSON.stringify(await self(b))})`);
  await b.waitForTimeout(300);
  await b.screenshot({ path: 'screenshots/mp-2-knocked.png' });
}

await a.keyboard.down('Space');
await until('Anna stopped again', async () => Math.abs(await a.evaluate(() => (window as unknown as G).game.driving!.forwardSpeed)) < 0.5);
await a.keyboard.up('Space');
const leftAt = await a.evaluate(() => {
  const v = (window as unknown as G).game.driving!;
  return { x: v.x, z: v.z };
});
await a.keyboard.press('KeyE');
await until('Anna on foot', async () => !(await self(a)).driving);
await until('Bram sees Anna on foot', async () => (await other(b))?.mode === 0);
const after = await self(a);
await b.waitForTimeout(1500);
const left = await b.evaluate(
  ([c, at]) => (window as unknown as G).game.vehicles.filter((v) => v.colour === c.colour && v.spec.name === c.kind && Math.hypot(v.x - at.x, v.z - at.z) < 3).length,
  [parked, leftAt] as const,
);
check(left === 0, "the car she left is gone from Bram's city");
await watch(b, after, 0, 8);
await b.waitForTimeout(600);
await b.screenshot({ path: 'screenshots/mp-3-on-foot.png' });

await a.context().close();
await until('Anna gone', async () => !(await b.evaluate(() => [...(window as unknown as G).game.multiplayer.peers.values()].some((p) => p.name === 'Anna'))));

await browser.close();
console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
process.exit(failures ? 1 : 0);
