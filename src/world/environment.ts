import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const SUN_AZIMUTH = THREE.MathUtils.degToRad(250);
const SUN_ELEVATION = THREE.MathUtils.degToRad(14);

export interface EnvironmentOptions {
  shadowMapSize: number;
  shadowRange: number;
  fogNear: number;
  drawDistance: number;
}

export class Environment {
  readonly sun: THREE.DirectionalLight;
  private indoor = false;
  private indoorDir = new THREE.Vector3(Math.sin(SUN_AZIMUTH) * 0.42, 0.9, -Math.cos(SUN_AZIMUTH) * 0.42).normalize();
  private sunDir = new THREE.Vector3(
    Math.sin(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
    Math.sin(SUN_ELEVATION),
    -Math.cos(SUN_AZIMUTH) * Math.cos(SUN_ELEVATION),
  );

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, { shadowMapSize, shadowRange, fogNear, drawDistance }: EnvironmentOptions) {
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
    scene.fog = new THREE.Fog(0xc9b59c, fogNear, Math.min(4000, drawDistance * 0.92));

    this.sun = new THREE.DirectionalLight(0xffd2a1, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
    Object.assign(this.sun.shadow.camera, {
      left: -shadowRange, right: shadowRange, top: shadowRange, bottom: -shadowRange, near: 10, far: 2500,
    });
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    scene.add(new THREE.HemisphereLight(0xc6d6f0, 0x7a6a58, 0.35));

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(gradientSky(), 0.04).texture;
    pmrem.dispose();
  }

  setIndoor(on: boolean) {
    this.indoor = on;
    this.sun.intensity = on ? 2.3 : 3.2;
    this.sun.color.set(on ? 0xfff2e2 : 0xffd2a1);
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
  const zenith = new THREE.Color(0x4f7fc0), horizon = new THREE.Color(0xe9c9a0), ground = new THREE.Color(0x5e574e);
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
