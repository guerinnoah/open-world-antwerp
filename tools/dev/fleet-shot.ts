// pnpm tsx tools/dev/fleet-shot.ts [baseUrl]: one of each liveried vehicle in a row on the Grote Markt, sirens on.
import { DEV, loaded, open } from './probe.ts';

const [base = DEV] = process.argv.slice(2);
const { browser, page } = await open({ logConsole: 'fleet' });
await page.goto(`${base}/?noao&spawn=grotemarkt`);
await page.addStyleTag({ content: '#hud .toast { display: none }' });
await loaded(page);
await page.waitForTimeout(1500);

const NAMES = ['police', 'policevan', 'taxi', 'ambulance', 'truck', 'firetruck'];
for (const [i, name] of NAMES.entries()) {
  for (const [view, along, side] of [['front', 1, -0.8], ['rear', -1, 0.7]] as const) {
    const info = await page.evaluate(`(async () => {
      const g = window.game;
      const { VEHICLE_TYPES, Vehicle, paintFor } = await import('/src/actors/vehicle.ts');
      for (const v of g.vehicles.filter((v) => v.fleetShot)) g.removeVehicle(v);
      const spec = VEHICLE_TYPES.find(([s]) => s.name === '${name}')[0];
      // Free ground near the start, with room for the camera too.
      let x = 0, z = 0;
      search: for (let r = 0; r < 60; r += 2) for (let k = 0; k < 16; k++) {
        x = 12 + Math.cos(k / 16 * Math.PI * 2) * r; z = 2 + Math.sin(k / 16 * Math.PI * 2) * r;
        if (!g.physics.boxOverlaps(x, z, 0, spec.length / 2 + 9, spec.width / 2 + 7)) break search;
      }
      const v = new Vehicle(g.physics.world, spec, paintFor(spec), x, z, 0);
      v.fleetShot = true;
      v.siren = spec.siren !== undefined;
      v.body.sleep();
      g.addVehicle(v);
      const d = spec.length * 0.75 + 4;
      const px = x + ${along} * d, pz = z + ${side} * d;
      const yaw = Math.atan2(z - pz, x - px);
      g.player.place(px, pz, yaw);
      g.player.hide();
      g.rig.yaw = yaw;
      g.rig.pitch = 0.18;
      return spec.name + ' at ' + x.toFixed(0) + ',' + z.toFixed(0);
    })()`);
    await page.waitForTimeout(1000);
    const file = `screenshots/fleet-${i}-${name}-${view}.png`;
    await page.screenshot({ path: file });
    console.log(file, info);
  }
}
await browser.close();
