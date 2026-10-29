import { inject } from '@vercel/analytics';
import { N8AOPass } from 'n8ao';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';
import { Bikes } from './actors/bikes';
import { Motorbikes } from './actors/motorbikes';
import { Scooters } from './actors/scooters';
import { Crowd } from './actors/crowd';
import { Input } from './core/input';
import { onLoadProgress, track } from './core/loadProgress';
import { pickQuality } from './core/quality';
import { FlyCam } from './debug/flyCam';
import { CENTRAAL_START, GROTE_MARKT_START, Game } from './game/game';
import { Multiplayer, relayUrl } from './net/multiplayer';
import { Physics } from './physics/physics';
import { TitleScreen } from './ui/titleScreen';
import { Breakables } from './world/breakables';
import { createBuildings } from './world/buildings';
import type { CityData, GraphData } from './world/cityData';
import { Environment } from './world/environment';
import { Weather } from './world/weather';
import { initialSky, liveWeather, useLiveWeather } from './world/daylight';
import { createGround } from './world/ground';
import { createLandmarks } from './world/landmarks';
import { createFacadeDetail } from './world/facadeDetail';
import { createMarkings } from './world/markings';
import { createProps } from './world/props';
import { Interiors } from './world/interiors';
import { Signs } from './world/signs';
import { loadTextures } from './world/textures';
import { clearTramTracks } from './world/trackClearance';
import { createTrees } from './world/trees';

if (import.meta.env.PROD && !navigator.webdriver) inject(); // not for our Playwright probes
const params = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const loading = document.querySelector<HTMLDivElement>('#loading')!;
const stats = document.querySelector<HTMLDivElement>('#stats')!;
const showStats = params.has('stats') || params.has('fly');
const title = new TitleScreen(params.has('play') || params.has('fly') || (navigator.webdriver && !params.has('title')));

const quality = pickQuality(params);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias });
const maxPixelRatio = Math.min(devicePixelRatio, quality.pixelRatio);
let pixelRatio = maxPixelRatio;
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Scenery frees its CPU copy once uploaded (freeAfterUpload), so a lost WebGL context (a backgrounded phone tab, low GPU
// memory) can't be restored: stop and offer a reload. Not an automatic one, which could loop if the GPU keeps losing it.
canvas.addEventListener('webglcontextlost', () => {
  renderer.setAnimationLoop(null);
  const note = document.createElement('div');
  note.textContent = 'The graphics were reset. Tap to reload.';
  Object.assign(note.style, {
    position: 'fixed', inset: '0', zIndex: '20', display: 'grid', placeItems: 'center', visibility: 'visible',
    background: 'rgb(15 17 22 / 0.85)', font: '600 18px system-ui, sans-serif', cursor: 'pointer',
  });
  note.addEventListener('click', () => location.reload());
  document.body.append(note);
}, { once: true });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, quality.drawDistance);
const environment = new Environment(scene, renderer, quality);
const weather = new Weather();
scene.add(weather.group);
// Sun from Antwerp's real clock (or ?time=); weather from the URL, else fetched live and applied when it arrives.
const sky = initialSky(params);
environment.applySky(sky);
weather.setIntensity(sky.rain);
if (useLiveWeather(params)) {
  void liveWeather().then((w) => {
    if (!w) return;
    environment.applySky({ ...sky, cloud: Math.max(w.cloud, w.rain * 0.9), rain: w.rain });
    weather.setIntensity(w.rain);
  });
}

let composer: EffectComposer | null = null;
// AO through a multisampled target so edges stay smooth (desktop only; /?noao turns it off).
if (quality.ao && !params.has('noao')) {
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
  const ao = new N8AOPass(scene, camera, innerWidth, innerHeight);
  // transparencyAware off: else splash particles and shop glass make N8AO re-render the scene twice more per frame.
  Object.assign(ao.configuration, {
    aoRadius: 3, distanceFalloff: 1, intensity: 3, halfRes: true, gammaCorrection: false, transparencyAware: false,
  });
  ao.setQualityMode('Medium');
  composer.addPass(ao);
  composer.addPass(new OutputPass());
}
const draw = () => (composer ? composer.render() : renderer.render(scene, camera));

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  // Else the composer keeps its first pixel ratio and adaptive resolution wouldn't shrink the AO buffers.
  composer?.setPixelRatio(renderer.getPixelRatio());
  composer?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 78 : 60;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Downloads fill the first 80% of the bar, building the city the rest.
