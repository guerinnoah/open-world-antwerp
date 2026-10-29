declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three';
  import { Pass } from 'three/addons/postprocessing/Pass.js';
  import { Pass as PostprocessingPass } from 'postprocessing';

  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      halfRes: boolean;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }

  // Same AO, built as a pmndrs `postprocessing` Pass so it can share one EffectComposer with bloom/SMAA.
  export class N8AOPostPass extends PostprocessingPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOPass['configuration'] & { transparencyAware: boolean };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setDisplayMode(mode: 'Combined' | 'AO' | 'No AO' | 'Split' | 'Split AO'): void;
    setSize(width: number, height: number): void;
  }
}
