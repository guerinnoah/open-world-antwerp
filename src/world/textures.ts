import * as THREE from 'three';

export const BUILDING_LAYERS = ['brick', 'plaster', 'yellowBrick', 'slate', 'tiles', 'flatRoof'] as const;
export type BuildingLayer = (typeof BUILDING_LAYERS)[number];
export const BUILDING_SCALE: Record<BuildingLayer, number> = { brick: 2.2, plaster: 3, yellowBrick: 2.2, slate: 2.5, tiles: 2.5, flatRoof: 4 };

export type GroundTexture = 'asphalt' | 'pavement' | 'cobble' | 'grass' | 'pavers';

export interface Textures {
  buildingAlbedo: THREE.DataArrayTexture;
  buildingNormal: THREE.DataArrayTexture;
  ground: Record<GroundTexture, { map: THREE.Texture; normalMap: THREE.Texture }>;
  stone: { map: THREE.Texture; normalMap: THREE.Texture };
  water: THREE.DataTexture;
}

const GROUND: GroundTexture[] = ['asphalt', 'pavement', 'cobble', 'grass', 'pavers'];

export async function loadTextures(renderer: THREE.WebGLRenderer, size: number, maxAnisotropy: number): Promise<Textures> {
  const anisotropy = Math.min(maxAnisotropy, renderer.capabilities.getMaxAnisotropy());
  const [albedo, normal, ground, stone] = await Promise.all([
    arrayTexture(BUILDING_LAYERS.map((n) => `/textures/${n}_albedo.webp`), size, true, anisotropy),
    arrayTexture(BUILDING_LAYERS.map((n) => `/textures/${n}_normal.webp`), Math.min(size, 512), false, anisotropy),
    Promise.all(GROUND.map((n) => pair(n, anisotropy))),
    pair('stone', anisotropy),
  ]);
  return {
    buildingAlbedo: albedo,
    buildingNormal: normal,
    ground: Object.fromEntries(GROUND.map((n, i) => [n, ground[i]])) as Textures['ground'],
    stone,
    water: waterNormals(256),
  };
}

async function pair(name: string, anisotropy: number) {
  const loader = new THREE.TextureLoader();
  const [map, normalMap] = await Promise.all([
    loader.loadAsync(`/textures/${name}_albedo.webp`),
    loader.loadAsync(`/textures/${name}_normal.webp`),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
  }
  return { map, normalMap };
}

async function arrayTexture(urls: string[], size: number, srgb: boolean, anisotropy: number): Promise<THREE.DataArrayTexture> {
  const data = new Uint8Array(size * size * 4 * urls.length);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const images = await Promise.all(urls.map(async (url) => createImageBitmap(await (await fetch(url)).blob())));
  images.forEach((image, i) => {
    ctx.drawImage(image, 0, 0, size, size);
    data.set(ctx.getImageData(0, 0, size, size).data, i * size * size * 4);
    image.close();
  });
  const texture = repeating(new THREE.DataArrayTexture(data, size, size, urls.length));
  texture.anisotropy = anisotropy;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
