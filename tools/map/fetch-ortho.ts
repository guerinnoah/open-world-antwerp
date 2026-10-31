import { readFile } from 'node:fs/promises';
import sharp, { type OverlayOptions } from 'sharp';
import { OUT_DIR } from './config.ts';
import { ORIGIN, project } from '../../src/world/projection.ts';

// Digitaal Vlaanderen WMS 1.3.0: latest 15 cm leaf-off mosaic, as the game draws its own trees
const WMS = 'https://geo.api.vlaanderen.be/OMWRGBMRVL/wms';
const LAYER = 'Ortho';
const TILE = 2048; // px, GetMap's limit
const GSD = 0.4; // m per pixel; supersampled for sharper mipmaps
const MAX_DIM = 6144;
const QUALITY = 82;

const { bounds } = JSON.parse(await readFile(`${OUT_DIR}/city.json`, 'utf8')) as {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
};
const { minX, maxX, minZ, maxZ } = bounds;

const mPerDegLon = project(ORIGIN.lat, ORIGIN.lon + 1)[0];
const mPerDegLat = -project(ORIGIN.lat + 1, ORIGIN.lon)[1];
const lon = (x: number) => ORIGIN.lon + x / mPerDegLon;
const lat = (z: number) => ORIGIN.lat - z / mPerDegLat; // +z is south

const fullW = Math.round((maxX - minX) / GSD);
const fullH = Math.round((maxZ - minZ) / GSD);

async function tile(x: number, y: number, w: number, h: number): Promise<Buffer> {
  const west = lon(minX + (x / fullW) * (maxX - minX));
  const east = lon(minX + ((x + w) / fullW) * (maxX - minX));
  const north = lat(minZ + (y / fullH) * (maxZ - minZ));
  const south = lat(minZ + ((y + h) / fullH) * (maxZ - minZ));
  // CRS:84 keeps lon,lat order (WMS 1.3.0 swaps axes for EPSG:4326)
  const url = `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=${LAYER}&styles=`
    + `&crs=CRS:84&bbox=${west},${south},${east},${north}&width=${w}&height=${h}&format=image/jpeg`;
  const res = await fetch(url);
  if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) {
    throw new Error(`tile ${x},${y} → ${res.status} ${res.headers.get('content-type')}: ${(await res.text()).slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

const parts: OverlayOptions[] = [];
for (let y = 0; y < fullH; y += TILE) {
  for (let x = 0; x < fullW; x += TILE) {
    parts.push({ input: await tile(x, y, Math.min(TILE, fullW - x), Math.min(TILE, fullH - y)), left: x, top: y });
    process.stdout.write('.');
  }
}
process.stdout.write('\n');

const stitched = await sharp({ create: { width: fullW, height: fullH, channels: 3, background: '#000' } })
  .composite(parts)
  .jpeg({ quality: 95 })
  .toBuffer();
const scale = Math.min(1, MAX_DIM / Math.max(fullW, fullH));
const out = `${OUT_DIR}/ortho.webp`;
const { size } = await sharp(stitched)
  .resize(Math.round(fullW * scale), Math.round(fullH * scale))
  .webp({ quality: QUALITY })
  .toFile(out);
console.log(`Saved ${out}: ${Math.round(fullW * scale)}×${Math.round(fullH * scale)} px, ${(size / 1e6).toFixed(1)} MB (${parts.length} tiles @ ${GSD} m/px)`);
