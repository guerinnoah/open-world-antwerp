// pnpm tsx tools/assets/fetch-textures.ts [name…]   (no names: fetch all)
import { mkdir, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const TEXTURES = {
  brick: 'red_brick',
  plaster: 'painted_plaster_wall',
  yellowBrick: 'yellow_brick',
  ashlar: 'white_sandstone_blocks_02',
  slate: 'roof_slates_03',
  tiles: 'clay_roof_tiles_03',
  flatRoof: 'bitumen',
  asphalt: 'asphalt_02',
  pavement: 'concrete_tiles',
  cobble: 'patterned_cobblestone',
  grass: 'grass_ground',
  pavers: 'pavement_06',
  stone: 'white_sandstone_bricks',
} as const;

const OUT = 'public/textures';
await mkdir(OUT, { recursive: true });
const ua = { headers: { 'User-Agent': 'open-world-antwerp-asset-pipeline/0.1' } };
const only = process.argv.slice(2);

for (const [name, asset] of Object.entries(TEXTURES)) {
  if (only.length && !only.includes(name)) continue;
  const files = await (await fetch(`https://api.polyhaven.com/files/${asset}`, ua)).json();
  for (const [map, key, sizes, quality] of [['albedo', 'Diffuse', [1024, 512], 80], ['normal', 'nor_gl', [512], 90]] as const) {
    const url = files[key]?.['1k']?.jpg?.url;
    if (!url) throw new Error(`${asset}: no 1k ${key}`);
    const jpg = Buffer.from(await (await fetch(url, ua)).arrayBuffer());
    for (const size of sizes) {
      const file = `${name}_${map}${size === sizes[0] ? '' : `_${size}`}.webp`;
      const webp = await sharp(jpg).resize(size, size).webp({ quality }).toBuffer();
      await writeFile(`${OUT}/${file}`, webp);
      console.log(`${file}  ${(webp.length / 1024).toFixed(0)} KB  (${asset})`);
    }
  }
}
