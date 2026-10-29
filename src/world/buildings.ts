import * as THREE from 'three';
import type { Building } from './cityData';
import { freeAfterUpload } from '../core/instancing';
import { addRoof, hash, planRoof, type MeshArrays, type Surface } from './roofs';
import { BUILDING_LAYERS, BUILDING_SCALE, type BuildingLayer, type Textures } from './textures';
import { triangulate } from './triangulate';

export interface BuildingArrays {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  /** Texture coordinates (m): walls (along, height); roofs (along the eaves, up the slope); flat roofs (x, z). */
  uvm: Float32Array;
  /** x: texture layer (index into BUILDING_LAYERS); y: 1 where the window pattern is drawn. */
  surf: Float32Array;
  /** Per vertex: x = along this wall (m), y = wall length (m, 0 = no facade), z = wall top (m, -1 = no cornice),
   * w = flags (1 street-facing, + 2 × shop kind) + style seed in [0, 1). */
  facade: Float32Array;
  index: Uint32Array;
}

const layer = (name: BuildingLayer) => BUILDING_LAYERS.indexOf(name);

/** Stable random in [0, 1) per building; salt 5 = facade seed, 7 = wall push (reused by signs, interiors, facadeDetail). */
export const rand = (b: Building, salt = 0) => hash(b.rings[0][0], b.rings[0][1], salt);

const WALLS: BuildingLayer[] = ['plaster', 'brick', 'yellowBrick', 'ashlar']; // by Building.m
// Flat roofs, mostly bitumen, some gravel ballast or pale membrane (sRGB).
const FLAT_ROOFS = [0x4b4b4c, 0x4b4b4c, 0x4b4b4c, 0x56565a, 0x56565a, 0x625f5b, 0x7d7a74, 0x7d7a74, 0x8f8d89];

function surfaces(b: Building): { wall: Surface; roof: Surface; flatRoof: Surface } {
  const wall = { layer: layer(WALLS[b.m ?? 0]), tint: new THREE.Color(b.c).multiplyScalar(0.94 + rand(b) * 0.12) };
  const tiled = new THREE.Color(b.r).getHSL({ h: 0, s: 0, l: 0 }).s > 0.25;
  const roof = { layer: layer(tiled ? 'tiles' : 'slate'), tint: new THREE.Color(b.r).multiplyScalar(0.92 + rand(b, 2) * 0.16) };
  const flatRoof = { layer: layer('flatRoof'), tint: new THREE.Color(FLAT_ROOFS[Math.floor(rand(b, 3) * FLAT_ROOFS.length)]) };
  return { wall, roof, flatRoof };
}