onLoadProgress((f) => title.progress(f * 0.8));
const t0 = performance.now();
const [city, graph, textures, crowd, aerial] = await Promise.all([
  track(fetch('/map/city.json').then((r) => r.json() as Promise<CityData>), 14),
  track(fetch('/map/graph.json').then((r) => r.json() as Promise<GraphData>), 4),
  loadTextures(renderer, quality.textureSize, quality.anisotropy),
  Crowd.load(quality.peds + 24, quality.level === 'high' ? Infinity : 4),
  // Aerial ground on desktop (?flat skips it); .catch → null falls back to the stylised ground if the photo's missing.
  !quality.aerial || params.has('flat') ? Promise.resolve(null) : track(new THREE.TextureLoader().loadAsync('/map/ortho.webp').catch(() => null), 9),
]);
if (aerial) {
  aerial.colorSpace = THREE.NoColorSpace; // sampled raw in the ground blend shader and linearised there
  aerial.anisotropy = quality.anisotropy; // the ground is seen at a grazing angle
  aerial.wrapS = aerial.wrapT = THREE.ClampToEdgeWrapping;
}
const t1 = performance.now();
clearTramTracks(city, graph.trams);
const ground = createGround(city, textures, aerial);
const props = createProps(city, quality.detailView, environment.night);
const facadeDetail = createFacadeDetail(city.buildings, quality.detailView);
const signs = new Signs(city, renderer, 200 * quality.detailView);
const bikes = new Bikes(city, crowd, 130 * quality.detailView);
scene.add(bikes.group);
title.progress(0.85);
const landmarks = await createLandmarks(city.landmarks, textures);
const scenery = [
  createMarkings(graph.drive, city.crossings ?? []), ground.group, props.group, facadeDetail.group, signs.group, createBuildings(city.buildings, textures, environment.night),
  createTrees(city.trees), landmarks,
];
scene.add(...scenery);
// The scenery never moves: compose its matrices once instead of thousands every frame.
for (const root of scenery) {
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
  root.updateMatrixWorld(true);
}

