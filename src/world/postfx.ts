import { N8AOPostPass } from 'n8ao';
import {
  BloomEffect, EffectComposer, EffectPass, HueSaturationEffect, KernelSize, RenderPass, SMAAEffect, SMAAPreset,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import type { Quality } from '../core/quality';

export interface PostFX {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

// A single pmndrs post chain that replaces the old AO-only composer. The renderer keeps doing ACES tone mapping and the
// day/night exposure (environment.applySky), so the RenderPass output is already tone-mapped; we only add bloom, a light
// grade, a vignette and SMAA on top — no second tone map. Runs on every preset so night lights glow and medium/low get
// real anti-aliasing (they had none on the direct-render path).
export function createPostFX(
  renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: Quality, ao: boolean,
): PostFX {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));

  if (ao) {
    const aoPass = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
    // Matches the old N8AOPass tuning. transparencyAware off: else splash particles and shop glass re-render twice more.
    Object.assign(aoPass.configuration, {
      aoRadius: 3, distanceFalloff: 1, intensity: 3, halfRes: true, gammaCorrection: false, transparencyAware: false,
    });
    aoPass.setQualityMode('Medium');
    composer.addPass(aoPass);
  }

  // Bloom is a convolution effect, so it gets its own pass. Threshold high enough that only lamps, lit windows, sign
  // faces, headlights and the sun disc bloom — not every bright wall. Cheaper, lower-res kernel on phones.
  const phone = quality.level === 'low';
  const bloom = new BloomEffect({
    intensity: phone ? 0.5 : 0.7,
    luminanceThreshold: 0.72,
    luminanceSmoothing: 0.2,
    mipmapBlur: true,
    radius: 0.62,
    kernelSize: phone ? KernelSize.SMALL : KernelSize.MEDIUM,
  });
  composer.addPass(new EffectPass(camera, bloom));

  // Final LDR pass: a touch more colour, a soft vignette, then SMAA last to clean the edges (replaces MSAA on this path).
  const grade = new HueSaturationEffect({ saturation: 0.08 });
  const vignette = new VignetteEffect({ offset: 0.5, darkness: 0.5 });
  const smaa = new SMAAEffect({ preset: phone ? SMAAPreset.LOW : SMAAPreset.HIGH });
  composer.addPass(new EffectPass(camera, grade, vignette, smaa));

  return {
    render: () => composer.render(),
    setSize: (width, height) => composer.setSize(width, height),
    dispose: () => composer.dispose(),
  };
}
