import * as THREE from 'three';
import { FRONT } from './mesher';
import type { Kit } from './room';

export const MAX_LAMPS = 12, MAX_BLOCKS = 40;
export const WARM = 0xffc690, SOFT = 0xffe2c0, COOL = 0xf1f4ff, DAY = 0xdbe6ff;

export interface Lamp {
  x: number;
  y: number;
  z: number;
  power: number; // cd
  colour: THREE.Color;
  range: number; // m
  shaded: boolean;
}

/** Interior materials only, so entering never recompiles the city's shaders. */
const LIGHT_VERTEX = /* glsl */ `
uniform mat4 uRoom;
varying vec3 vInWorld;
varying vec3 vInRoom;
varying vec3 vInRoomN;
`;
const LIGHT_FRAGMENT = /* glsl */ `
uniform vec4 uLamp[${MAX_LAMPS}];
uniform vec3 uLampColour[${MAX_LAMPS}];
uniform int uLamps;
uniform vec4 uBlock[${MAX_BLOCKS}];
uniform int uBlocks;
uniform vec4 uBox;
uniform vec3 uAmbient;
uniform float uSun;
varying vec3 vInWorld;
varying vec3 vInRoom;
varying vec3 vInRoomN;
float inPlane(float d, float facing, float r, float k) { return 1.0 - k * (1.0 - clamp(facing, 0.0, 1.0)) * (1.0 - smoothstep(0.0, r, d)); }
float inOcclusion(vec3 p, vec3 n) {
  float ao = inPlane(p.y, n.y, 0.45, 0.5) * inPlane(uBox.w - p.y, -n.y, 0.7, 0.35)
    * inPlane(p.x - uBox.x, n.x, 0.6, 0.4) * inPlane(uBox.y - p.x, -n.x, 0.6, 0.4)
    * inPlane(p.z - ${FRONT.toFixed(3)}, n.z, 0.6, 0.4) * inPlane(uBox.z - p.z, -n.z, 0.6, 0.4);
  if (n.y > 0.7 && p.y < 0.04) {
    for (int i = 0; i < ${MAX_BLOCKS}; i++) {
      if (i >= uBlocks) break;
      vec2 q = abs(p.xz - uBlock[i].xy) - uBlock[i].zw;
      ao *= 1.0 - 0.4 * (1.0 - smoothstep(-0.1, 0.4, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)));
    }
  }
  return ao;
}
`;

export function lit<M extends THREE.MeshStandardMaterial>(material: M, uniforms: Record<string, THREE.IUniform>): M {
  material.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n${LIGHT_VERTEX}`).replace('#include <project_vertex>', `#include <project_vertex>
      vec4 inLocal = vec4(transformed, 1.0);
      vec3 inNormal = objectNormal;
      #ifdef USE_INSTANCING
        mat3 inIm = mat3(instanceMatrix);
        inLocal = instanceMatrix * inLocal;
        inNormal = inIm * (inNormal / vec3(dot(inIm[0], inIm[0]), dot(inIm[1], inIm[1]), dot(inIm[2], inIm[2])));
      #endif
      vec4 inWorld = modelMatrix * inLocal;
      vInWorld = inWorld.xyz;
      vInRoom = (uRoom * inWorld).xyz;
      vInRoomN = mat3(uRoom) * mat3(modelMatrix) * inNormal;`);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\n${LIGHT_FRAGMENT}`).replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
      vec3 inN = normalize(vInRoomN);
      float inAO = inOcclusion(vInRoom, inN);
      reflectedLight.directDiffuse *= uSun;
      reflectedLight.directSpecular *= uSun;
      for (int i = 0; i < ${MAX_LAMPS}; i++) {
        if (i >= uLamps) break;
        vec3 toLamp = uLamp[i].xyz - vInWorld;
        float dist = length(toLamp);
        float shaded = uLamp[i].w < 0.0 ? smoothstep(-0.25, 0.45, toLamp.y / dist) : 1.0; // w < 0: lampshade, lights downwards
        directLight.direction = normalize(mat3(viewMatrix) * toLamp);
        directLight.color = uLampColour[i] * shaded * getDistanceAttenuation(dist, abs(uLamp[i].w), 2.0);
        RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
      }
      reflectedLight.directDiffuse *= mix(1.0, inAO, 0.6);`).replace('#include <lights_fragment_end>', `
      irradiance = uAmbient * inAO * (1.0 - 0.3 * inN.y);
      iblIrradiance *= 0.3 * inAO;
      radiance *= 0.5 * inAO;
      #include <lights_fragment_end>`);
  };
  material.customProgramCacheKey = () => 'interior';
  return material;
}

export function mergeLamps(lamps: Lamp[], max: number): Lamp[] {
  const out = lamps.map((l) => ({ ...l, colour: l.colour.clone() }));
  while (out.length > max) {
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const d = Math.hypot(out[i].x - out[j].x, out[i].y - out[j].y, out[i].z - out[j].z);
        if (d < bd) [bi, bj, bd] = [i, j, d];
      }
    }
    const a = out[bi], b = out.splice(bj, 1)[0], w = b.power / (a.power + b.power);
    a.x += (b.x - a.x) * w;
    a.y += (b.y - a.y) * w;
    a.z += (b.z - a.z) * w;
    a.colour.lerp(b.colour, w);
    a.power += b.power;
    a.range = Math.max(a.range, b.range) + bd / 2;
    a.shaded &&= b.shaded;
  }
  return out;
}

export function lamp(k: Kit, x: number, y: number, z: number, power: number, colour: number, range: number, shaded = false) {
  k.lamps.push({ x, y, z, power, colour: new THREE.Color(colour), range, shaded });
}
