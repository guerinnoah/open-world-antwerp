import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { SkyState } from './daylight';

const SUN_AZIMUTH = THREE.MathUtils.degToRad(250);
const SUN_ELEVATION = THREE.MathUtils.degToRad(30); // default (pre-applySky) mid-afternoon: long shadows, lit streets

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface EnvironmentOptions {
  shadowMapSize: number;
  shadowRange: number;
  fogNear: number;
  drawDistance: number;
}

export class Environment {
  readonly sun: THREE.DirectionalLight;
  night = 0; // 0 by day → 1 at night; the building and lamp shaders read it once, at scene build
  private indoor = false;
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer;
  private sky: Sky;
  private hemi: THREE.HemisphereLight;
  private fog: THREE.Fog;
  private fogFar: number;
  private sunIntensity = 3.2; // current outdoor intensity; applySky sets it, setIndoor dims from it
  private indoorDir = new THREE.Vector3(Math.sin(SUN_AZIMUTH) * 0.42, 0.9, -Math.cos(SUN_AZIMUTH) * 0.42).normalize();
  private sunDir = new THREE.Vector3(
    Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    Math.sin(SUN_ELEVATION),
    -Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  );

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, { shadowMapSize, shadowRange, fogNear, drawDistance }: EnvironmentOptions) {
    this.scene = scene;
    this.renderer = renderer;
    const sky = new Sky();
    sky.scale.setScalar(5000);
    const u = sky.material.uniforms;
    u.turbidity.value = 6;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.85;
    u.sunPosition.value.copy(this.sunDir);
    sky.renderOrder = -1000; // before the ground layers: they don't write depth, so the sky would paint over them
    scene.add(sky);
    this.sky = sky;
    this.fogFar = Math.min(4000, drawDistance * 0.92);
    this.fog = new THREE.Fog(0xc3c9cf, fogNear, this.fogFar);
    scene.fog = this.fog;

    this.sun = new THREE.DirectionalLight(0xffeddb, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    Object.assign(this.sun.shadow.camera, {
      left: -shadowRange, right: shadowRange, top: shadowRange, bottom: -shadowRange, near: 10, far: 2500,
    });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xd9e1ea, 0x736b60, 0.35);
    scene.add(this.hemi);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(gradientSky(), 0.04).texture;
    pmrem.dispose();
  }

  /** Point the sun at a real sky state (time of day + cloud/rain) and recolour the sky, ambient, fog and exposure. */
  applySky({ elevation, azimuth, cloud, rain }: SkyState) {
    this.sunDir
      .set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation))
      .normalize();
    const day = smoothstep(-0.1, 0.12, elevation); // night → day across civil twilight (≈ -6°…+7°)
    const low = 1 - smoothstep(0, 0.5, elevation); // 1 near the horizon, 0 high up
    this.night = 1 - smoothstep(-0.05, 0.15, elevation);

    const sunCol = new THREE.Color(0xffedd6).lerp(new THREE.Color(0xff8a3c), low * 0.85).lerp(new THREE.Color(0xc8ccd2), cloud * 0.5);
    this.sunIntensity = 3.3 * day * (1 - 0.72 * cloud);
    this.sun.color.copy(sunCol);
    this.sun.intensity = (this.indoor ? 0.72 : 1) * this.sunIntensity;

    const skyCol = new THREE.Color(0x2e3c57).lerp(new THREE.Color(0xd9e1ea), day).lerp(new THREE.Color(0xb7bcc4), cloud * 0.6);
    this.hemi.color.copy(skyCol);
    this.hemi.intensity = 0.3 + 0.22 * day; // a moonlit blue floor keeps the city readable at night
    this.scene.environmentIntensity = (0.22 + 0.78 * day) * (1 - 0.25 * cloud);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = 4 + cloud * 16;
    u.rayleigh.value = Math.max(0.2, 0.8 + 2.2 * day - cloud * 0.5);
    u.mieCoefficient.value = 0.004 + cloud * 0.02;

    const fogCol = new THREE.Color(0x0f1420)
      .lerp(new THREE.Color(0xc3c9cf), day)
      .lerp(new THREE.Color(0xa8adb4), cloud * 0.5)
      .lerp(new THREE.Color(0x9298a0), rain * 0.4);
    this.fog.color.copy(fogCol);
    this.fog.far = this.fogFar * (1 - 0.45 * rain - 0.12 * cloud);
    this.renderer.toneMappingExposure = 0.9 * (0.66 + 0.34 * day);
  }

  setIndoor(on: boolean) {
    this.indoor = on;
    this.sun.intensity = (on ? 0.72 : 1) * this.sunIntensity;
  }

  follow(focus: THREE.Vector3) {
    const cam = this.sun.shadow.camera;
    const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
    // Indoors, shadows go off by aiming the shadow map 50 km away: toggling castShadow would recompile every shader.
    const x = Math.round(focus.x / texel) * texel + (this.indoor ? 50000 : 0);
    const z = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(x, 0, z);
    this.sun.position.set(x, 0, z).addScaledVector(this.indoor ? this.indoorDir : this.sunDir, 1200);
  }
}

function gradientSky(): THREE.Scene {
  const geometry = new THREE.SphereGeometry(100, 32, 16);
  const pos = geometry.getAttribute('position');
  const colours = new Float32Array(pos.count * 3);
  const zenith = new THREE.Color(0x9aadc8), horizon = new THREE.Color(0xdcd8d0), ground = new THREE.Color(0x5e5952);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 100;
    if (y >= 0) c.lerpColors(horizon, zenith, Math.pow(y, 0.5));
    else c.lerpColors(horizon, ground, Math.min(1, -y * 4));
    colours.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  return scene;
}