export function extrudeBuildings(buildings: Building[]): BuildingArrays {
  const out: MeshArrays = { pos: [], nor: [], col: [], uvm: [], surf: [], fac: [], idx: [] };
  const { pos, nor, col, uvm, surf, fac, idx } = out;

  for (const b of buildings) {
    const plan = planRoof(b);
    const y0 = b.mh ?? 0;
    const y1 = plan ? plan.eaves : b.h;
    const { wall, roof, flatRoof } = surfaces(b);
    const windows = b.nw ? 0 : 1;
    const seed = rand(b, 5);
    const shopFlags = (b.sh ?? 0) * 2;
    const street = new Set(b.sf ?? []);
    const push = 0.01 + rand(b, 7) * 0.03; // neighbours often share a wall plane and z-fight: push each building's walls out 1–4 cm

    b.rings.forEach((ring, r) => {
      const n = ring.length / 2;
      let u = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const x0 = ring[i * 2], z0 = ring[i * 2 + 1];
        const x1 = ring[j * 2], z1 = ring[j * 2 + 1];
        const dx = x1 - x0, dz = z1 - z0;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = dz / len, nz = -dx / len; // outward: rings are wound outer-positive, holes negative
        const v = pos.length / 3;
        const px = nx * push, pz = nz * push;
        pos.push(x0 + px, y0, z0 + pz, x1 + px, y0, z1 + pz, x1 + px, y1, z1 + pz, x0 + px, y1, z0 + pz);
        for (let k = 0; k < 4; k++) {
          nor.push(nx, 0, nz);
          col.push(wall.tint.r, wall.tint.g, wall.tint.b);
          surf.push(wall.layer, windows);
        }
        uvm.push(u, y0, u + len, y0, u + len, y1, u, y1);
        const flagsSeed = (r === 0 && street.has(i) ? 1 : 0) + shopFlags + seed;
        const f = windows && len > 1.5 && y1 - y0 > 2.5 ? [len, y1, flagsSeed] : [0, 0, 0];
        fac.push(0, ...f, len, ...f, len, ...f, 0, ...f);
        idx.push(v, v + 2, v + 1, v, v + 3, v + 2);
        u += len;
      }
    });

    if (plan) {
      addRoof(out, plan, wall, roof, seed);
      continue;
    }
    const { flat, tris } = triangulate(b.rings);
    if (y0 > 0) { // underside of a canopy or a raised floor, seen from the street
      const v = pos.length / 3;
      for (let i = 0; i < flat.length; i += 2) {
        pos.push(flat[i], y0, flat[i + 1]);
        nor.push(0, -1, 0);
        col.push(wall.tint.r * 0.8, wall.tint.g * 0.8, wall.tint.b * 0.8);
        uvm.push(flat[i], flat[i + 1]);
        surf.push(wall.layer, 0);
        fac.push(0, 0, 0, 0);
      }
      for (let i = 0; i < tris.length; i += 3) idx.push(v + tris[i], v + tris[i + 2], v + tris[i + 1]);
    }
    const v = pos.length / 3;
    for (let i = 0; i < flat.length; i += 2) {
      pos.push(flat[i], y1, flat[i + 1]);
      nor.push(0, 1, 0);
      col.push(flatRoof.tint.r, flatRoof.tint.g, flatRoof.tint.b);
      uvm.push(flat[i], flat[i + 1]);
      surf.push(flatRoof.layer, 0);
      fac.push(0, 0, 0, 0);
    }
    for (const t of tris) idx.push(v + t);
  }

  return {
    position: new Float32Array(pos),
    normal: new Float32Array(nor),
    color: new Float32Array(col),
    uvm: new Float32Array(uvm),
    surf: new Float32Array(surf),
    facade: new Float32Array(fac),
    index: new Uint32Array(idx),
  };
}

