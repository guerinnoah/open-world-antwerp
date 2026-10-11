import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { Landmark } from '../world/cityData';
import { project } from '../world/projection';

const VIEWS: [string, number, number, [number, number, number]][] = [
  ['Grote Markt', 51.2213, 4.3997, [-160, 140, -180]],
  ['Cathedral', 51.2203, 4.4015, [-260, 90, 160]],
  ['Centraal', 51.2172, 4.4211, [-220, 120, -120]],
  ['Meir', 51.2178, 4.4103, [-120, 60, 180]],
  ['Het Steen', 51.2227, 4.3974, [-200, 80, 60]],
  ['MAS', 51.2289, 4.4048, [220, 120, 160]],
  ['Het Zuid', 51.2083, 4.3946, [-180, 140, -200]],
  ['Overview', 51.2203, 4.4015, [-1200, 1500, 1400]],
];

export class FlyCam {
  private controls: MapControls;
  private flight: { from: [THREE.Vector3, THREE.Vector3]; to: [THREE.Vector3, THREE.Vector3]; t: number } | null = null;

  constructor(private camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement, landmarks: Landmark[]) {
    this.controls = new MapControls(camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
    this.controls.minDistance = 5;
    this.controls.maxDistance = 2500;

    const nav = document.createElement('nav');
    nav.id = 'views';
    for (const [name, lat, lon, offset] of VIEWS) {
      const button = document.createElement('button');
      button.textContent = name;
      button.onclick = () => this.flyTo(lat, lon, offset);
      nav.append(button);
    }
    document.body.append(nav);

    const params = new URLSearchParams(location.search);
    const lm = landmarks.find((l) => l.id === params.get('landmark'));
    if (lm) {
      const az = THREE.MathUtils.degToRad(Number(params.get('az') ?? 30)) + lm.angle;
      const el = THREE.MathUtils.degToRad(Number(params.get('el') ?? 20));
      const dist = Number(params.get('dist') ?? Math.max(lm.length, lm.height) * 1.6 + 10);
      this.controls.target.set(lm.x, Math.min(lm.height * 0.35, 30), lm.z);
      this.camera.position.set(
        lm.x + Math.cos(az) * Math.cos(el) * dist,
        this.controls.target.y + Math.sin(el) * dist,
        lm.z + Math.sin(az) * Math.cos(el) * dist,
      );
      return;
    }
    const initial = VIEWS.find(([name]) => name === params.get('view')) ?? VIEWS[0];
    this.flyTo(initial[1], initial[2], initial[3], true);
  }

  get target() {
    return this.controls.target;
  }

  private flyTo(lat: number, lon: number, offset: [number, number, number], instant = false) {
    const [x, z] = project(lat, lon);
    const target = new THREE.Vector3(x, 0, z);
    const position = target.clone().add(new THREE.Vector3(...offset));
    if (instant) {
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      return;
    }
    this.flight = { from: [this.camera.position.clone(), this.controls.target.clone()], to: [position, target], t: 0 };
  }

  update(dt: number) {
    const f = this.flight;
    if (f) {
      f.t = Math.min(f.t + dt / 1.4, 1);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(f.from[0], f.to[0], e);
      this.controls.target.lerpVectors(f.from[1], f.to[1], e);
      if (f.t === 1) this.flight = null;
    }
    this.controls.update();
  }
}
