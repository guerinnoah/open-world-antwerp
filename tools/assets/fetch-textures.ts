import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const TEXTURES = {
  brick: 'red_brick_03',
  plaster: 'white_plaster_02',
  yellowBrick: 'yellow_bricks',
  slate: 'roof_slates_02',
  tiles: 'clay_roof_tiles',
  flatRoof: 'concrete_floor_worn_001',
  asphalt: 'asphalt_02',
  pavement: 'concrete_pavement',
  cobble: 'cobblestone_floor_04',
  grass: 'leafy_grass',
  pavers: 'brick_pavement_02',
  stone: 'white_sandstone_bricks',
} as const;

const OUT = 'public/textures';
await mkdir(OUT, { recursive: true });
const ua = { headers: { 'User-Agent': 'gta-antwerp-asset-pipeline/0.1' } };

for (const [name, asset] of Object.entries(TEXTURES)) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${asset}`, ua)).json();
  for (const [map, key, size, quality] of [['albedo', 'Diffuse', 1024, 80], ['normal', 'nor_gl', 512, 90]] as const) {
    const url = files[key]?.['1k']?.jpg?.url;
    if (!url) throw new Error(`${asset}: no 1k ${key}`);
    const jpg = Buffer.from(await (await fetch(url, ua)).arrayBuffer());
    const webp = await sharp(jpg).resize(size, size).webp({ quality }).toBuffer();
    await writeFile(`${OUT}/${name}_${map}.webp`, webp);
    console.log(`${name}_${map}.webp  ${(webp.length / 1024).toFixed(0)} KB  (${asset})`);
  }
}