function createBuildingMaterial(textures: Textures, night: number): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tAlbedo = { value: textures.buildingAlbedo };
    shader.uniforms.tNormal = { value: textures.buildingNormal };
    shader.uniforms.uScale = { value: BUILDING_LAYERS.map((l) => BUILDING_SCALE[l]) };
    shader.uniforms.uMean = { value: textures.buildingMean };
    shader.uniforms.uNight = { value: night };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 uvm;\nattribute vec2 surf;\nattribute vec4 facade;\nvarying vec2 vUvm;\nvarying vec2 vSurf;\nvarying vec4 vFacade;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUvm = uvm;\nvSurf = surf;\nvFacade = facade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_GLSL}`)
      .replace(
        'void main() {',
        `void main() {
        float layer = floor(vSurf.x + 0.5);
        vec2 tuv = vUvm / uScale[int(layer)];
        vec3 wallTex = texture(tAlbedo, vec3(tuv, layer)).rgb / uMean[int(layer)];
        Facade fc = facadeAt(vFacade, vUvm.y, dot(wallTex, vec3(0.3, 0.59, 0.11)));`,
      )
      .replace('#include <map_fragment>', 'diffuseColor.rgb *= wallTex;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, fc.colour, fc.amount);',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.06, fc.glass);',
      )
      // Tangent frame from screen-space derivatives (no tangents stored); painted and glazed parts are smooth.
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec3 mapN = texture(tNormal, vec3(tuv, layer)).xyz * 2.0 - 1.0;
          mapN.xy *= 0.9 * (1.0 - max(fc.amount, fc.glass));
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(tuv), st1 = dFdy(tuv);
          vec3 q1perp = cross(q1, normal), q0perp = cross(normal, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x;
          vec3 B = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(T, T), dot(B, B));
          float s = det == 0.0 ? 0.0 : inversesqrt(det);
          normal = normalize(T * (mapN.x * s) + B * (mapN.y * s) + normal * mapN.z);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fc.lit * vec3(1.0, 0.68, 0.38) * (0.35 + 2.3 * uNight) + fc.glow;',
      );
  };
  return material;
}

const FACADE_GLSL = `
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo;
uniform sampler2DArray tNormal;
uniform float uScale[${BUILDING_LAYERS.length}];
uniform vec3 uMean[${BUILDING_LAYERS.length}];
uniform float uNight; // 0 by day → 1 at night: more windows lit, glowing warmer
varying vec2 vUvm;
varying vec2 vSurf;
varying vec4 vFacade;

// amount: how much colour replaces the textured wall; glass: glossiness; lit, glow: light from inside.
struct Facade {
  vec3 colour;
  float amount;
  float glass;
  float lit;
  vec3 glow;
};

float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float rectMask(vec2 p, vec2 lo, vec2 hi, vec2 aa) {
  vec2 a = smoothstep(lo - aa, lo + aa, p) * (1.0 - smoothstep(hi - aa, hi + aa, p));
  return a.x * a.y;
}

vec3 framePaint(float s) {
  float k = fract(s * 41.7);
  return k < 0.45 ? vec3(0.72, 0.71, 0.68) : k < 0.65 ? vec3(0.6, 0.55, 0.42) : k < 0.8 ? vec3(0.02, 0.06, 0.035)
       : k < 0.92 ? vec3(0.06, 0.035, 0.022) : vec3(0.03, 0.033, 0.036);
}
vec3 doorPaint(float s) {
  float k = fract(s * 43.3);
  return k < 0.25 ? vec3(0.015, 0.05, 0.025) : k < 0.45 ? vec3(0.13, 0.015, 0.02) : k < 0.6 ? vec3(0.01, 0.02, 0.06)
       : k < 0.75 ? vec3(0.012, 0.012, 0.014) : vec3(0.12, 0.05, 0.018);
}
vec3 brandPaint(float s) {
  float k = fract(s * 47.9);
  return k < 0.2 ? vec3(0.01, 0.07, 0.03) : k < 0.4 ? vec3(0.18, 0.015, 0.02) : k < 0.55 ? vec3(0.01, 0.015, 0.012)
       : k < 0.7 ? vec3(0.01, 0.025, 0.09) : k < 0.85 ? vec3(0.6, 0.58, 0.55) : vec3(0.35, 0.12, 0.01);
}

void windowMasks(vec2 p, float hw, float bot, float top, bool arched, vec2 aa,
                 out float frame, out float glass, out float sill, out float lintel) {
  float outer = rectMask(p, vec2(-hw, bot), vec2(hw, top), aa);
  float inner = rectMask(p, vec2(-hw + 0.07, bot + 0.07), vec2(hw - 0.07, top - 0.07), aa);
  if (arched && p.y > top - hw) {
    float d = length(vec2(p.x, p.y - (top - hw)));
    outer = 1.0 - smoothstep(hw - aa.x, hw + aa.x, d);
    inner = 1.0 - smoothstep(hw - 0.07 - aa.x, hw - 0.07 + aa.x, d);
  }
  float bars = max(1.0 - smoothstep(0.022, 0.022 + aa.x, abs(p.x)),
                   1.0 - smoothstep(0.022, 0.022 + aa.y, abs(p.y - mix(bot, top, 0.66))));
  glass = inner * (1.0 - bars);
  frame = max(outer - glass, 0.0);
  sill = rectMask(p, vec2(-hw - 0.08, bot - 0.1), vec2(hw + 0.08, bot), aa);
  lintel = arched ? rectMask(p, vec2(-0.11, top - 0.04), vec2(0.11, top + 0.14), aa)
                  : rectMask(p, vec2(-hw - 0.1, top), vec2(hw + 0.1, top + 0.18), aa);
}

// Dim room behind the glass with a reveal shadow, maybe curtains; about 7% of rooms are lit.
void paneLook(vec2 p, float hw, float bot, float top, float id, inout vec3 c, inout float lit) {
  float room = hash2(vec2(id, 3.1));
  c = mix(vec3(0.018, 0.02, 0.024), vec3(0.06, 0.05, 0.04), room);
  float reveal = max(smoothstep(top - 0.25, top - 0.07, p.y), smoothstep(-hw + 0.2, -hw + 0.07, p.x)) * 0.6;
  c *= 1.0 - reveal;
  float curtains = hash2(vec2(id, 7.7));
  if (curtains < 0.3) {
    float side = smoothstep(hw * 0.45, hw * 0.55, abs(p.x));
    c = mix(c, vec3(0.32, 0.29, 0.24), side * 0.8);
  } else if (curtains < 0.45) {
    c = mix(c, vec3(0.42, 0.4, 0.36), (1.0 - smoothstep(mix(bot, top, 0.45) - 0.02, mix(bot, top, 0.45), p.y)) * 0.7);
  }
  lit = step(hash2(vec2(id, 11.3)), 0.05 + 0.38 * uNight);
}

Facade windowAt(vec2 p, float hw, float bot, float top, bool arched, float id, vec3 paint, vec3 sillStone, vec3 trim, float ledge, vec2 aa) {
  float fr, g, si, li;
  windowMasks(p, hw, bot, top, arched, aa, fr, g, si, li);
  vec3 pane; float lit;
  paneLook(p, hw, bot, top, id, pane, lit);
  return Facade(fr * paint + g * pane + si * sillStone + (li + ledge) * trim, max(max(fr, g), max(max(si, li), ledge)), g, g * lit, vec3(0.0));
}

// What's seen through a shop window, by ShopKind (cityData.ts); lx, h: metres from the bay's centre and the pavement.
vec3 shopInterior(float kind, float lx, float h, float u, float bay, float bayW, float groundH, float seed, vec2 aa, out vec3 glow) {
  float top = groundH - 1.2;
  float vary = hash2(vec2(bay, seed));
  if (kind > 1.5 && kind < 2.5) { // café / restaurant
    vec3 c = mix(vec3(0.035, 0.02, 0.01), vec3(0.06, 0.035, 0.015), vary);
    float bar = rectMask(vec2(0.0, h), vec2(-1.0, 0.5), vec2(1.0, 1.15), aa) * 0.6;
    c = mix(c, vec3(0.09, 0.045, 0.02), bar);
    float lamp = 1.0 - smoothstep(0.07, 0.07 + aa.y * 2.0, length(vec2(lx, h - (top - 0.35))));
    float cord = rectMask(vec2(lx, h), vec2(-0.008, top - 0.3), vec2(0.008, groundH), aa);
    float table = rectMask(vec2(abs(lx) - bayW * 0.22, h), vec2(-0.32, 0.72), vec2(0.32, 0.77), aa)
                + rectMask(vec2(abs(lx) - bayW * 0.22, h), vec2(-0.025, 0.5), vec2(0.025, 0.74), aa);
    c = mix(c, vec3(0.012, 0.008, 0.005), min(table + cord, 1.0));
    glow = c * 1.6 + lamp * vec3(1.0, 0.72, 0.4) * 1.4;
    return mix(c, vec3(1.0, 0.8, 0.5), lamp);
  }
  if (kind > 2.5 && kind < 3.5) { // fashion
    vec3 c = vec3(0.16, 0.15, 0.14);
    float slot = floor(u / 0.11);
    float hanger = rectMask(vec2(fract(u / 0.11), h), vec2(0.12, 0.85 + hash2(vec2(slot, 3.0)) * 0.25), vec2(0.88, 1.6), aa / vec2(0.11, 1.0));
    hanger *= step(0.25, hash2(vec2(slot, seed))) * step(0.5, abs(lx));
    vec3 cloth = mix(vec3(0.02, 0.025, 0.04), vec3(0.3, 0.26, 0.2), hash2(vec2(slot, 7.0)));
    cloth = mix(cloth, vec3(0.25, 0.04, 0.04), step(0.85, hash2(vec2(slot, 11.0))));
    float rail = rectMask(vec2(0.0, h), vec2(-1.0, 1.62), vec2(1.0, 1.66), aa) * step(0.5, abs(lx));
    float body = rectMask(vec2(lx, h), vec2(-0.17, 0.95), vec2(0.17, 1.6), aa) + rectMask(vec2(abs(lx), h), vec2(0.03, 0.1), vec2(0.1, 0.95), aa)
               + (1.0 - smoothstep(0.09, 0.09 + aa.y * 2.0, length(vec2(lx, h - 1.75))));
    c = mix(c, cloth, hanger);
    c = mix(c, vec3(0.03), rail);
    c = mix(c, mix(vec3(0.5, 0.48, 0.45), cloth * 1.5, step(h, 1.6) * step(0.95, h)), min(body, 1.0));
    glow = c * 0.9;
    return c;
  }
  if (kind > 4.5 && kind < 5.5) { // bakery
    vec3 c = vec3(0.2, 0.15, 0.09);
    vec2 cell = vec2(fract(u / 0.24), fract((h - 1.3) / 0.28));
    float loaf = (1.0 - smoothstep(0.32, 0.36, length((cell - 0.5) * vec2(1.0, 1.6)))) * step(1.3, h) * step(h, top);
    c = mix(c, mix(vec3(0.32, 0.15, 0.04), vec3(0.45, 0.25, 0.07), hash2(floor(vec2(u / 0.24, h / 0.28)))), loaf);
    float counter = rectMask(vec2(0.0, h), vec2(-1.0, 0.45), vec2(1.0, 1.05), aa);
    vec2 pc = vec2(fract(u / 0.12), fract((h - 0.5) / 0.22));
    float pastry = (1.0 - smoothstep(0.25, 0.32, length(pc - vec2(0.5, 0.4)))) * step(0.5, h) * step(h, 0.98);
    c = mix(c, mix(vec3(0.3, 0.27, 0.22), mix(vec3(0.4, 0.2, 0.05), vec3(0.25, 0.06, 0.08), step(0.8, hash2(floor(vec2(u / 0.12, h / 0.22))))), pastry), counter);
    glow = c * 1.1;
    return c;
  }
  if (kind > 5.5 && kind < 6.5) { // jewellery
    vec3 c = vec3(0.008, 0.007, 0.007);
    float case_ = rectMask(vec2(lx, h), vec2(-bayW * 0.36, 0.95), vec2(bayW * 0.36, 1.45), aa);
    vec2 cell = floor(vec2(u / 0.05, h / 0.05));
    float glint = step(0.9, hash2(cell + seed)) * case_;
    c = mix(c, vec3(0.12, 0.11, 0.1), case_ * 0.5);
    c = mix(c, vec3(0.9, 0.75, 0.4), glint);
    glow = c * 1.5;
    return c;
  }
  if (kind > 6.5) { // service
    vec3 c = mix(vec3(0.07, 0.07, 0.065), vec3(0.09, 0.08, 0.07), vary);
    float light = rectMask(vec2(0.0, h), vec2(-1.0, top - 0.06), vec2(1.0, top), aa);
    float shelfY = fract(h / 0.36);
    float shelf = (1.0 - smoothstep(0.05, 0.05 + aa.y / 0.36, shelfY)) * step(1.1, h) * step(h, top - 0.2);
    vec2 item = floor(vec2(u / 0.12, h / 0.36));
    float box = step(0.55, hash2(item + seed)) * step(0.1, shelfY) * step(shelfY, 0.5) * step(1.1, h) * step(h, top - 0.2)
              * step(0.2, fract(u / 0.12)) * step(fract(u / 0.12), 0.8);
    float counter = rectMask(vec2(lx, h), vec2(-bayW * 0.3, 0.5), vec2(bayW * 0.3, 1.05), aa);
    c = mix(c, vec3(0.2, 0.2, 0.19), shelf);
    c = mix(c, mix(vec3(0.25, 0.25, 0.24), vec3(0.05, 0.15, 0.09), step(0.8, hash2(item * 1.7))), box);
    c = mix(c, vec3(0.035, 0.032, 0.03), counter);
    glow = c * 0.35 + light * vec3(0.6);
    return mix(c, vec3(1.0), light);
  }
  bool food = kind > 3.5; // food, or else a general shop
  vec3 c = food ? vec3(0.06, 0.06, 0.058) : mix(vec3(0.012, 0.011, 0.01), vec3(0.04, 0.032, 0.025), vary);
  float shelfY = fract(h / 0.42);
  float shelf = (1.0 - smoothstep(0.04, 0.04 + aa.y / 0.42, shelfY)) * step(0.5, h) * step(h, top);
  vec2 item = floor(vec2(u / 0.16, h / 0.42));
  float product = step(food ? 0.15 : 0.45, hash2(item + seed * 7.0)) * step(0.08, shelfY) * step(shelfY, 0.55)
                * step(0.5, h) * step(h, top) * rectMask(vec2(fract(u / 0.16), 0.5), vec2(0.15, 0.0), vec2(0.85, 1.0), aa / 0.16);
  vec3 productColour = vec3(hash2(item * 1.3), hash2(item * 2.1 + 4.0), hash2(item * 0.7 + 9.0));
  productColour = mix(vec3(dot(productColour, vec3(0.33))), productColour, 0.6) * (food ? 0.3 : 0.22) + 0.04;
  c = mix(c, vec3(0.16, 0.14, 0.12), shelf);
  c = mix(c, productColour, product);
  glow = food ? c * 0.5 : max(shelf, product) * c * 0.6 + vec3(0.012, 0.009, 0.006);
  return c;
}

// f: the per-vertex facade attribute (see BuildingArrays.facade); h: height up the wall (m).
Facade facadeAt(vec4 f, float h, float texLum) {
  Facade o = Facade(vec3(0.0), 0.0, 0.0, 0.0, vec3(0.0));
  if (f.y < 0.5) return o;
  float seed = fract(f.w);
  float flags = floor(f.w + 1e-4);
  bool street = mod(flags, 2.0) > 0.5;
  float kind = floor(flags / 2.0);
  bool shop = kind > 0.5;
  // Keep in sync with facadeLayout.ts.
  float floorH = 3.0 + fract(seed * 7.13) * 0.6;
  float groundH = 3.4 + fract(seed * 3.71) * 1.0;
  float nb = max(1.0, floor(f.y / (2.4 + fract(seed * 11.3)) + 0.3));
  float bayW = f.y / nb;
  float hw = (0.42 + fract(seed * 5.17) * 0.18) * bayW * 0.5;
  float winH = (0.55 + fract(seed * 13.7) * 0.15) * floorH;
  bool arched = fract(seed * 17.3) < 0.25;
  float bay = floor(f.x / bayW);
  float lx = (fract(f.x / bayW) - 0.5) * bayW;
  vec2 aa = vec2(fwidth(f.x), fwidth(h)) * 0.75 + 1e-4;
  float fade = 1.0 - smoothstep(0.05, 0.16, max(aa.x, aa.y)); // far away the detail would only shimmer
  if (fade <= 0.0) return o;

  // Bluestone plinth and often sills; cornice, lintels and string courses painted cream or in grey stone.
  float grain = 0.85 + 0.15 * texLum;
  vec3 trim = (fract(seed * 19.9) < 0.8 ? vec3(0.62, 0.6, 0.55) : vec3(0.3, 0.29, 0.26)) * grain;
  vec3 bluestone = vec3(0.075, 0.08, 0.085) * grain;
  vec3 sillStone = fract(seed * 37.1) < 0.55 ? bluestone : trim;
  vec3 paint = framePaint(seed);
  float top = f.z;

  if (top > 0.0 && h > top - 0.6 && fract(seed * 31.3) < 0.75) { // cornice with dentils
    float under = 1.0 - smoothstep(top - 0.52 - aa.y, top - 0.52 + aa.y, h);
    float dentils = step(0.5, fract(f.x / 0.3)) * rectMask(vec2(0.0, h), vec2(-1.0, top - 0.42), vec2(1.0, top - 0.3), aa);
    o.colour = trim * (1.0 - 0.55 * max(under, dentils));
    o.amount = 1.0;
  } else if (h < 0.45) { // plinth
    o.colour = bluestone;
    o.amount = 0.9;
  } else if (h < groundH) {
    float door = floor(fract(seed * 29.7) * nb);
    if (street && shop) { // shopfront: fascia (signs.ts hangs the real sign on it), glazed bays, a glass door
      vec3 brand = brandPaint(seed);
      float sign = rectMask(vec2(0.0, h), vec2(-1.0, groundH - 0.95), vec2(1.0, groundH - 0.35), aa);
      bool isDoor = abs(bay - door) < 0.5;
      vec2 lo = isDoor ? vec2(-0.55, 0.0) : vec2(-bayW * 0.44, 0.5);
      vec2 hi = isDoor ? vec2(0.55, min(2.5, groundH - 1.1)) : vec2(bayW * 0.44, groundH - 1.1);
      float g = rectMask(vec2(lx, h), lo + 0.05, hi - 0.05, aa);
      float fr = max(rectMask(vec2(lx, h), lo, hi, aa) - g, 0.0);
      vec3 glow;
      vec3 inside = shopInterior(kind, lx, h, f.x, bay, bayW, groundH, seed, aa, glow);
      o.colour = sign * brand + fr * brand + g * inside;
      o.amount = max(sign, max(fr, g));
      o.glass = g;
      o.glow = g * glow;
    } else if (street && abs(bay - door) < 0.5) { // front door under a transom, in a stone surround
      float dTop = min(2.5, groundH - 0.75);
      float d = rectMask(vec2(lx, h), vec2(-0.55, 0.0), vec2(0.55, dTop), aa);
      float transom = rectMask(vec2(lx, h), vec2(-0.47, dTop + 0.08), vec2(0.47, dTop + 0.45), aa);
      float surround = max(rectMask(vec2(lx, h), vec2(-0.72, 0.0), vec2(0.72, dTop + 0.6), aa) - d - transom, 0.0);
      float panels = (1.0 - smoothstep(0.02, 0.02 + aa.x, abs(lx))) * 0.5
                   + (1.0 - smoothstep(0.02, 0.02 + aa.y, abs(h - dTop * 0.55))) * 0.5;
      o.colour = d * doorPaint(seed) * (1.0 - panels * 0.6) + surround * sillStone + transom * vec3(0.02, 0.022, 0.026);
      o.amount = max(d, max(surround, transom));
      o.glass = transom;
    } else {
      float wTop = min(0.9 + winH * (street ? 1.0 : 0.8), groundH - 0.4);
      o = windowAt(vec2(lx, h), hw, 0.9, wTop, arched, bay + seed * 91.0, paint, sillStone, trim, 0.0, aa);
    }
  } else { // upper floors: an optional ledge at each floor line, then the window
    float level = floor((h - groundH) / floorH);
    float ly = h - groundH - level * floorH;
    float ledge = fract(seed * 23.1) < 0.6 ? rectMask(vec2(0.0, ly), vec2(-1.0, 0.0), vec2(1.0, 0.13), aa) : 0.0;
    float wTop = min(0.85 + winH, floorH - 0.3);
    o = windowAt(vec2(lx, ly), hw, 0.85, wTop, arched, bay + level * 17.0 + seed * 91.0, paint, sillStone, trim, ledge, aa);
  }
  o.amount *= fade;
  o.glass *= fade;
  o.lit *= fade;
  return o;
}
`;

const CHUNK = 500;

export function createBuildings(buildings: Building[], textures: Textures, night = 0): THREE.Group {
  const chunks = new Map<string, Building[]>();
  for (const b of buildings) {
    if (b.hd) continue;
    const r = b.rings[0];
    const key = `${Math.floor(r[0] / CHUNK)},${Math.floor(r[1] / CHUNK)}`;
    let list = chunks.get(key);
    if (!list) chunks.set(key, (list = []));
    list.push(b);
  }

  const material = createBuildingMaterial(textures, night);
  const group = new THREE.Group();
  group.name = 'buildings';
  for (const list of chunks.values()) {
    const a = extrudeBuildings(list);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
    geometry.setAttribute('uvm', new THREE.BufferAttribute(a.uvm, 2));
    geometry.setAttribute('surf', new THREE.BufferAttribute(a.surf, 2));
    geometry.setAttribute('facade', new THREE.BufferAttribute(a.facade, 4));
    geometry.setIndex(new THREE.BufferAttribute(a.index, 1));
    geometry.computeBoundingSphere();
    freeAfterUpload(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
