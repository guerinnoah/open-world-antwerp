import * as THREE from 'three';
import { track } from '../core/loadProgress';

export const BUILDING_LAYERS = ['brick', 'plaster', 'yellowBrick', 'ashlar', 'slate', 'tiles', 'flatRoof'] as const;
export type BuildingLayer = (typeof BUILDING_LAYERS)[number];
/** Metres per texture repeat: each scan's real size, so bricks and slates come out life-size. */
export const BUILDING_SCALE: Record<BuildingLayer, number> = {
  brick: 1.4, plaster: 2, yellowBrick: 2, ashlar: 2, slate: 3, tiles: 2.6, flatRoof: 20,
};

export type GroundTexture = 'asphalt' | 'pavement' | 'cobble' | 'grass' | 'pavers';

/** mean: the albedo's average linear colour. Materials divide by it, so a tint is the surface's real average colour. */
interface Pair {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  mean: THREE.Color;
}

export interface Textures {
  buildingAlbedo: THREE.DataArrayTexture;
  buildingNormal: THREE.DataArrayTexture;
  buildingMean: THREE.Color[];
  ground: Record<GroundTexture, Pair>;
  stone: Pair;
  water: THREE.DataTexture;
}

const GROUND: GroundTexture[] = ['asphalt', 'pavement', 'cobble', 'grass', 'pavers'];

export async function loadTextures(renderer: THREE.WebGLRenderer, size: number, maxAnisotropy: number): Promise<Textures> {
  const anisotropy = Math.min(maxAnisotropy, renderer.capabilities.getMaxAnisotropy());
  // Phones (size 512) fetch the half-size colour maps: a quarter of the download.
  const albedoUrl = (name: string) => `/textures/${name}_albedo${size < 1024 ? '_512' : ''}.webp`;
  const [albedo, normal, ground, stone] = await Promise.all([
    arrayTexture(BUILDING_LAYERS.map(albedoUrl), size, true, anisotropy),
    arrayTexture(BUILDING_LAYERS.map((n) => `/textures/${n}_normal.webp`), Math.min(size, 512), false, anisotropy),
    Promise.all(GROUND.map((n) => pair(albedoUrl(n), n, anisotropy))),
    pair(albedoUrl('stone'), 'stone', anisotropy),
  ]);
  return {
    buildingAlbedo: albedo.texture,
    buildingNormal: normal.texture,
    buildingMean: albedo.means,
    ground: Object.fromEntries(GROUND.map((n, i) => [n, ground[i]])) as Textures['ground'],
    stone,
    water: waterNormals(256),
  };
}

const LINEAR = Array.from({ length: 256 }, (_, i) => new THREE.Color().setRGB(i / 255, 0, 0, THREE.SRGBColorSpace).r);

function meanOf(rgba: Uint8ClampedArray | Uint8Array, from = 0, to = rgba.length): THREE.Color {
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = from; i < to; i += 4 * 7) {
    for (let c = 0; c < 3; c++) sum[c] += LINEAR[rgba[i + c]];
    n++;
  }
  return new THREE.Color(sum[0] / n, sum[1] / n, sum[2] / n);
}

async function pair(albedoUrl: string, name: string, anisotropy: number): Promise<Pair> {
  const loader = new THREE.TextureLoader();
  const [map, normalMap] = await Promise.all([
    track(loader.loadAsync(albedoUrl)),
    track(loader.loadAsync(`/textures/${name}_normal.webp`)),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(map.image, 0, 0, 128, 128);
  return { map, normalMap, mean: meanOf(ctx.getImageData(0, 0, 128, 128).data) };
}

async function arrayTexture(urls: string[], size: number, srgb: boolean, anisotropy: number) {
  const data = new Uint8Array(size * size * 4 * urls.length);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const images = await Promise.all(urls.map(async (url) => createImageBitmap(await track(fetch(url).then((r) => r.blob())))));
  images.forEach((image, i) => {
    ctx.drawImage(image, 0, 0, size, size);
    data.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
    image.close();
  });
  const texture = repeating(new THREE.DataArrayTexture(data, size, size, urls.length));
  texture.anisotropy = anisotropy;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  const layerBytes = size * size * 4;
  return { texture, means: urls.map((_, i) => meanOf(data, i * layerBytes, (i + 1) * layerBytes)) };
}

function repeating<T extends THREE.Texture>(texture: T): T {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function waterNormals(size: number): THREE.DataTexture {
  const waves = Array.from({ length: 14 }, (_, i) => {
    const k = 2 + Math.floor(Math.random() * (6 + i));
    const a = Math.random() * Math.PI * 2;
    return { kx: Math.round(Math.cos(a) * k), ky: Math.round(Math.sin(a) * k), amp: 1 / (k * 0.6 + 1), phase: Math.random() * Math.PI * 2 };
  });
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) {
        const t = ((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.phase;
        const c = Math.cos(t) * w.amp;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const n = new THREE.Vector3(-dx * 0.04, -dy * 0.04, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  return repeating(new THREE.DataTexture(data, size, size));
}
