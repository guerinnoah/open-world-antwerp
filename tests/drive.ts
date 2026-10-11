import { Vehicle, type VehicleSpec } from '../src/actors/vehicle';
import { RAPIER } from '../src/physics/physics';

export function testDrive(spec: VehicleSpec, DT: number, speed = 0, colour = 0xffffff) {
  const world = new RAPIER.World({ x: 0, y: 0 });
  world.timestep = DT;
  const car = new Vehicle(world, spec, colour, 0, 0, 0);
  car.driven = true;
  car.body.setLinvel({ x: speed, y: 0 }, true);
  car.trailer?.body.setLinvel({ x: speed, y: 0 }, true);
  car.awake = true;
  const run = (controls: Partial<Vehicle['controls']>, seconds: number, until?: () => boolean) => {
    car.controls = { steer: 0, throttle: 0, handbrake: false, ...controls };
    let t = 0;
    for (; t < seconds && !until?.(); t += DT) {
      car.step(DT);
      world.step();
      car.sync();
      car.awake = !car.body.isSleeping();
    }
    return t;
  };
  return { car, run };
}