const updateScenery = (dt: number, time: number) => {
  ground.update(time / 1000);
  props.update(camera.position);
  facadeDetail.update(camera.position);
  signs.update(camera.position, dt);
  weather.update(camera.position, dt);
};
let update: (dt: number, time: number) => void;
const timing = { sim: 0, render: 0 };
if (params.has('fly')) {
  const fly = new FlyCam(camera, canvas, city.landmarks);
  const scooters = new Scooters(graph.walk, crowd, 130 * quality.detailView);
  scene.add(scooters.group);
  update = (dt, time) => {
    fly.update(dt);
    bikes.update(camera.position, [], null, 0, 1, dt);
    scooters.update(camera.position, [], null, 0, 1, dt);
    updateScenery(dt, time);
    environment.follow(fly.target);
    draw();
  };
} else {
  title.progress(0.9);
  const physics = await Physics.create(city);
  physics.world.timestep = 1 / quality.physicsHz;
  const breakables = new Breakables(physics, props); // before the game parks cars, so none park on a post
  scene.add(breakables.group);
  // Rapier queries only see colliders after a step: step the empty world so spawns can check for walls and posts.
  physics.step();
  const scooters = new Scooters(graph.walk, crowd, 130 * quality.detailView, physics);
  const motorbikes = new Motorbikes(crowd, quality.vehicleView);
  const interiors = new Interiors(signs.doors, city.buildings, physics, environment, crowd);
  scene.add(scooters.group, motorbikes.group, interiors.group);
  breakables.extras = (b) => (b.parts[0]?.kind === 'veloDock' ? bikes.clearDocks(b.x, b.z, 0.6) : []);
  const start = params.get('spawn') === 'grotemarkt' ? GROTE_MARKT_START : CENTRAAL_START;
  const input = new Input(canvas);
  const game = new Game(scene, camera, physics, input, city, graph, quality, crowd, interiors, breakables, bikes, scooters, motorbikes, start);
  (window as unknown as { game: Game }).game = game;
  if (params.has('fpv')) game.setFirstPerson(true);
  const relay = relayUrl(params);
  if (relay) game.attachMultiplayer(new Multiplayer(relay, params, game, physics, crowd, camera));
  const STEP = 1 / quality.physicsHz;
  let acc = 0;
  let playing = false;
  update = (dt, time) => {
    updateScenery(dt, time);
    if (playing) game.sampleInput();
    else {
      input.sample(); // drops the press that dismissed the title card
      playing = title.started;
    }
    const s0 = performance.now();
    // Fixed-rate physics; rendering interpolates between the last two steps (acc / STEP).
    acc = game.paused ? 0 : Math.min(acc + dt, 0.25);
    while (acc >= STEP) {
      game.fixedUpdate(STEP);
      acc -= STEP;
    }
    game.render(acc / STEP, playing || !start.intro ? dt : 0);
    const s1 = performance.now();
    environment.follow(game.focus);
    if (!game.mapOpen) draw();
    timing.sim += s1 - s0;
    timing.render += performance.now() - s1;
  };
}
// Compile every shader behind the loading screen, else the first second of play stutters.
title.progress(0.95);
if (!params.has('fly')) await renderer.compileAsync(scene, camera);
// Draw all scenery once unculled so every chunk uploads now and can free its CPU copy (see freeAfterUpload).
{
  const unculled: THREE.Object3D[] = [];
  for (const root of scenery) {
    root.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        unculled.push(o);
      }
    });
  }
  const target = new THREE.WebGLRenderTarget(4, 4);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  target.dispose();
  for (const o of unculled) o.frustumCulled = true;
}
const t2 = performance.now();
loading.remove();
title.ready();
console.info(`city: fetch ${(t1 - t0).toFixed(0)} ms, build ${(t2 - t1).toFixed(0)} ms, ${city.buildings.length} buildings`);

const timer = new THREE.Timer();
timer.connect(document);
let frames = 0, fpsTime = 0;
renderer.info.autoReset = false;
// Adaptive resolution: down to 60% of the preset when fps sags, back up with headroom; checked once a second.
const minPixelRatio = maxPixelRatio * 0.6;
let adaptFrames = 0, adaptTime = 0, slowSeconds = 0, fastSeconds = 0;
// Phones target 30 fps, where Low Power Mode caps them.
const [slowFps, fastFps, upAfter] = quality.level === 'high' ? [45, 57, 4] : [25, 29, 8];
function adaptResolution(dt: number) {
  adaptFrames++;
  adaptTime += dt;
  if (adaptTime < 1) return;
  const fps = adaptFrames / adaptTime;
  adaptFrames = adaptTime = 0;
  slowSeconds = fps < slowFps ? slowSeconds + 1 : 0;
  fastSeconds = fps > fastFps ? fastSeconds + 1 : 0;
  let next = pixelRatio;
  if (slowSeconds >= 2) next = Math.max(minPixelRatio, pixelRatio - 0.15);
  else if (fastSeconds >= upAfter) next = Math.min(maxPixelRatio, pixelRatio + 0.1);
  if (next !== pixelRatio) {
    pixelRatio = next;
    slowSeconds = fastSeconds = 0;
    renderer.setPixelRatio(pixelRatio);
    resize();
  }
}

renderer.setAnimationLoop((time) => {
  renderer.info.reset();
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);
  update(dt, time);
  adaptResolution(dt);

  if (!showStats) return;
  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    const info = renderer.info.render;
    stats.textContent = `${(frames / fpsTime).toFixed(0)} fps · ${info.calls} draws · ${(info.triangles / 1e6).toFixed(2)}M tris\n` +
      `sim ${(timing.sim / frames).toFixed(1)} ms · render ${(timing.render / frames).toFixed(1)} ms · ` +
      `${quality.level} @${pixelRatio.toFixed(2)}x · ` +
      `load ${(t1 - t0).toFixed(0)} ms + build ${(t2 - t1).toFixed(0)} ms`;
    frames = 0;
    fpsTime = 0;
    timing.sim = timing.render = 0;
  }
});
