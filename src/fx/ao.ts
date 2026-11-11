import { N8AOPass } from 'n8ao';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Lazy: only the high preset uses AO. */
export function createAoComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): EffectComposer {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
  const ao = new N8AOPass(scene, camera, innerWidth, innerHeight);
  // transparencyAware off: else splash and shop glass re-render the scene twice more per frame.
  Object.assign(ao.configuration, {
    aoRadius: 3, distanceFalloff: 1, intensity: 3, halfRes: true, gammaCorrection: false, transparencyAware: false,
  });
  ao.setQualityMode('Medium');
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  return composer;
}
