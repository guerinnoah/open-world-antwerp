import * as THREE from 'three';
import type { Landmark } from '../cityData';
import type { Textures } from '../textures';
import { freeAfterUpload } from '../../core/instancing';
import { footprintModel } from './footprint';

const modules = import.meta.glob<Record<string, (lm: Landmark) => THREE.BufferGeometry>>('./*.ts');

export async function createLandmarks(landmarks: Landmark[], textures: Textures): Promise<THREE.Group> {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const material = stoneMaterial(textures);
  const geometries = await Promise.all(
    landmarks.map(async (lm) => {
      try {
        const mod = await modules[`./${lm.id}.ts`]();
        return mod[lm.id](lm);
      } catch (e) {
        console.error(`landmark ${lm.id} failed, using plain blocks:`, e);
        return footprintModel(lm).build();
      }
    }),
  );
  landmarks.forEach((lm, i) => {
    freeAfterUpload(geometries[i]);
    const mesh = new THREE.Mesh(geometries[i], material);
    mesh.name = lm.id;
    mesh.position.set(lm.x, 0, lm.z);
    mesh.rotation.y = -lm.angle;
    mesh.castShadow = mesh.receiveShadow = true;
    geometries[i].userData.dress?.(mesh);
    group.add(mesh);
  });
  return group;
}

function stoneMaterial(textures: Textures): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tStone = { value: textures.stone.map };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tStone;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Luminance only, so the model's colours stay.
          vec3 w = pow(abs(vWorldNormal), vec3(4.0));
          w /= w.x + w.y + w.z;
          vec3 stone = texture2D(tStone, vWorldPos.zy / 3.0).rgb * w.x
                     + texture2D(tStone, vWorldPos.xz / 3.0).rgb * w.y
                     + texture2D(tStone, vWorldPos.xy / 3.0).rgb * w.z;
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float hi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
          float sat = (hi - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b))) / max(hi, 0.001);
          float mask = smoothstep(0.25, 0.45, lum) * (1.0 - smoothstep(0.15, 0.32, sat));
          vec3 detail = vec3(dot(stone, vec3(0.299, 0.587, 0.114)) / 0.42);
          diffuseColor.rgb *= mix(vec3(1.0), detail, mask * 0.8 + 0.15);
        }`,
      );
  };
  return material;
}
